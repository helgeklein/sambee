# File Browser Transfers Proposal

## Purpose

Implement two explicit file-browser commands:

- **Download**: download one selected regular file immediately; download a ZIP when the selection contains multiple entries or any directory.
- **Upload**: choose and upload one or more local files into the current physical directory.

The commands must be available in the desktop selection command bar. On mobile, Download appears in the selected-items menu alongside Create archive and Delete, and in the per-item menu for direct single-item download. Upload belongs in the compact create/actions menu because its destination is the current directory, not an existing item.

## Current State

- The centralized operation registry in `frontend/src/pages/FileBrowser/fileOperationActions.ts` provides placements for desktop and compact controls.
- `api.downloadFile()` already downloads one protected file.
- The ZIP virtual-content provider advertises download capability, and the authenticated archive-member endpoint validates and streams one requested member. Additional virtual providers are planned for the storage plugin system.
- The archive-creation workflow already provides manifest validation, portable ZIP writing, cancellation, and safe cleanup. Downloads can reuse it with a private temporary destination rather than writing a ZIP into user storage.
- `backend/app/services/archive/creation.py` already has recursive manifest construction and portable ZIP writing primitives.
- The copy/transfer pipeline already provides target-resolution policy, staged promotion, progress, and structured outcomes, including an unknown outcome when an interrupted destination request may have committed. User uploads should reuse that pipeline instead of the legacy multipart endpoint, which overwrites its target by design.

## Product Behavior

### Download

| Selection | Result |
| --- | --- |
| One regular file | Start its direct download immediately. |
| One regular virtual member | Validate and stream the original member immediately. |
| One directory | Stream a ZIP containing the directory. |
| Multiple files and/or directories | Stream one ZIP containing all selected roots. |
| One virtual directory | Stream a ZIP containing that directory and its safe descendants. |
| Multiple virtual files and/or directories from the same provider source | Stream one ZIP containing the selected roots and their safe descendants. |
| No selection, unreadable item, mixed physical/virtual selection, or incompatible virtual sources | Disable the command and explain why. |

In this iteration, virtual downloads are supported for ZIP members only. Other virtual providers remain disabled until they implement and verify equivalent download behavior.

Multi-item download selection is limited to immediate items in one displayed directory. The selected item names are the ZIP's top-level entries: selecting `folder1/`, `folder2/`, and `file1` produces `folder1/`, `folder2/`, and `file1` at the ZIP root. Each selected directory emits its explicit directory entry and all descendants recursively beneath that directory; the selected items' source parent is never included. Virtual selections must additionally come from one provider-defined source, such as one ZIP archive. The UI selection set removes exact duplicates; provider-specific validation rejects malformed, conflicting, or different-parent crafted requests before manifest construction. The compact item action operates on that immutable item context, not an incidental selection. The desktop action uses the selected entries. Do not assign a keyboard shortcut in this iteration: `Alt+F5` is already reserved for persistent archive creation.

### Upload

The command opens a native file picker with `multiple=true` and no type filter. It uploads a flat file selection into the active physical directory; directory picking and preservation of local directory structure are out of scope.

1. Each proposed destination is the active physical directory plus that source filename.
2. Process files sequentially through the existing protected single-file transfer contract. This keeps memory and connection pressure bounded and makes conflict decisions deterministic.
3. If a destination conflicts, show the established conflict dialog for that file and require **overwrite**, **rename**, or **skip/cancel**. Never overwrite implicitly.
4. If two selected local files have the same filename, resolve the later file as a normal conflict after the earlier result; it may be renamed or skipped.
5. Show queued, active, completed, skipped, failed, cancelled, and outcome-unknown counts. Cancelling stops the queue and aborts the current request, leaving already completed uploads intact. If the destination may have committed before the abort, report that file as outcome unknown, not cancelled; do not retry it automatically.
6. Refresh only the destination pane after each completed upload and after an outcome-unknown result, preserving current selection and focus where possible. At completion, display a summary that identifies skipped, failed, and outcome-unknown files.

The command is disabled for virtual/archive locations, no selected writable connection, and providers without verified upload support. It is a pane command; it does not belong in the per-item menu.

## Architecture

### Frontend command integration

1. Add `download` and `upload` operation IDs to `fileOperationActions.ts`.
2. Define placements and priorities through the existing registry:
   - `download`: desktop selection command bar; compact selected-items menu with Create archive and Delete; and compact item menu for one-item actions.
   - `upload`: desktop pane command bar and compact create/actions menu.
3. Add translations, tooltips, and policy availability consistent with the existing action IDs. Do not add command-palette commands in this iteration: its separately maintained registry and availability context would duplicate operation policy.
4. Select the download executor from the immutable `ContentItemHandle` rather than only from a path string:
   - one physical file delegates to `api.downloadFile()`;
   - one ZIP virtual file uses the existing archive-member endpoint with `download=true` and raw content semantics;
   - one physical directory or multiple compatible physical items invoke `api.downloadSelectionArchive()`;
   - one ZIP virtual directory or multiple compatible ZIP items from the same archive invoke the ZIP selection-download request.
5. Add physical and ZIP selection-download request methods with the existing bearer or Companion authentication-header strategy; no access token may appear in a query string.
6. Extract the destination-publish half of the existing cross-provider relay into one helper shared by copy/move and browser-file publishing. The upload caller supplies `File.stream()`, the file's exact name, size, last-modified timestamp, `AbortSignal`, progress callback, destination, and target-resolution policy; the helper retains authentication headers, request-body fallback, conflict handling, and `ContentTransferResult` normalization. Keep copy/move's storage-item coordination and behavior unchanged; reuse its conflict dialog and result presentation without adding a batch upload protocol.
7. Show an indeterminate, cancellable **Preparing download** state while a multi-item ZIP is built. Do not promise percentage or per-member progress without a separate status channel. Cancellation aborts the request; the provider observes the disconnected request at manifest/write cancellation points and deletes its owned temporary artifact. In this iteration, use the existing authenticated fetch-to-`Blob` download path and shared link-based save helper for completed ZIPs; all generated ZIPs use the fixed filename `Sambee-download.zip`, so the client does not parse `Content-Disposition`. Do not introduce File System Access API streaming. The temporary-archive cap bounds artifact size but does not remove the browser-memory cost, which is a follow-up concern. For uploads, show per-file and aggregate queue state.

### Temporary archive download service

Implement the same request-scoped download-artifact lifecycle in each provider: the Python backend for SMB and Companion's Rust archive implementation for local drives. Each creates the requested ZIP in a provider-local private temporary directory, streams the completed artifact to the browser, and deletes it. Share the behavioral contract and provider-contract tests, not a cross-language archive implementation.

Add the administrator-controlled **Temporary archive download size limit** system setting. It stores a byte value, defaults to **250 MiB** ($250 \times 1024^2$ bytes), uses MiB increments in the UI, and applies independently to each generated download artifact. Place it in Advanced settings with the archive/PDF resource controls and validate it server-side through the centralized integer-setting definitions. For a Companion-owned download, the backend creates a minimal short-lived, opaque download-capability session that holds the effective limit and provider scope; Companion retrieves that server-authoritative value before creating the artifact. Reuse the existing archive capability/session security patterns, but do not force a temporary download into the durable archive-operation lifecycle, which is designed for persistent create/extract operations and their checkpoints. The setting must not be user- or connection-configurable.

Reuse existing archive-creation infrastructure through its source and destination protocols:

- For physical selections, pass the existing SMB backend and normalized same-parent selected roots to the archive-creation manifest builder, mapping each root to its basename as the ZIP top-level entry; do not add a physical source wrapper.
- A ZIP archive-creation source adapts selected ZIP files and directories to the existing source contract. Reuse it for persistent archive creation and temporary downloads without introducing a general virtual-provider capability yet.
- `TemporaryArchiveDestination` implements the existing archive-creation destination/writer contract for a private local artifact.

Each provider's existing archive-creation core owns canonical member paths, duplicate detection, recursive manifest construction, entry metadata, ZIP generation, cancellation, and partial-output cleanup. Physical and ZIP sources validate their own path syntax and preserve each selected root before delegating to their provider's core. HTTP routes handle request decoding, authentication, and adapter construction, then delegate to the provider-local workflow.

The service should:

- authenticate and authorize every request using the same provider rules as direct download;
- validate each selected root before archive creation, rejecting empty input, exact duplicates, invalid paths, unsupported root item types, incompatible sources, and roots that are not immediate siblings in one source directory;
- build the existing complete archive manifest before writing, so duplicate paths, unreadable descendants, unsafe virtual members, and source validation failures return a structured error rather than a partial download;
- create a cryptographically random artifact name in a private directory outside user-visible storage, with restrictive permissions and no user-controlled path component;
- enforce the configured temporary-archive size limit in the destination writer: before accepting each ZIP output chunk, verify that the chunk would not make the artifact exceed the limit; raise a specific `temporary_archive_size_limit_exceeded` error and delete the owned artifact when it would;
- write through the existing portable archive creator with its strict all-or-nothing behavior; cancel or failure deletes the owned temporary artifact;
- stream only a completed, validated ZIP with `Content-Disposition: attachment; filename="Sambee-download.zip"`;
- delete the artifact when the response finishes or the client disconnects, and run startup/periodic stale-artifact cleanup for process crashes or forced termination.

The response begins only after archive creation completes. This deliberately restores the archive creator's all-or-nothing semantics: a source change, creation error, or temporary-archive size-limit breach fails the download before response headers, rather than delivering a partial ZIP or `download-errors.txt`. It trades time-to-first-byte and temporary disk use for reuse, deterministic validation, and a valid completed artifact.

For SMB, the backend uses the existing SMB archive-creation source directly with a backend-local `TemporaryArchiveDestination`. For local drives, extend Companion archive creation with an optional internal output-path parameter. Its normal drive-root-bound source validation, manifest creation, and ZIP writer remain in use, but a temporary-download caller may supply a capability-scoped path inside Companion's private temp-artifact store. The parameter is not exposed to browser clients or normal persistent archive creation, and Companion rejects arbitrary or non-private output paths. Both temporary writers enforce the same effective size limit before every write and delete a limit-exceeded artifact. In both cases, the browser requests the archive from the same provider that created it.

The ZIP source adapts validated members into the archive-creation source contract, including recursive directories and explicit empty directories, for both persistent archive creation and temporary download artifacts. Gate ZIP commands on ZIP-specific support and same-archive compatibility. When another virtual provider needs downloads, define a general capability from both implementations rather than adding ZIP assumptions such as central-directory inspection or encrypted-member rejection to the provider interface now.

### Browser-file publish operation

Treat each selected browser `File` as an external input to a focused browser-file publish operation. The client streams `File.stream()` to the existing staged destination-transfer contract with the file's exact size and last-modified timestamp. It then receives the same `ContentTransferResult` used by copy.

Keep storage-to-storage transfer coordination and behavior unchanged while moving its destination request into the shared publish helper. The browser-file caller reuses its target-resolution policies, conflict dialog, progress/result presentation, and destination behavior:

- `ask`: return structured conflict information before replacement;
- `overwrite`, `rename`, and `skip`: resolve only after an explicit user decision;
- stage request bytes privately, validate the expected byte count, and promote atomically so a cancellation or network failure cannot leave a partial target; if the response is lost around commit, retain the existing `outcome_unknown` result;
- reject destinations outside the current authorized location and retain provider write-access checks;
- return the final path and metadata so the client can refresh accurately.

For SMB and local drives, reuse the existing provider-specific `POST /browse/{connection_id}/transfer-stream` endpoint with the established bearer or Companion authentication headers; both already stage request bytes privately, validate their expected size, resolve conflicts, and promote atomically. Do not change the legacy multipart editor-save route. The browser-file publish operation replaces only the source-fetch half of the existing cross-provider relay, so Upload is available for both writable SMB and Companion local-drive destinations.

A multi-file upload remains a sequential frontend queue, not a server-side transaction. Completed transfers stay uploaded if a later file fails or the user cancels. The queue uses the existing copy conflict dialog and per-file progress/result model, then reports successes, skips, failures, cancellations, and unknown outcomes without rollback or automatic retry of an uncertain file.

## Test Plan

### Backend

- Direct file behavior remains unchanged.
- Temporary archive workflow: authorization, complete manifest validation, same-parent root enforcement, ZIP-root layout, recursive directories, empty directories, Unicode names, exact-duplicate rejection, invalid paths, 250 MiB default size limit, custom-limit validation, pre-write limit enforcement, limit-exceeded cleanup and error reporting, fixed `Sambee-download.zip` disposition, cancellation on request disconnect, strict failure cleanup, completed archive contents, response-finish deletion, disconnect deletion, and stale-artifact cleanup.
- ZIP virtual archive-creation source: direct raw-member attachment; selected-root validation; same-archive, same-parent file and directory ZIP contents and paths; empty-directory preservation; unsafe/encrypted/missing-root rejection; and reader cleanup. Cover persistent archive creation and temporary-download artifacts through this same source implementation.
- Companion download capability session: authenticated issuance, random opaque identifier, short expiry, provider scope, server-authoritative cap retrieval, expired/replayed-session rejection, and no client-supplied cap acceptance.
- Provider contract: test the same artifact size, validation, completion, cancellation, streaming, and cleanup behavior against the separate SMB backend and Companion local-drive implementations.
- Browser-file publish: SMB and Companion authorization, writable-location checks, each conflict policy, atomic promotion, cancellation, commit-time outcome uncertainty, partial-request cleanup, byte-count mismatch, provider timeout/error handling, and standardized transfer result.
- Run the same browser-file publish provider-contract suite for SMB connections and local drives served by Companion.

### Frontend

- Extend `fileOperationActions` tests for placements, ordering, scopes, and disabled explanations.
- Unit-test physical and ZIP single-file delegation, physical and ZIP selection request construction/authentication, same-archive compatibility explanations, indeterminate preparation state, cancellation, size-limit error presentation, pre-response creation failures, the shared Blob download helper with `Sambee-download.zip`, browser-file publishing, multi-file picker handling, sequential queue ordering, duplicate filenames, per-file conflict decisions, unknown-outcome reporting without automatic retry, partial completion summaries, and destination-pane refresh after completion or uncertainty.
- Add desktop and compact E2E flows for physical and virtual file/directory downloads, multi-file upload, upload conflicts, partial upload failure, cancellation, and a directory ZIP.

## Delivery Plan

1. Define shared transfer capability and operation availability for SMB connections and Companion local drives, including provider support gates.
2. Add the centralized temporary-archive size system setting, Advanced-settings control, short-lived Companion download-capability session, and settings/session tests.
3. Implement the backend temporary-artifact destination, size-enforcing writer, fixed archive filename, request-disconnect cancellation, and archive-download lifecycle for SMB sources.
4. Implement the ZIP archive-creation source for persistent archive creation and temporary downloads, and extend Companion's archive creator with its optional private temporary-artifact output path, size-enforcing writer, direct-member delegation, and shared behavioral contract tests.
5. Extract the destination-publish helper from cross-provider copy, use it for browser-file publishing to both existing SMB and Companion staged endpoints, and keep copy/move coordination and behavior unchanged.
6. Add the multi-file upload queue using the existing copy conflict/progress UI, shared Blob download helper, indeterminate download preparation state, transfer summary, translations, and E2E coverage.
7. Verify accessibility, compact layout, Blob-download memory behavior at the configured cap, disconnect cancellation, size-limit failure handling, and error recovery against the demo connection.

## Estimate and Risk

| Area | Estimate |
| --- | ---: |
| Command registry, policies, settings UI, translations, and UI tests | 1-2 days |
| Backend temporary artifact, fixed archive name, cancellation, and SMB archive integration | 1-2 days |
| Companion temporary artifact, download-capability session, ZIP virtual archive-creation source, and integration | 2-3 days |
| Browser archive download through the shared Blob helper | 0.5-1 day |
| Browser-file publish transport extraction, upload queue, and provider-contract tests | 1-2 days |
| E2E, accessibility, and regression validation | 1-2 days |
| **Total** | **8-13 engineer-days** |

Overall risk is **medium (4/10)**. Archive creation already supplies manifest validation, ZIP generation, cancellation, and cleanup; the copy pipeline already supplies target resolution, staging, progress, structured results, and staged destination endpoints for SMB and Companion local drives. The remaining risks are bounded to temporary-artifact lifecycle and disk availability, the short-lived Companion download-capability session, browser-file publish transport reuse, request-disconnect cancellation, and browser memory use while saving the capped ZIP Blob. The design contains these risks by enforcing the limit before each temporary writer accepts output, deleting limit-exceeded artifacts, keeping artifacts outside user storage, scavenging stale artifacts after abnormal termination, reusing established creation and transfer contracts rather than adding new core algorithms, and treating streaming disk writes as a separately scoped future improvement.
