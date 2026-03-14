# Centralized Keyboard Shortcuts System

## Overview

The keyboard shortcuts system provides a centralized, declarative way to manage keyboard shortcuts across viewers and the file browser. Instead of scattering shortcut definitions and tooltip strings across multiple files, bindings live in shared config and are consumed by feature-specific handlers.

## Architecture

### Components

1. **`/frontend/src/config/keyboardShortcuts.ts`**: Central registry of all keyboard shortcut definitions
2. **`/frontend/src/hooks/useKeyboardShortcuts.ts`**: React hook for handling keyboard shortcuts
3. **`/frontend/src/config/browserCommands.ts`**: File-browser command registry used by command palette mode
4. **Feature Components**: Viewers and file-browser surfaces use shortcuts from the registry and inject handlers

### Key Features

- **Single source of truth**: All shortcut keys and labels defined in one file
- **App-wide reusability**: Same shortcuts used across PDF viewer, image viewer, etc.
- **Command discoverability**: File-browser actions are modeled as commands, not only raw keybindings
- **Auto-generated labels**: Display labels auto-generated from shortcut configuration
- **Type safety**: TypeScript interfaces ensure consistency
- **Declarative API**: No imperative event handling code in components

## File Structure

```
frontend/src/
├── config/
│   └── keyboardShortcuts.ts      # Centralized shortcut definitions
│   └── browserCommands.ts        # File-browser command registry
├── hooks/
│   └── useKeyboardShortcuts.ts   # Hook for handling shortcuts
├── pages/
│   └── FileBrowser.tsx           # Registers browser shortcuts and routes actions
└── components/
  └── FileBrowser/
    ├── UnifiedSearchBar.tsx  # Multi-mode quick bar shell
    └── search/               # Quick-nav, filter, and command providers
components/
└── Viewer/
        ├── PDFViewer.tsx         # Uses shortcuts from config
        ├── ImageViewer.tsx       # Uses shortcuts from config
        └── ViewerControls.tsx    # Uses shortcuts for tooltips
```

## Shortcut Definition

### `shortcuts.ts`

Defines shortcut configurations grouped by scope:

```typescript
// Common shortcuts used across all viewers
export const COMMON_SHORTCUTS = {
  CLOSE: {
    id: "close",
    keys: "Escape",
    description: "Close",
    label: "Esc",
    allowInInput: true,
  },
  DOWNLOAD: {
    id: "download",
    keys: "s",
    description: "Download",
    label: "Ctrl+S",
    ctrl: true,
  },
} as const;

// PDF-specific shortcuts
export const PDF_SHORTCUTS = {
  SEARCH: {
    id: "search",
    keys: "f",
    description: "Search",
    label: "Ctrl+F",
    ctrl: true,
    allowInInput: true,
  },
  NEXT_PAGE_ARROW: {
    id: "next-page-arrow",
    keys: "ArrowRight",
    description: "Next page",
    label: "Right / D",
  },
  // ... more shortcuts
} as const;

// Image viewer shortcuts
export const IMAGE_SHORTCUTS = {
  // ... image-specific shortcuts
} as const;
```

### Shortcut Properties

- **`id`**: Unique identifier (string)
- **`keys`**: Key(s) to trigger the shortcut (string or string[])
- **`description`**: Human-readable description (string)
- **`label`**: Display label for tooltips (string, optional - auto-generated if omitted)
- **`ctrl`**: Requires Ctrl/Cmd modifier (boolean, optional)
- **`shift`**: Requires Shift modifier (boolean, optional)
- **`alt`**: Requires Alt modifier (boolean, optional)
- **`allowInInput`**: Works when text inputs are focused (boolean, optional)
- **`priority`**: Priority for overlapping shortcuts (number, optional - higher values checked first, default: 0)

## Usage

### In Viewer Components

```typescript
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/keyboardShortcuts";

const PDFViewer = () => {
  // ... component state and handlers

  useKeyboardShortcuts({
    shortcuts: [
      // Spread shortcut config and add handler
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: onClose,
      },
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
      {
        ...PDF_SHORTCUTS.SEARCH,
        handler: handleOpenSearch,
      },
      {
        ...PDF_SHORTCUTS.NEXT_PAGE_ARROW,
        handler: () => handlePageChange(currentPage + 1),
        enabled: currentPage < numPages, // Optional conditional enabling
      },
      // ... more shortcuts
    ],
    inputSelector: 'input[placeholder="Search"]', // Optional custom selector
  });

  return <div>...</div>;
};
```

### In Control Components (for Tooltips)

```typescript
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/keyboardShortcuts";

const ViewerControls = () => {
  return (
    <IconButton
      onClick={onDownload}
      title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
      aria-label="Download"
    >
      <Download />
    </IconButton>
  );
};
```

The `withShortcut()` function formats the shortcut as: `"Download (Ctrl+S)"`

## File Browser Model

The file browser now uses the centralized shortcut registry together with a command registry. Shortcuts remain defined in `frontend/src/config/keyboardShortcuts.ts`, while discoverable browser actions live in `frontend/src/config/browserCommands.ts`.

### Quick Bar Modes

The file browser now uses one main smart bar plus command mode:

- **Navigate**: the default mode opened by `Ctrl+K`; merges current-pane filtering with directory jump results
- **Commands**: entered directly via `Ctrl+P` or `F1`, or by typing `>` as the first character in the smart bar

The quick bar captures the pane that opened it. In dual-pane mode, results continue to target that pane even if the other pane becomes active before selection.

### Current File Browser Shortcuts

- `Ctrl+K`: Open Smart Navigation
- `Ctrl+Alt+F`: Compatibility alias for Smart Navigation
- `Ctrl+P`: Show Commands
- `F1`: Alternate binding for Show Commands
- `Ctrl+,`: Open Settings
- `?`: Show keyboard shortcuts help
- `Backspace`: Go up one directory
- `Ctrl+R`: Refresh file list
- `F2`: Rename focused item
- `Delete`: Delete focused item
- `F7`: Create new directory
- `Shift+F7`: Create new file
- `Ctrl+Enter`: Open focused file in companion app
- `Ctrl+B`: Toggle dual-pane view
- `Ctrl+1`: Focus left pane
- `Ctrl+2`: Focus right pane
- `Tab`: Switch active pane
- `F5`: Copy to other pane
- `F6`: Move to other pane

### Command Registry Rules

Each browser command definition includes:

- `id`: stable internal identifier
- `title`: user-facing command label
- `category`: command-palette grouping
- `defaultShortcutIds`: links back to centralized shortcut definitions when a shortcut exists
- `isEnabled(context)`: context-aware availability check
- `run(context)`: action handler
- `selectionFocusTarget`: post-selection focus behavior for quick-bar flows

This split keeps keybinding policy centralized while allowing the browser command palette to expose actions even when users do not know the shortcut.

### Focus and Interaction Rules

- Opening the quick bar focuses the input.
- Selecting a navigation or filter result returns focus to the relevant file list.
- Selecting commands that switch quick-bar modes keeps focus in the quick bar.
- Commands that open a dialog or settings surface do not force focus back to the file list.
- Pane-switching shortcuts do not fire while the quick bar input is focused.
- Typing `>` as the first character in the smart bar switches the bar into command mode without leaving the surface.

## Key Auto-Formatting

The system automatically formats special keys for better display:

- `ArrowRight` → `Right`
- `ArrowLeft` → `Left`
- `ArrowUp` → `Up`
- `ArrowDown` → `Down`
- `Escape` → `Esc`
- `" "` (space) → `Space`

Multi-key shortcuts are joined with ` / `:
- `keys: ["d", "D", "ArrowRight"]` → `"Right / D"`

## Modifiers

Modifiers are automatically added to labels:
- `ctrl: true` → Adds `Ctrl+` (or `Cmd+` on macOS)
- `shift: true` → Adds `Shift+`
- `alt: true` → Adds `Alt+`

Example:
```typescript
{
  keys: "r",
  description: "Rotate left",
  shift: true,
}
```
Generates label: `"Shift+R"`

## Benefits

### Before (Decentralized)

**Problems:**
- Shortcut keys defined in PDFViewer.tsx
- Display labels defined separately in pdfShortcuts.ts
- Tooltip helpers specific to PDF viewer
- Duplication when adding shortcuts to ImageViewer
- Easy to have inconsistencies

```typescript
// PDFViewer.tsx
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 's' && event.ctrlKey) {
    handleDownload();
  }
  // ... 140+ more lines
};

// pdfShortcuts.ts
export const PDF_SHORTCUTS = {
  DOWNLOAD: "Ctrl+S",
};

// ViewerControls.tsx
import { PDF_SHORTCUTS } from "./pdfShortcuts";
title={`Download (${PDF_SHORTCUTS.DOWNLOAD})`}
```

### After (Centralized)

**Benefits:**
- Single source of truth for all shortcuts
- Keys and labels defined together
- Auto-generated labels from configuration
- Easy to reuse across viewers
- Type-safe and consistent

```typescript
// config/keyboardShortcuts.ts
export const COMMON_SHORTCUTS = {
  DOWNLOAD: {
    id: "download",
    keys: "s",
    description: "Download",
    label: "Ctrl+S",
    ctrl: true,
  },
};

// PDFViewer.tsx
useKeyboardShortcuts({
  shortcuts: [{ ...COMMON_SHORTCUTS.DOWNLOAD, handler: handleDownload }],
});

// ViewerControls.tsx
title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
```

## Context-Aware Shortcuts

### The Pattern

For shortcuts that need different behavior depending on application state (like ESC closing a search panel vs. closing the viewer), use a **single context-aware handler** rather than multiple overlapping shortcuts.

**Example: Contextual ESC behavior**

```typescript
/**
 * Context-aware Escape handler
 * Checks state to determine appropriate action
 */
const handleEscape = useCallback(() => {
  if (searchPanelOpen) {
    // Close search panel and clear results
    setSearchPanelOpen(false);
    setSearchText("");
    setMatchLocations([]);
    setCurrentMatch(0);
  } else {
    // Close the entire viewer
    onClose();
  }
}, [searchPanelOpen, onClose]);

// Register single Escape shortcut with context-aware handler
useKeyboardShortcuts({
  shortcuts: [
    {
      ...COMMON_SHORTCUTS.CLOSE,
      handler: handleEscape, // One handler, multiple behaviors
    },
  ],
});
```

**Why This Pattern?**

✅ **Single responsibility**: One shortcut registration, one handler
✅ **Clear logic**: Behavior determined by component state
✅ **No conflicts**: Avoids overlapping shortcut registrations
✅ **Easy to extend**: Add more conditions as needed
✅ **Maintainable**: All context logic in one place

**Anti-pattern to avoid:**
```typescript
// ❌ DON'T: Multiple overlapping shortcuts
shortcuts: [
  { keys: 'Escape', handler: onClose },           // Which runs first?
  { keys: 'Escape', handler: closeSearchPanel },  // Conflict!
]
```

### Priority System (Advanced)

For rare cases where you need multiple handlers for the same key, use the `priority` field:

```typescript
shortcuts: [
  {
    keys: 'Escape',
    handler: handleSpecialCase,
    priority: 10, // Checked first
    enabled: isSpecialMode,
  },
  {
    keys: 'Escape',
    handler: handleNormalCase,
    priority: 0, // Default priority, checked second
  },
]
```

Higher priority shortcuts are evaluated first. However, **context-aware handlers are preferred** over the priority system for better maintainability.

## Adding New Shortcuts

1. **Define in `config/keyboardShortcuts.ts`:**
   ```typescript
   export const PDF_SHORTCUTS = {
     // ... existing shortcuts
     PRINT: {
       id: "print",
       keys: "p",
       description: "Print",
       label: "Ctrl+P", // or omit for auto-generation
       ctrl: true,
     },
   };
   ```

2. **Use in viewer component:**
   ```typescript
   useKeyboardShortcuts({
     shortcuts: [
       {
         ...PDF_SHORTCUTS.PRINT,
         handler: handlePrint,
       },
     ],
   });
   ```

3. **Add tooltip to control button:**
   ```typescript
   <IconButton
     title={withShortcut(PDF_SHORTCUTS.PRINT)}
     onClick={handlePrint}
   >
     <Print />
   </IconButton>
   ```

## Testing

The system maintains compatibility with existing tests. Tests can:
- Simulate keyboard events as before
- Assert on button tooltips using `withShortcut()` output
- Verify shortcuts are registered correctly

Example:
```typescript
it("downloads on Ctrl+S", () => {
  render(<PDFViewer {...props} />);

  fireEvent.keyDown(window, {
    key: "s",
    ctrlKey: true,
  });

  expect(mockDownloadHandler).toHaveBeenCalled();
});
```

## Future Enhancements

Possible improvements:
- **App-wide command palette**: Extend the command model beyond the file browser
- **Customization**: Allow users to customize shortcuts
- **Context-aware surfacing**: Show different shortcuts based on current view/mode
- **Conflicts detection**: Warn about conflicting shortcuts at build time
- **Platform-specific**: Different shortcuts for Windows/Mac/Linux

## Related Files

- `frontend/src/config/keyboardShortcuts.ts` - Shortcut definitions
- `frontend/src/config/browserCommands.ts` - File-browser command definitions
- `frontend/src/hooks/useKeyboardShortcuts.ts` - Hook implementation
- `frontend/src/pages/FileBrowser.tsx` - Browser-level shortcut registration and mode routing
- `frontend/src/components/FileBrowser/UnifiedSearchBar.tsx` - Multi-mode quick bar UI
- `frontend/src/components/Viewer/PDFViewer.tsx` - PDF viewer usage
- `frontend/src/components/Viewer/ImageViewer.tsx` - Image viewer usage
- `frontend/src/components/Viewer/ViewerControls.tsx` - Tooltip usage
- `documentation_developers/KEYBOARD_NAVIGATION_IMPLEMENTATION_SPEC.md` - File browser keyboard navigation upgrade spec
- `documentation_developers/KEYBOARD_SHORTCUTS_REFACTORING.md` - Original refactoring doc

## Migration Guide

For components using old keyboard shortcut patterns:

1. Import centralized shortcuts:
   ```typescript
   import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/keyboardShortcuts";
   import { useKeyboardShortcuts, withShortcut } from "../../hooks/useKeyboardShortcuts";
   ```

2. Replace imperative event handling:
   ```typescript
   // OLD:
   useEffect(() => {
     const handleKeyDown = (event: KeyboardEvent) => {
       if (event.key === 's' && event.ctrlKey) handleDownload();
       // ...
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, [dependencies]);

   // NEW:
   useKeyboardShortcuts({
     shortcuts: [
       { ...COMMON_SHORTCUTS.DOWNLOAD, handler: handleDownload },
     ],
   });
   ```

3. Update tooltips:
   ```typescript
   // OLD:
   title="Download (Ctrl+S)"

   // NEW:
   title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
   ```

4. Remove old shortcut definition files (like `pdfShortcuts.ts`)
