# Rename Feature — Implementation Plan

## Overview

Add a **rename** operation for files and directories in the file browser, triggered by **F2** or a **context menu** entry. The architecture mirrors the existing delete flow end-to-end: backend storage method → API endpoint → frontend API service → keyboard shortcut → dialog → confirm handler.

---

## 1. Backend: Storage Layer

**`backend/app/storage/base.py`** — Add abstract method:
```python
@abstractmethod
async def rename_item(self, path: str, new_name: str) -> None:
    """Rename a file or directory (same parent, new name)."""
```

**`backend/app/storage/smb.py`** — Implement using `smbclient.rename(src, dst)`:
- Build `smb_src` via `_build_smb_path(path)`
- Derive `smb_dst` by replacing the final path segment with `new_name` (same parent directory)
- Run in executor with the pool connection pattern (same as `delete_item`)
- Handle `OSError` codes: `0xc0000034` (not found), `0xc0000035` (name collision / already exists)
- Timeout: ~30 seconds (rename is a single metadata operation, much faster than recursive delete)

---

## 2. Backend: Request Model

**`backend/app/models/file.py`** — Add:
```python
class RenameRequest(BaseModel):
    path: str          # current relative path of the item
    new_name: str      # new file/directory name (not a full path)
```

---

## 3. Backend: API Endpoint

**`backend/app/api/browser.py`** — Add `POST /{connection_id}/rename`:
- Accept `RenameRequest` as JSON body
- Validate: `new_name` is not empty, contains no path separators (`/`, `\`), is not `.` or `..`
- Validate: `path` is not the share root
- Follow the same pattern as `delete_item`: get connection → create `SMBBackend` → `connect()` → `rename_item()` → `disconnect()`
- **Directory cache**: Add `_rename_in_directory_cache()` helper — replaces the old path prefix with the new name in the cache for the renamed directory and all its children
- Return `200` with the new `FileInfo` (fetch via `get_file_info` after rename so the client has the updated path/name)
- Error mapping:
  - `FileNotFoundError` → 404
  - `FileExistsError` → 409 Conflict ("An item with that name already exists")
  - `ValueError` (invalid name) → 400
  - `OSError` → 500

---

## 4. Frontend: API Service

**`frontend/src/services/api.ts`** — Add:
```typescript
async renameItem(connectionId: string, path: string, newName: string): Promise<FileInfo> {
    const response = await this.api.post<FileInfo>(`/browse/${connectionId}/rename`, {
      path,
      new_name: newName,
    });
    return response.data;
}
```

---

## 5. Frontend: Keyboard Shortcut

**`frontend/src/config/keyboardShortcuts.ts`** — Add to `BROWSER_SHORTCUTS`:
```typescript
RENAME_ITEM: { id: "rename-item", keys: "F2", label: "F2", description: "Rename file or directory" },
```

---

## 6. Frontend: Rename Dialog Component

Create **`frontend/src/components/FileBrowser/RenameDialog.tsx`** modeled on `ConfirmDeleteDialog`:
- Props: `open`, `itemName`, `itemType`, `isRenaming`, `onClose`, `onConfirm(newName: string)`, `error?: string`
- MUI `Dialog` with a `TextField` pre-filled with the current name
- On open: auto-select the name portion (excluding extension for files, full name for directories)
- Client-side validation: non-empty, no slashes, not `.`/`..`, not identical to current name
- Confirm button ("Rename") + Cancel button; Enter submits, Escape cancels
- Show inline error from API (e.g., "already exists") below the text field
- Create corresponding **`renameDialogStrings.ts`** for all UI strings (matching the `confirmDeleteDialogStrings.ts` pattern)

---

## 7. Frontend: FileBrowser Wiring

**`frontend/src/pages/FileBrowser.tsx`**:

**State** (next to delete state ~line 142):
```typescript
const [renameDialogOpen, setRenameDialogOpen] = useState(false);
const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
const [isRenaming, setIsRenaming] = useState(false);
const [renameError, setRenameError] = useState<string | null>(null);
```

**`handleRenameRequest`** (modeled on `handleDeleteRequest`):
- Guard: list container must have focus, `focusedIndex` must point to a valid file
- Set `renameTarget` + open dialog

**`handleRenameConfirm(newName: string)`** (modeled on `handleDeleteConfirm`):
- Call `api.renameItem(connectionId, target.path, newName)`
- On success: close dialog, force-reload the file list, keep focus on same index (the renamed item will be at a potentially new sort position)
- On 409: set `renameError` to "An item with that name already exists" (shown in dialog)
- On other errors: set `renameError` with the detail from the API

**Keyboard shortcut registration** (in the `browserShortcuts` array):
```typescript
{
    ...BROWSER_SHORTCUTS.RENAME_ITEM,
    handler: handleRenameRequest,
    enabled:
      !settingsOpen && !mobileSettingsOpen && !viewInfo &&
      !deleteDialogOpen && !renameDialogOpen &&
      focusedIndex >= 0 && filesRef.current[focusedIndex] !== undefined,
},
```

**Render** (next to `ConfirmDeleteDialog`):
```tsx
<RenameDialog
    open={renameDialogOpen}
    itemName={renameTarget?.name ?? ""}
    itemType={renameTarget?.type ?? FileType.FILE}
    isRenaming={isRenaming}
    error={renameError}
    onClose={() => { setRenameDialogOpen(false); setRenameTarget(null); setRenameError(null); }}
    onConfirm={handleRenameConfirm}
/>
```

---

## 8. Context Menu Integration

**`frontend/src/components/FileBrowser/FileRow.tsx`**:
- Add `onRename?: (file: FileEntry, index: number) => void` prop
- Add a "Rename" `MenuItem` with an `EditIcon` to the existing context menu (above "Open in companion app")
- Enable the context menu for **both files and directories** (currently it only shows for files)
- Update the `React.memo` comparator to include `onRename`

---

## 9. Cross-Cutting Concerns

| Concern | Approach |
|---------|----------|
| **Change notifications** | The existing `DirectoryMonitor` via WebSocket already monitors for renames (`SMB2_CHANGE_NOTIFY`). After a rename, the SMB server sends a change notification → frontend auto-reloads. No extra work needed. |
| **Edit locks** | If a file is being edited (has an active edit lock), the rename should still work at the SMB level. The edit lock tracks by path, so a locked file's rename could orphan the lock. Consider: reject rename if the item has an active edit lock, or update the lock path. Simplest safe approach: **reject rename when the file has an edit lock** with a clear error message. |
| **Name validation** | Backend validates: no path separators, not empty, not `.`/`..`, no trailing spaces/dots (Windows/SMB restriction). Frontend validates the same subset for immediate feedback. |
| **Long filenames** | The `TextField` should handle long names gracefully. No truncation — show the full name. |
| **Accessibility** | Focus moves to the text field on dialog open. Escape closes. Enter confirms. Error announced via `aria-live`. |
| **Linting** | Run Biome (frontend) and mypy (backend) after implementation. |
| **Tests** | Backend: pytest for the endpoint (happy path, 404, 409, 400). Frontend: Vitest for the `RenameDialog` component and the `renameItem` API method. |

---

## 10. Implementation Order

1. Backend storage: `rename_item` in base + SMB implementation
2. Backend model: `RenameRequest`
3. Backend API endpoint + cache helper
4. Frontend API service method
5. Keyboard shortcut definition
6. `RenameDialog` component + strings
7. `FileBrowser.tsx` state, handlers, shortcut wiring, render
8. `FileRow.tsx` context menu integration
9. Tests + lint
