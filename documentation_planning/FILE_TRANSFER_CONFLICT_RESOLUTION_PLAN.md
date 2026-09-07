# File Transfer Conflict Resolution Plan

## Purpose

This document defines a consistent conflict-resolution design for regular-file copy and move operations. It addresses the missing **Overwrite** and **Overwrite only older** choices in the F5 conflict dialog and applies the same behavior to every supported source and destination combination.

The design follows normal file-manager semantics: an overwrite replaces the destination that exists at the time of final commit. It does not attempt to promise a cross-provider compare-and-swap guarantee that ordinary filesystems do not provide.

## Scope

### Included

- F5 copy to other pane and the corresponding command-palette command.
- F6 move to other pane and the corresponding command-palette command.
- Direct SMB-to-SMB transfers.
- Local-to-local transfers through Companion.
- Local-to-SMB and SMB-to-local browser-relayed transfers.
- Regular-file conflicts in single-item and batch operations.
- Recursive directory merging through child-by-child transfer coordination.
- `ask`, `skip`, `replace`, `replace_older`, rename, and apply-to-all behavior.

### Excluded

- Recursive deletion or replacement of an existing destination directory.
- Changes to archive extraction, which already owns a separate, richer conflict workflow.
- A storage-plugin redesign. The implementation should use the current SMB and Companion transfer boundaries.

## User-Visible Semantics

| Resolution | Result |
| --- | --- |
| Skip | Leave source and destination unchanged for this item. |
| Overwrite | Replace the destination regular file with the source. |
| Overwrite only older | Replace only when the source modification time is strictly newer than the destination examined immediately before commit; otherwise skip the item. |
| Rename | Copy or move under a new destination name using create-only behavior. |

Timestamp comparison is deliberately conservative: equal, missing, mixed-zone, or otherwise incomparable timestamps must not replace the target.

An overwrite is last-writer-wins at commit time, as users expect from a file manager. The implementation must still guarantee that a failed or cancelled transfer does not expose partial destination content.

### Directory merge semantics

When the source and destination entries are both directories, merge the source tree into the existing destination directory. Do not show a conflict for that directory pair and do not offer Rename for it. Before traversal, the coordinator classifies the top-level target: create the root when it is absent, merge when it is a directory, and show the normal Skip-or-Rename type-mismatch dialog when it is a regular file.

- Preserve destination entries that do not exist in the source tree.
- Create source-only child entries in the destination tree.
- Recursively merge child directories with the same name.
- Apply the regular-file conflict policy only when two child entries are regular files with the same name.
- Traverse the source tree in the frontend and execute each child through the existing one-item transfer path. When a child returns 409, show the existing dialog, retry only that child with its decision, then continue. Do not retry the root directory or add a durable directory-transfer session.
- Treat file-versus-directory and directory-versus-file child collisions as explicit conflicts. Offer Skip or Rename to a new sibling name of the source type; do not offer Overwrite or Overwrite only older, and do not delete or replace either side implicitly.
- For a move, remove each source file only after its destination file has committed successfully. After all successfully processed children of a source directory are handled, remove that source directory bottom-up using an empty-directory-only operation. If concurrent content prevents that removal, retain the source directory and report the factual partial result; never use recursive deletion to complete a move.
- Continue a tree after a child conflict has been resolved. Stop the current tree on cancellation, `outcome_unknown`, or an unrecoverable child failure, report its factual partial result, and leave later source entries untouched. The existing batch behavior then decides whether to continue with the next top-level selection.

## Transfer Algorithm

Every regular-file destination uses this flow, independent of provider:

1. Create a unique temporary sibling file in the destination directory.
2. Stream the source to the temporary file while tracking progress and cancellation.
3. Flush and close the temporary file; verify the source has not changed where the current transfer code already supports that check. For a direct provider-managed move, retain the source read handle through destination commit and use it for source removal where the provider supports it. A browser relay passes the source modification time with the stream request for `replace_older`; it does not add a separate source-validation or two-phase promotion protocol where retained-handle deletion is unavailable.
4. For `replace_older`, observe the current destination immediately before promotion. If it is no longer an older regular file, discard the temporary file and return `skipped` or a fresh conflict as appropriate.
5. Atomically promote the temporary file to the destination path with replacement enabled.
6. On failure before promotion, clean up the temporary file and leave the prior destination intact.
7. On success, set `ContentTransferResult.replaced` to `true` when an existing regular target was replaced and update the relevant directory caches.

The staging file must live in the destination directory so its promotion is within one filesystem/share. It must have an unguessable operation-scoped name (format: `.filename.ext.sambee-stage-<uuid>`) and be cleaned up on cancellation, transfer failure, and final-promotion failure.

The directory coordinator creates a missing child directory only after classifying its destination sibling. If creation reports that the name appeared concurrently, it re-lists that one destination parent and applies the resulting directory-merge or type-mismatch rule. A create race must not surface as an unclassified transfer failure.

## Provider Implementations

### SMB destination

Extend the existing staged SMB writer path with an atomic rename/replace promotion. The installed `smbclient` library exposes this as `smbclient.renames(stage_path, target_path, **auth_kwargs)`, which sends SMB `FileRenameInformation` with `replace_if_exists=True` in one server-side `SET_INFO` operation. Both direct SMB copy and the `transfer-stream` browser-relay endpoint must use it.

The current create-only path uses `smbclient.rename(...)`, which sets `replace_if_exists=False`. For `replace` and a qualifying `replace_older`, replace the current `remove(target)` followed by `rename(stage, target)` sequence with `renames(stage, target)`. The replace path must never delete the existing target before the staging file is complete.

The server can reject promotion for a directory target, a lock/share-mode conflict, read-only attributes, or insufficient access. In each case, discard the stage and preserve the existing target. Directory-to-directory copies use recursive merge and delegate child-file replacement to this same path.

### Local destination

Extend the Companion staged-local-copy flow so its final promotion replaces an existing regular destination. Use the platform-native same-directory replacement operation:

- Unix: `rename`.
- Windows: call `ReplaceFileW(target, stage, NULL, REPLACEFILE_WRITE_THROUGH, NULL, NULL)` on a blocking thread. `ReplaceFileW` replaces an existing regular target in one filesystem operation; its bindings are already available through Companion's `windows` dependency with `Win32_Storage_FileSystem` enabled. Do not request a backup file and do not use `MOVEFILE_COPY_ALLOWED`.

`ReplaceFileW` requires an existing target. If it reports that the target disappeared before promotion, discard the stage and retry through the existing create-only resolution path; if that path races with a new target, return a refreshed conflict. For sharing violations, access failures, or a non-file target, discard the stage and preserve the target. Map an unobservable post-call outcome to `outcome_unknown`.

No local operation may emulate replacement through delete-then-rename.

### Cross-provider transfers

Cross-provider copies use the destination implementation above. The source provider supplies the stream and its observed modification time; it does not determine conflict semantics. Add an optional RFC 3339 UTC `source_modified_at` parameter to both SMB and Companion `transfer-stream` endpoints, populated from the source metadata the frontend already reads before starting the relay. Omit the parameter when the source metadata has no modification time. Each destination endpoint validates it before consuming the request body.

For `replace_older`, when the destination exists, a missing or invalid source modification time returns `skipped` before the endpoint consumes the stream. Immediately before promotion, the destination re-reads its target metadata and applies the existing strict-newer comparison. A changed target type produces a fresh conflict.

For browser-relayed cross-provider moves, the source response and the later source-deletion request are separate operations, so a source read handle cannot be retained through destination commit. Use the existing best-effort source deletion path and accept the theoretical concurrent-rewrite race rather than adding a durable relay protocol. Direct provider-managed transfers may use retained-handle removal where their source implementation supports it. If source removal fails after a committed replacement, report `completed_with_source_retained`; do not attempt to roll back the destination.

## Backend Changes

1. Extend the existing staged destination write APIs in the SMB backend and Companion to accept a final-promotion mode: create-only or replace. In the SMB backend, implement replace with `smbclient.renames(...)`, not delete-then-rename.
2. Change `resolve_regular_file_transfer` and its call sites so `replace` and `replace_older` invoke the replace-capable staging operation instead of treating replacement as unavailable.
3. Update direct SMB copy and move routes in `backend/app/api/browser.py`.
4. Update both `transfer-stream` endpoints to accept, validate, and use `source_modified_at` for `replace_older`, then stage and promote with the requested policy instead of rejecting all existing targets except Skip.
5. Update cross-connection copy and move orchestration in `backend/app/services/cross_connection.py` for individual regular-file replacement only; directory roots are owned by the frontend tree coordinator.
6. Update Companion regular-file copy and move execution to replace staging gates currently marked `replacement_supported: false`.
7. Keep backend directory-copy behavior create-only. The frontend tree coordinator implements directory merge by composing existing directory-create and individual child-transfer operations.
8. Add a narrow empty-directory-only removal operation for local and SMB storage. It must fail without deleting when the directory contains entries, including entries added concurrently. Its result must distinguish `not_empty` from access, transport, missing-source, and other operational failures; expose it through the existing storage operation boundary for bottom-up directory moves.
9. Preserve idempotency semantics: a transport retry replays its prior factual result; a user-selected conflict resolution creates a new transfer attempt.

The existing target-resolution types remain the policy authority. Avoid a new provider-capability model or a parallel policy enum.

## Frontend Changes

1. In `frontend/src/pages/FileBrowser.tsx`, offer Skip, Overwrite, Overwrite only older, and Rename for regular-file-to-regular-file conflicts.
2. Add a shared `executeTransferTree` coordinator for top-level directories. It owns every directory transfer: detect the directory before calling `executeTransfer`, never call `executeTransfer` for a directory, and bypass the existing `api.transferDirectoryAcrossBackends` / `copyDirectoryContentsAcrossBackends` staged-directory relay. Retire those legacy frontend helpers once no route reaches them.
3. The coordinator first classifies the top-level destination sibling: absent creates the root directory, a directory starts a merge without a dialog, and a regular file opens the type-mismatch dialog. It then lists source children, classifies destination siblings from a listing of the corresponding destination parent, creates missing destination directories, and recurses into same-name directories. On a directory-create race, re-list that parent and reclassify the child. It calls the existing `executeTransfer` path only for regular-file leaves and type-mismatched children.
4. On a child 409, show the existing dialog and retry only that child. Do not show a dialog for a root directory-to-directory merge or repeat completed children. Stop the current tree on cancellation, `outcome_unknown`, or an unrecoverable child failure; the outer batch loop retains its existing policy for later top-level items.
5. For a file/directory type mismatch, allow only Skip and Rename to a new sibling path; never offer an action that deletes the existing entry.
6. Replace the current `skip-all` special case with a persistent remaining-items policy: `ask`, `skip`, `replace`, or `replace_older`. Use it from the start of every later child transfer.
7. Extend the dialog's apply-to-all contract to include Overwrite only older. Rename remains per-conflict because every item needs a distinct target name.
8. When a retry yields a refreshed 409 conflict, reopen the same dialog with the returned metadata for every action, not just Rename.
9. Add a `removeEmptyDirectory` operation beside the existing generic create/remove operations and invoke it bottom-up only after a directory's successful children have been processed. Its `not_empty` result leaves the source directory intact and records a source-retained partial warning; other cleanup failures remain operational errors.
10. Preserve current cancellation and terminal-status behavior. While a tree is active, its coordinator temporarily owns the existing progress display and conflict-dialog progress, publishing `completed/discovered` child counts. Suppress outer top-level progress updates until that tree terminates, then resume them for the next top-level selection. Keep affected paths and counts in coordinator-local state for logs and pane refreshes; do not widen `ContentTransferResult` merely to carry tree progress.

The dialog component already renders the two missing radio options when its owner passes them in; this work is primarily orchestration and transfer support.

## Error Handling

- A cancelled or failed stage leaves the previous destination untouched.
- A failed promotion leaves the outcome factual: report an error only when the destination can be observed unchanged; otherwise report `outcome_unknown`.
- If the destination changes type before a `replace_older` commit, show a fresh conflict instead of deleting or replacing it.
- Where a direct provider-managed transfer supports source snapshot validation or retained-handle deletion, preserve its existing source-changed handling. Browser-relayed transfers use separate source-stream and source-deletion requests, rely on successful streaming and size validation, and accept the theoretical concurrent-rewrite case without a separate two-phase validation protocol.
- A cancelled or failed directory merge can have `destination: mutated`. Retain entries that were not successfully transferred, along with any source directories that cannot be removed while empty-only cleanup runs. Keep completed-entry counts and affected paths in coordinator-local state for logging and refresh.
- Log the operation ID, source, destination, policy, phase, and failure category without logging file contents or credentials.

## Test Plan

### Shared policy tests

- `replace` selects replacement for an existing regular target.
- `replace_older` replaces only when the source is strictly newer.
- Equal, older, absent, and incomparable timestamps result in skip.
- Relayed `replace_older` receives and validates `source_modified_at`; a missing value skips an existing target without consuming its stream.
- Same-name directories merge recursively without a root conflict or rename choice.
- A top-level directory targeted at an existing regular file offers only Skip and Rename; an absent top-level target is created before traversal.
- Source-only and destination-only directory children are preserved correctly.
- File/directory and directory/file child collisions offer only Skip and Rename.
- A destination directory create race re-lists and merges or reports a type mismatch according to the newly observed sibling.
- Bottom-up move cleanup removes only empty source directories, reports `not_empty` as a source-retained partial outcome, and distinguishes it from an operational cleanup failure.
- A resolved child conflict continues the current tree, while cancellation, an unknown outcome, or an unrecoverable child error stops it and leaves later source entries untouched.
- Direct provider-managed moves use retained-handle source removal where supported; browser-relayed moves retain the existing best-effort source deletion behavior.
- A directory tree's child-level `completed/discovered` progress replaces outer top-level progress while the tree is active, including when it opens a conflict dialog.

### Provider tests

For SMB and local destinations:

- Successful replacement reports `completed`, destination mutated, and `replaced: true`.
- A write, flush, cancellation, or staging failure preserves the old destination.
- A promotion failure removes the stage and reports the correct factual result.
- No partial destination file is observable during a successful replacement.

### Workflow tests

- F5 and F6 submit `replace` and `replace_older` correctly.
- Command-palette copy and move use the same execution path.
- Apply-to-all works for Skip, Overwrite, and Overwrite only older.
- A child retry conflict reopens the dialog with fresh metadata without repeating completed tree entries.
- SMB-to-SMB, local-to-local, local-to-SMB, and SMB-to-local copies succeed with replacement.
- F5 and F6 merge same-name source and destination directories, resolving only colliding child files.
- Cancellation and late child failures report a partially mutated destination and leave unprocessed source entries intact.
- Cross-provider move reports `completed_with_source_retained` when destination commit succeeds but source deletion fails.

## Delivery Order

1. Add and test atomic staged replacement for local and SMB destination writers.
2. Wire direct and relayed copy operations to `replace` and `replace_older`, including relay source modification times.
3. Enable the frontend actions and batch policies.
4. Add the child-by-child frontend directory merge coordinator, retire the legacy cross-provider staged-directory relay, then wire bottom-up empty-directory move cleanup while preserving source-retention outcomes for cross-provider moves.
5. Run focused backend, Companion, and frontend tests, then exercise F5 and F6 manually across local and SMB panes.

This order keeps the UI hidden until the underlying operation is correct, while avoiding an unnecessary plugin or provider-capability architecture.
