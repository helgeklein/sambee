# Dialog Operation Context UX Plan

## Purpose

Define a shared, accessible presentation for the description and source/target context in file-operation dialogs. The pattern must work for copy, move, rename, create, delete, archive creation and extraction, conflict resolution, and archive-member failures.

The primary user-facing rule is simple: every filename or path appears on its own visual line, is limited to one line, and is shortened without losing the most useful identifying information. The sole exception is the current-file transfer-progress row, where a filename may share one dedicated line with its byte figures and is shortened only when needed to preserve those figures. The design must remain correct when translated text requires a different sentence order, and when item names or paths contain right-to-left text.

## Implementation Status (completed 2026-09-09)

Legend: ✅ verified complete; 🟡 implemented but incomplete or missing acceptance coverage; ⬜ not started.

- ✅ Grapheme-aware filename/path abbreviation, including shared breadcrumb truncation, with focused unit coverage.
- ✅ `DialogOperationContext`, `DialogIdentifierDisplay`, fixed feedback slots, and `ArchiveOperationProgress` status-only modes.
- ✅ Dialog migrations, archive destination context, cancellation-state focus, and responsive/bidi acceptance coverage.
- ✅ Outcome-only translation migration, including obsolete inline prompt cleanup and an alternate-word-order locale fixture.
- ✅ Versioned dialog style-guide update and required documentation workflow.

## Problem Statement

Several dialogs currently place dynamic filenames and paths inside a translated prose sentence. `CopyMoveDialog`, `RenameDialog`, `CreateItemDialog`, the archive-create `NameInputDialog` workflow in `FileBrowser.tsx`, and `ArchiveExtractDialog` use `Trans` markup with inline identifier components. This permits localized word order, but it cannot guarantee a separate line for every identifier or give long values a shared truncation behavior.

Other dialogs have the same presentation problem in a different form:

- `ConfirmDeleteDialog` uses a read-only field for selected names, but does not use a common operation-context model.
- `OverwriteConflictDialog` places path labels and values in a desktop metadata grid, putting them on the same visual row.
- `ArchiveMemberErrorResolver` uses a responsive two-column definition list and allows horizontal scrolling for long paths.
- `InlineItemName` styles identifiers but does not shorten them.
- `DialogReadOnlyField` uses CSS ellipsis for input-like values, which only preserves the beginning of a long filename and does not share an identifier-specific shortening strategy.

The result is inconsistent scanning, poor behavior for long values, and excessive dependence on sentence construction for information that is structurally source/target metadata.

## Goals

- Make source, target, archive, and item identifiers easy to scan in every operation dialog.
- Guarantee that a displayed filename or path has its own visual line, with no prose or another identifier beside it, except for the compact current-file transfer-progress row and its byte figures.
- Keep every identifier to one visual line without horizontal scrolling or a widening dialog.
- Preserve the useful parts of a shortened filename or path.
- Keep the complete original value available to assistive technology and through a hover affordance.
- Keep an enabled cancellation action available while a copy, move, archive creation, or archive extraction operation is pending, using its existing cancellation handle.
- Let translators localize outcome prose independently of the order or position of dynamic identifiers.
- Isolate unknown-direction filenames and paths so they do not reorder surrounding localized text.
- Reuse the pattern across all relevant dialogs without creating a schema-driven dialog framework.

## Non-Goals

- Change operation semantics or add cancellation plumbing for rename, create-item, delete, or conflict-decision requests.
- Add archive-creation member-progress reporting to storage or backend contracts.
- Change the values submitted to APIs, editable fields, or clipboard operations.
- Replace the existing `ResponsiveFormDialog` shell, focus behavior, or action layout.
- Add visual cards, chips, or a new global dialog theme.
- Solve arbitrary file-content or filename spoofing beyond correctly isolating presentation. Handling visible bidi-control character warnings is a separate security decision.

## Design Principles

### Separate prose from identifiers

The dialog description explains the pending outcome but contains no dynamic filename or path. For example:

- Copy single item: "Copy this item to the destination directory."
- Move multiple items: "Move the 3 selected items to the destination directory."
- Rename: "Choose a new name for this item."
- Create: "Create the new directory in the selected location."
- Create archive: "Create an archive from the 3 selected items."

The body then shows the dynamic values in labelled fields. This avoids requiring an i18n message to accommodate an inline filename or target path at a particular grammatical position.

### Keep currently cancellable operations cancellable

Copy, move, archive creation, and archive extraction already expose an `AbortSignal` or execution `cancel()` handle. While one of those operations is pending, expose its established enabled cancellation action. Do not change an existing operation-specific cancellation label solely for this migration. Cancellation is a request to stop further work; it does not promise rollback of work already completed.

The owner must connect the action to the existing controller and prevent duplicate requests while cancellation is being sent. On a clean cancellation, close the dialog without a completion summary, just as for a successful operation. Keep or reopen a terminal dialog only when cancellation produces an actionable error, partial output, or unknown outcome that the user needs to understand.

Do not add cancellation controls to pending rename, create-item, or delete requests in this work. Their current APIs do not provide a cancel handle, so their pending primary and dismissal actions retain their current disabled behavior. Preserve the conflict dialog's existing parent-operation behavior: copy/move interprets its `null` decision as cancellation of the active transfer loop, and archive extraction supplies its active extraction cancellation callback. If the component is ever used without a parent cancellation callback, `Cancel` declines only that decision.

### Apply focus consistently

The dialog owner must set initial focus after the dialog transition, and move focus deliberately when the dialog changes state:

- An editable form focuses its primary input. Rename keeps its established selection behavior: select the basename of a file and all text for a directory.
- A non-destructive confirmation without an input focuses its primary action.
- A destructive confirmation focuses `Cancel`.
- A conflict dialog focuses its owner-supplied safe resolution; if that resolution is `Rename`, focus the target-name input instead. An unavailable-resolution error receives focus.
- A cancellable pending copy, move, archive-create, or archive-extract operation focuses its enabled cancellation action. Do not leave focus on a control that became disabled.
- A terminal actionable outcome focuses `Close`.
- A validation or recoverable API error returns focus to the invalid or retryable input. An archive member error focuses `Retry`.

### Use a vertical operation context

Every identifier field uses a vertical definition-list row:

1. A translated `dt` label, such as "Source item" or "Destination directory".
2. A full-width `dd` containing one identifier display.

The label is always above the value at every viewport width. Do not use a desktop label/value grid for these fields. Group related fields under a concise translated heading only where that distinction is meaningful.

`OverwriteConflictDialog` is the deliberate exception: its constrained migration retains the existing compact label/value metadata grids under `Existing item` and `Incoming item`. Each `Path` label and its filename-inclusive `DialogIdentifierDisplay` value remain on the same row; do not apply the general vertical-context reorganization to that dialog.

### Preserve information according to identifier type

Shortening should be semantic, not a generic end ellipsis:

| Identifier type | Shortening rule | Example |
| --- | --- | --- |
| Filename | Preserve the beginning, a meaningful tail, and the final extension. Use a middle ellipsis. | `2026-08-28...Firefox.png` |
| Directory or file path | Preserve the provider/root prefix and final basename. Collapse ancestor segments before shortening the basename. | `Demo:/.../Test dir/report.png` |
| Root or provider-only path | Preserve the provider/root first; shorten the remaining content only if required. | `Demo:/...` |
| Multi-selection | Do not concatenate all values into description prose. Use a count in the outcome sentence. For a delete preview, show at most six one-line names followed by a localized remaining-count summary. |

Treat a leading-dot filename such as `.gitignore` as having no extension. For a multi-extension filename such as `archive.tar.gz`, preserve the final extension by default; do not infer semantics from arbitrary dot-separated suffixes.

## Shared Component Design

### `DialogOperationContext`

Create `frontend/src/components/FileBrowser/DialogOperationContext.tsx` as the shared, layout-only component for read-only operation metadata.

Suggested public contract:

```tsx
type DialogOperationIdentifierKind = "fileName" | "path";

interface DialogOperationContextEntry {
  label: string;
  value: string;
  kind: DialogOperationIdentifierKind;
  testId?: string;
}

interface DialogOperationContextProps {
  entries: readonly DialogOperationContextEntry[];
  ariaLabel?: string;
}
```

The component must:

- Render a `section` containing a `dl`.
- Render each label as a `dt` above its corresponding `dd`.
- Set `minWidth: 0` on the flex/grid ancestors and the `dd` so overflow behavior is reliable.
- Use a single column at every breakpoint.
- Be unframed. It may use the existing subdued dialog surface only when the owning dialog already uses `SettingsFormSurface` or `DialogReadOnlyField` for its operation context.
- Accept entries already formatted for display. Connection/path formatting remains the responsibility of the owning dialog through `formatConnectionPath` or an existing equivalent.

Keep operation-specific state, translated labels, and source/target selection in each owning dialog. `DialogOperationContext` only owns semantic layout and identifier display.

### `DialogIdentifierDisplay`

Create `frontend/src/components/FileBrowser/DialogIdentifierDisplay.tsx` as the presentation primitive used by `DialogOperationContext`. It replaces display-only uses of `InlineItemName` in operation contexts; retain `InlineItemName` for genuinely inline prose elsewhere until there are no callers.

Suggested public contract:

```tsx
interface DialogIdentifierDisplayProps {
  value: string;
  kind: "fileName" | "path";
  testId?: string;
}
```

The component must:

- Render as a block-level `<code>` element inside `<bdi dir="auto">`, or an equivalent structure that preserves code styling while applying directional isolation to the value.
- Keep a single visual line with `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`, and `maxWidth: "100%"` as the final browser-level overflow safeguard.
- Render a pre-shortened display string, but expose the complete `value` through `aria-label` and a MUI `Tooltip` on hover only when the displayed string differs from `value`. Set `disableFocusListener` and `disableTouchListener`; do not give the display a `tabIndex`.
- Use the complete unmodified value in the tooltip and accessible name. Never insert truncation markers into API values, input state, test fixtures that represent stored values, or clipboard values.
- Preserve the existing dialog identifier colors, border, monospace family, and compact padding from `InlineItemName`.
- Avoid a text button inside the display. A later copy-to-clipboard feature, if needed, must use a dedicated icon button with an accessible label and must not reduce the available value width unexpectedly.

Do not use `title` as the only full-value mechanism. Native titles do not provide a dependable touch or keyboard experience. Retain `title` only if it is useful as a low-cost browser fallback in addition to the accessible label and tooltip.

### Fixed input feedback slots

Extend `frontend/src/components/Settings/SettingsFormLayout.tsx` with shared feedback styles or primitives for one- and two-field operation dialogs. Do not let each dialog define its own error-message height, wrapping, or overflow behavior.

Use exactly one of these stable slots for each condition:

1. **Field feedback slot:** reserve one helper-text line directly below every input that can produce local validation feedback. Supply a placeholder when idle, then replace it with the field error or warning. Use the same `formHelperText` slot styling for `CopyMoveDialog`, `NameInputDialog`, `ArchiveExtractDialog`, and `OverwriteConflictDialog`.
2. **Form notice slot:** reserve one alert-height line below the form surface for a non-field error or warning, such as a failed request, an unavailable destination, or partial completion. Keep this notice mounted with `visibility: hidden` while idle; do not conditionally insert it after the form has rendered.

Both slots must use the same geometry: one line of the configured typography, no wrapping, `overflow: hidden`, and `textOverflow: ellipsis`. Field feedback remains associated with its input through `aria-describedby`. A shortened feedback message must retain its complete text in the accessible name or description and a MUI tooltip available on hover. Authors must write concise, actionable summaries that fit the line under normal dialog widths; log or expose diagnostic detail separately rather than expanding the slot to a second line.

Do not duplicate a field-owned validation error in the form notice slot. The fixed-height form notice is only for a condition the user cannot remedy in a specific input. Both the field slot and form notice must remain in the layout while a pending state disables the input, so changing feedback or state never shifts the action row.

### Archive operation progress

Evolve the existing `ArchiveOperationProgress` into a status-only archive surface with two explicit presentation modes, using only data already returned by existing archive APIs:

```ts
type ArchiveOperationProgressProps =
  | { operation: "create" }
  | { operation: "extract"; processedMembers?: number };
```

Archive creation receives no member counter and renders only the localized `Creating archive...` label with an indeterminate bar. Archive extraction has two localized, truthful states:

```text
Preparing archive...
[==============================]

Processed 12 archive items...
[==============================]
```

Use `Preparing archive...` until extraction has processed an archive member. Once the count advances, use `Processed {{processed}} archive items...`, retaining an indeterminate bar. This neutral wording is accurate because `members_processed` includes successful, skipped, and failed member outcomes. Do not present a determinate bar, percentage, or `of {{total}}` wording: the current extraction progress payload has no total-member counter, and this work must not change archive API, backend, storage-coordinator, or generic `ContentOperationExecution` contracts.

For extraction, retain the existing `members_processed` aggregate counter from each status/result payload in the frontend-only `ArchiveExtractionSummary` mapper and pass it as `processedMembers`. It includes successful, skipped, and failed member outcomes exactly once, unlike `filesExtracted + directoriesCreated`, which is a display-statistic combination rather than a progress invariant. Do not infer a total from selected top-level sources or directory entries.

Do not render bytes or the current item name in either archive status mode. The transport payload may retain byte and file-statistic fields for diagnostics or other UI, but `ArchiveOperationProgress` must not consume them. The static archive/source context already identifies the operation input, and any additional current filename must use its own labelled one-line `DialogIdentifierDisplay`.

### Overwrite conflict resolution: constrained migration

`OverwriteConflictDialog` is the shared, multi-purpose resolution surface for copy, move, and archive extraction. Its migration is intentionally limited:

**Will change:**

1. Move `Target name` from the top of the dialog to below the resolution choices. Render its editable input and fixed helper-text line only after the user selects `Rename`. The resulting layout shift is accepted because the selected resolution changes the form. The initial suggested name, validation rules, selection behavior, and submitted `targetName` remain unchanged.
2. Keep the existing `Existing item` and `Incoming item` metadata grids, but expand each `Path` value to include its filename. Render the resulting full file path with `DialogIdentifierDisplay` and semantic path shortening, rather than the local `PathValue` end ellipsis. Modified time and size remain in their current compact rows.
3. Replace the conditionally mounted owner-error alert with the shared, one-line form-notice slot in its existing pre-metadata position. Keep the slot reserved while idle, retain the existing error focus behavior, and do not add a notice for field-owned Rename validation.

**Will not change:**

- The dialog remains the single shared resolution component for copy, move, and archive extraction.
- The owner continues to provide the allowed actions, safe default, all-remaining policy, progress context, source/target paths, errors, and operation callbacks.
- No resolution is added, removed, renamed, reordered, or inferred. `Skip`, `Overwrite`, `Overwrite only older`, and `Rename` retain their current semantics and availability rules.
- The existing all-remaining checkbox behavior, conflict count/progress, direction cue, control ordering, action labels, Enter handling, `aria-busy`, error focus, and Rename-input focus transfer remain intact, except that the approved form-notice slot stays mounted while idle.
- Archive extraction continues to use the same decision mapping, member paths, and resume/continuation behavior.
- No conflict-resolution business rule or decision payload changes as part of this UI migration.

**Current layout:**

```text
Resolve conflict
An item already exists at the destination.

Target name
[annual-report.pdf                     ]

Existing item
  Path             [Demo:/Archive/2026]
  Modified         2026-09-01 10:30
  Size             2.4 MB

               [upward direction cue]

Incoming item
  Path             [Demo:/Reports]
  Modified         2026-09-02 08:15
  Size             2.5 MB

Resolution
  (x) Skip  ( ) Overwrite  ( ) Overwrite only older  ( ) Rename

                                  Cancel operation  Continue
```

**New layout:**

```text
Resolve conflict
An item already exists at the destination.

Existing item
  Path             [Demo:/Archive/2026/annual-report.pdf]
  Modified         2026-09-01 10:30
  Size             2.4 MB

               [upward direction cue]

Incoming item
  Path             [Demo:/Reports/annual-report.pdf]
  Modified         2026-09-02 08:15
  Size             2.5 MB

Resolution
  (x) Skip  ( ) Overwrite  ( ) Overwrite only older  ( ) Rename

[Target name: visible only for Rename]
[input: annual-report (copy).pdf     ]
[error: Name is already in use.       ]

                                  Cancel operation  Continue
```

The final three lines in the new wireframe denote Rename-only controls, not controls that are visible together. When the resolution is not `Rename`, they are absent. When it is `Rename`, the input and its fixed feedback line are inserted below the resolution choices and the input receives focus. The resulting layout shift is intentional. No other visual restructuring is part of this migration.

**Owner-error state:**

```text
Resolve conflict
An item already exists at the destination.

[Error: The conflict could not be resolved.]

Existing item
  Path             [Demo:/Archive/2026/annual-report.pdf]
  Modified         2026-09-01 10:30
  Size             2.4 MB

               [upward direction cue]

Incoming item
  Path             [Demo:/Reports/annual-report.pdf]
  Modified         2026-09-02 08:15
  Size             2.5 MB

Resolution
  (x) Skip  ( ) Overwrite  ( ) Overwrite only older  ( ) Rename

                                  Cancel operation  Continue
Focus: Error notice
```

The form-notice slot occupies this same pre-metadata position while idle but is visually hidden. An owner error reveals it and receives focus without moving the metadata, resolution controls, or actions.

### Shared shortening utilities

Extend the existing `frontend/src/utils/pathDisplay.ts`; it is the single source of truth for all filename and path abbreviation. Do not create `identifierDisplay.ts` or another component-local shortening helper.

Its public API must cover the existing path use case and the new filename use case:

```ts
function abbreviateFileName(value: string, availableWidth: number, measureText: (value: string) => number): string;
function abbreviatePath(value: string, availableWidth: number, measureText: (value: string) => number): string;
```

Requirements:

- Use grapheme clusters rather than UTF-16 code units when splitting text. Use `Intl.Segmenter` when available and a safe fallback when it is unavailable.
- Use a binary search to find the largest fitting prefix/suffix combination after reserving the ellipsis and filename extension.
- Keep and improve `abbreviatePath`, including support for `/` and `\\` separators and provider-prefixed roots.
- When a path does not fit, collapse complete ancestor segments first. Only shorten the basename when the root plus the collapsed form still does not fit.
- When even the minimal meaningful form does not fit, return the least misleading abbreviated form and let CSS overflow provide the final clipping safeguard.
- Preserve a stable result for the same value and measured width; do not visibly oscillate while a dialog is open.
- Move `BreadcrumbsNavigation`'s `truncateSegmentName` logic to an exported companion utility in `pathDisplay.ts`, or make it delegate to one. Its breadcrumb-specific character budget may remain at the call site, but it must not maintain a second filename-shortening implementation.

`DialogIdentifierDisplay` must obtain available width from its own rendered element using `ResizeObserver`. Measure text using a hidden element with the display's resolved font styles, or a canvas configured with its computed font. Recalculate after font readiness when `document.fonts` is available. This component owns measurement only; it must call `pathDisplay.ts` for abbreviation. Do not use a fixed character count for dialog values, because proportional fonts, localization, browser zoom, and user font settings make it inaccurate.

Server-side rendering is not currently required by the frontend, but the initial render must safely show the full value until browser measurement is available.

## Localization and Bidirectional Text

### Translation keys

Replace dynamic-identifier sentences with two classes of translations:

1. Outcome-only descriptions, with pluralization where a count appears.
2. Stable field labels for source, target, archive, existing item, incoming item, and selected items.

Example key structure:

```json
{
  "fileBrowser": {
    "operationContext": {
      "sourceItem": "Source item",
      "destinationDirectory": "Destination directory",
      "existingItem": "Existing item",
      "incomingItem": "Incoming item"
    },
    "copyMove": {
      "copySingleDescription": "Copy this item to the destination directory.",
      "copyMultipleDescription_one": "Copy this item to the destination directory.",
      "copyMultipleDescription_other": "Copy the {{count}} selected items to the destination directory."
    },
    "archive": {
      "createDescription_one": "Create an archive from this selected item.",
      "createDescription_other": "Create an archive from the {{count}} selected items."
    }
  }
}
```

No outcome key should use markup placeholders for filenames, paths, directories, or connections. This permits language-specific word order without forcing dynamic values into a translated sentence.

### Migration inventory

Replace the following current dynamic-value `Trans` usages during the named dialog migration. Retire a legacy key only after every locale has the replacement key.

| Owner | Current dynamic prompt | Replacement outcome key | Context labels |
| --- | --- | --- | --- |
| `CopyMoveDialog` | Single-item copy/move prompt with source name and destination | `copySingleDescription` / `moveSingleDescription` | `Source item`, `Destination directory` |
| `CopyMoveDialog` | Multi-item copy/move prompt with destination | pluralized `copyMultipleDescription` / `moveMultipleDescription` | `Destination directory` |
| `RenameDialog` through `NameInputDialog` | Rename prompt with current name | `renameDescription` | Current editable `New name` field remains authoritative |
| `CreateItemDialog` through `NameInputDialog` | Create prompt with target directory | `createItemDescription` | `Destination directory` |
| Archive-create `NameInputDialog` workflow | Archive-create prompt with selected names or directory | pluralized `archive.createDescription` | `Source item` when singular, `Destination directory` |
| `ArchiveExtractDialog` | Archive or member extraction prompt with archive/member value | `archive.extractDescription`, `archive.extractMemberDescription`, and pluralized `archive.extractMembersDescription` | `Archive` or `Archive member`, `Destination directory` |
| `ConfirmDeleteDialog` | Delete prompt with selected name(s) | `deleteSingleDescription` / pluralized `deleteMultipleDescription` | `Item to delete`, or bounded selected-item preview |
| `OverwriteConflictDialog` | Existing/incoming conflict prompt values | `conflictDescription` | Existing compact `Existing item` / `Incoming item` groups |
| `ArchiveMemberErrorResolver` | Member failure prompt values | `archive.memberErrorDescription` | `Archive member`, `Target path` |

The exact English wording may change during implementation, but the migration must preserve the existing namespace ownership and use plain interpolation only for counts, not identifiers.

### Bidi handling

Filenames and paths are data with unknown text direction. Render them as separate, directionally isolated elements using `<bdi dir="auto">`; do not add Unicode directional control characters to the stored or submitted value.

The display must continue to work when:

- The application is in an RTL locale and the value is predominantly Latin text.
- The application is in an LTR locale and the value is predominantly Arabic or Hebrew text.
- A path combines slash or backslash separators, digits, Latin text, and RTL directory names.

Do not force all identifiers to `dir="ltr"`, because filenames may legitimately be RTL. Do not rely on the surrounding description paragraph for directionality.

## Proposed Layout Examples

The examples below are inspection sketches for the accepted layout. They show visual order, not implementation markup. Every indented value under a label is one `DialogIdentifierDisplay`: full width, one visual line, intelligently abbreviated when needed, with the complete value available through its accessible name and tooltip.

`[input: value]` is an editable text input. `[value]` is a read-only identifier display. `[error: message]` and `[warning: message]` are the fixed, single-line feedback slots. `Focus:` is a wireframe annotation for initial focus on opening or after a state transition; it is not visible UI text. Alerts and progress bars appear in the order shown. Identifier displays align with their labels. Actions are a compact, right-aligned group, matching the existing dialog shell. The compact examples use short placeholder values for legibility; the one-line identifier rule still applies to long or mixed-direction values.

### Copy and Move

#### Single-item copy

```text
Copy
Copy this item to the destination directory.

Source item
[report-final.pdf]
Destination directory
[Demo:/Archive/2026]

New name
[input: report-final.pdf             ]

                                    Cancel  Copy
Focus: New name
```

#### Single-item move

```text
Move
Move this item to the destination directory.

Source item
[report-final.pdf]
Destination directory
[Demo:/Archive/2026]

New name
[input: report-final.pdf             ]

                                    Cancel  Move
Focus: New name
```

#### Single-item copy to its current directory

```text
Copy
Copy this item to the destination directory.

Source item
[report-final.pdf]
Destination directory
[Demo:/Reports]

New name
[input: report-final (copy).pdf      ]

                                    Cancel  Copy
Focus: New name
```

The suggested copy name makes this valid immediately. The context still shows the original source item and destination independently.

#### Single-item move with unchanged name in its current directory

```text
Move
Move this item to the destination directory.

Source item
[report-final.pdf]
Destination directory
[Demo:/Reports]

New name
[input: report-final.pdf             ]
[error: A different name is required in this directory.]

                         Cancel  Move (disabled)
Focus: Cancel
```

#### Batch copy or move

```text
Copy
Copy the 3 selected items to the destination directory.

Destination directory
[Demo:/Archive/2026]

                                    Cancel  Copy
Focus: Copy
```

`Move` substitutes its title, outcome, and primary action, which receives initial focus. The selected items are not listed in the description or context by default.

#### Batch operation with the same destination

```text
Copy
Copy the 3 selected items to the destination directory.

Destination directory
[Demo:/Reports]

The destination directory is the same as the source directory.

                         Cancel  Copy (disabled)
Focus: Cancel
```

#### Processing and transfer progress

```text
Copy
Copy the 3 selected items to the destination directory.

Destination directory
[Demo:/Archive/2026]

Copying 2 of 3
[====================----------]

[report-final.pdf]  24.0 MB / 60.0 MB
[============------------------]

                            Cancel  Copying (disabled)
Focus: Cancel
```

For a single-item operation, retain its source, destination, and disabled `New name` field above the progress. Keep the current filename and its byte figures on one compact flex row. Reserve the byte figures as a non-wrapping trailing value, give the filename the remaining width, and abbreviate that filename with the shared `pathDisplay.ts` utility only when the complete row would otherwise overflow. The complete filename remains available through its accessible name and tooltip. When the total bytes are unknown, retain the same row with only bytes transferred and use an indeterminate byte-progress bar.

Copy/move already supplies selected-item progress and current-file byte progress. The regular-file counter has a fixed selected-item total. Recursive directory transfers report completed and discovered entries, so their denominator may grow; label that state as a discovered-item count rather than promising a final total. Byte totals remain optional in the cross-provider transfer contract because a provider may not expose file size; making them mandatory would require provider-wide metadata guarantees and preflight directory traversal, so it is not a low-effort change.

#### Actionable feedback and terminal state

```text
Copy
Copy this item to the destination directory.

[Error: The copy could not be completed.]
[Warning: The destination was created but the source was retained.]

Source item
[report-final.pdf]
Destination directory
[Demo:/Archive/2026]

New name
[input: report-final.pdf             ]

                                           Close
Focus: Close
```

Show a terminal state only when an error, warning, partial-output, or unknown-outcome notice requires user attention. Retain the contextual information, hide the primary action, and provide only `Close`. A successful copy/move and a clean cancellation close the dialog without a terminal summary.

### Rename and Create Item

#### Rename file

```text
Rename file
Choose a new name for this item.

New name
[input: annual-report.pdf            ]

                                  Cancel  Rename
Focus: New name
```

#### Rename directory

```text
Rename directory
Choose a new name for this item.

New name
[input: Financial reports            ]

                                  Cancel  Rename
Focus: New name
```

The file and directory variants differ only in title and initial text-selection range.

#### Rename validation, failure, and submitting

```text
Rename file
Choose a new name for this item.

New name
[input: annual-report.pdf            ]
[error: Choose a different name.]

               Cancel  Rename (disabled)
Focus: New name
```

```text
Rename file
Choose a new name for this item.

New name
[input: annual-report-final.pdf      ]

[Error: A file with this name already exists.]

                                  Cancel  Rename
Focus: New name
```

```text
Rename file
Choose a new name for this item.

New name
[input: annual-report-final.pdf      ] (disabled)

                     Cancel  Renaming... (disabled)
Focus: Cancel
```

The prefilled `New name` input is the sole presentation of the current name; do not repeat it in read-only context. Validation uses its reserved field-feedback line. A server error uses the separate reserved form-notice line and refocuses the input; neither condition shifts the dialog layout.

#### Create file

```text
New file
Create the new file in the destination directory.

Destination directory
[Demo:/Projects/2026]

Name
[input:                              ]

                                  Cancel  Create
Focus: Name
```

#### Create directory

```text
New directory
Create the new directory in the destination directory.

Destination directory
[Demo:/Projects/2026]

Name
[input:                              ]

                                  Cancel  Create
Focus: Name
```

#### Creating and creation failure

```text
New file
Create the new file in the destination directory.

Destination directory
[Demo:/Projects/2026]

Name
[input: notes.txt                    ] (disabled)

                      Cancel  Creating... (disabled)
Focus: Cancel
```

```text
New file
Create the new file in the destination directory.

Destination directory
[Demo:/Projects/2026]

Name
[input: notes.txt                    ]

[Error: A file with this name already exists.]

                                  Cancel  Create
Focus: Name
```

The file and directory variants share this layout. Validation uses the reserved field-feedback line below `Name`; an API failure uses the separate reserved form-notice line.

### Archive Creation

Archive creation is composed in `FileBrowser.tsx` with `NameInputDialog`; it is not a separate `ArchiveCreateDialog` component.

#### One selected source

```text
Create ZIP Archive
Create an archive from the selected item.

Source item
[annual-report.pdf]
Destination directory
[Demo:/Archives]

Archive name
[input: archive.zip                  ]

                                   Cancel  Create
Focus: Archive name
```

#### Multiple selected sources

```text
Create ZIP Archive
Create an archive from the 3 selected items.

Destination directory
[Demo:/Archives]

Archive name
[input: archive.zip                  ]

                                   Cancel  Create
Focus: Archive name
```

Only a single selection gets a `Source item` context row. Multiple selections use the localized count without listing selected names.

#### Creating

```text
Create ZIP Archive
Create an archive from the 3 selected items.

Destination directory
[Demo:/Archives]

Creating archive...
[==================--------------]

                                           Cancel
Focus: Cancel
```

During creation, replace the editable archive-name form with `ArchiveOperationProgress` in its `operation="create"` mode, retaining the static destination context. Show `Creating archive...`; do not invent member counts, a total, or a determinate percentage until archive creation has a separately designed backend progress capability.

#### Creation failure or partial output

```text
Create ZIP Archive
Create an archive from the 3 selected items.

Destination directory
[Demo:/Archives]

Archive name
[input: archive.zip                  ]

[Error: Archive creation failed.]

                                   Cancel  Create
Focus: Archive name
```

For partial output, use the factual partial-output error in the same position. The error returns the user to the editable archive-name form.

### Archive Extraction

#### Whole archive with editable destination name

```text
Extract Archive
Extract this archive to the destination directory.

Archive
[project-backup.zip]
Destination directory
[Demo:/Restored]

Destination name
[input: project-backup               ]

                                  Cancel  Extract
Focus: Destination name
```

#### Archive scope with a fixed destination

```text
Extract Archive
Extract this archive member to the destination directory.

Archive member
[reports/annual-report.pdf]
Destination directory
[Demo:/Restored]

                                  Cancel  Extract
Focus: Extract
```

There is no editable destination-name field when the provider fixes the extraction destination.

This fixed-destination layout applies to a whole archive or one or more selected archive members when extracting to the other pane. Substitute the localized scope description, such as `Extract the 3 selected archive members to the destination directory.`, without adding a destination-name input.

#### Multiple archive members with a new sibling directory

```text
Extract Archive
Extract the 3 selected archive members to the destination directory.

Destination directory
[Demo:/Restored]

Destination name
[input: project-backup               ]

                                  Cancel  Extract
Focus: Destination name
```

The selected-member count is localized. Individual member paths are not placed in prose. `Destination name` is the editable new sibling-directory name and is initialized from the archive basename, not the selected members. It appears only in single-pane extraction, regardless of whether the scope is the whole archive or one or more selected members. In dual-pane extraction, the other pane supplies a fixed destination and the input is omitted.

#### Extracting

```text
Extract Archive
Extract this archive to the destination directory.

Archive
[project-backup.zip]
Destination directory
[Demo:/Restored]

Processed 12 archive items...
[==============================]

                                           Cancel
Focus: Cancel
```

#### Archive member error

```text
Error Extracting Member
Choose how to continue extracting the archive.

[Error or warning: Unable to write the member.]

Archive member
[reports/annual-report.pdf]
Target path
[Demo:/Restored/reports/annual-report.pdf]

Partial output may be present.              (warning only)

                        Cancel  Ignore  Retry
Focus: Retry
```

The warning and error variants differ by alert severity and whether the partial-output note appears. Both use the same vertically stacked operation context.

#### Extraction conflict

```text
Resolve conflict
An item already exists at the destination.

Existing item
  Path             [Demo:/Restored/reports/annual-report.pdf]
  Modified         2026-09-01 10:30
  Size             2.4 MB

               [upward direction cue]

Incoming item
  Path             [project-backup.zip/reports/annual-report.pdf]
  Modified         2026-08-30 09:12
  Size             2.3 MB

Resolution:  ( ) Skip  ( ) Overwrite  ( ) Rename

                                Cancel operation  Continue
Focus: Skip
```

This delegates to the shared overwrite-resolution layout in the constrained-migration section above. Archive extraction supplies the action set and source/target path labels.

### Delete Confirmation

#### Single file or directory

```text
Delete file
Delete this file permanently.

Item to delete
[annual-report.pdf]

                                  Cancel  Delete
Focus: Cancel
```

For a directory, substitute `Delete directory`, its destructive outcome description, and the same `Item to delete` row. `Cancel` retains initial focus for both variants.

#### Multiple items

```text
Delete multiple items
Delete the 3 selected items permanently.

Items to delete
[annual-report.pdf]
[notes.txt]
[Financial reports]

                                  Cancel  Delete
Focus: Cancel
```

Show at most six one-line identifier displays. When additional items are selected, replace the remaining rows with a localized summary such as `and 47 more items`; do not add an inner scroll container or render the full list. Each shown item has its own complete accessible value. Do not use one newline-delimited textarea.

## Dialog Migration Plan

### Phase 1: Reference implementation

Migrate `CopyMoveDialog` first.

- Replace the single-item `<Trans>` description with an outcome-only translated description.
- For a single item, render `Source item` with the original filename and `Destination directory` with `destinationLabel` in `DialogOperationContext`.
- Keep the existing editable `New name` field for a single item and the read-only destination control for a batch only until the shared context replaces it without losing selection/copy behavior.
- For a batch, use the count in the description and show `Destination directory` in the context. Do not list every selected name by default.
- Preserve existing same-directory validation, suggested copy name, focus selection, and Enter-key behavior. Wire the pending action to its existing abort controller so `Cancel` remains available while work is in progress.

This migration validates the primary use case shown by the current browser issue: a long source filename and a long destination must never share a prose line.

### Phase 2: Single-name workflows

Migrate `RenameDialog` and `CreateItemDialog` through `NameInputDialog` support.

- Extend `NameInputDialog` with an optional `operationContext` slot rendered below the description and above the state-specific body. Retain the context while a submitting-content view replaces the editable form.
- `RenameDialog`: description states the action. The prefilled `New name` input is the sole presentation of the current name; preserve its existing selection behavior.
- `CreateItemDialog`: description states the action; context shows `Destination directory` and the formatted target directory.
- Keep the editable field as the authoritative full value. The display-only context must not alter name selection, validation, or API errors.
- Adopt the shared fixed input-feedback slots. Validation uses the reserved helper-text line; API failures and warnings use the reserved form-notice line, with no wrapping or state-driven layout shift.
- Retain the current pending behavior for rename and create-item requests. Their APIs do not expose cancellation handles.

### Phase 3: Archive workflows

Migrate the archive-create `NameInputDialog` workflow in `FileBrowser.tsx`, `ArchiveExtractDialog`, and `ArchiveMemberErrorResolver`.

- Archive creation: use `createDescription` pluralization with the selected-item count. Show `Destination directory` and the editable archive filename in their established controls; when the dialog needs to identify a single selected source, show it as `Source item` in the context. Do not concatenate selected source names into prose. During pending creation, show only the indeterminate `Creating archive...` status. Preserve archive filename validation and its existing cancellation handle.
- `ArchiveExtractDialog`: show `Archive` or `Archive member` in the context for a single source; use a count-only description for multiple selected archive members; show the extraction destination as its own context value whenever it is known before confirmation. Make `Destination name` depend only on the destination mode: single-pane extraction creates a sibling directory initialized from the archive basename, while dual-pane extraction has a fixed other-pane destination and omits the input for every scope. Map the existing extraction payload's `members_processed` aggregate to the frontend summary and render preparation and processed-only indeterminate states using neutral `Processed {{processed}} archive items...` wording.
- `ArchiveMemberErrorResolver`: replace its two-column definition list and horizontal-scroll containers with vertically stacked `Archive member` and `Target path` context entries.
- Keep error and partial-output notices before or after the context according to their existing state, without embedding values inside error prose.
- Apply the shared fixed input-feedback slots to archive-name and destination-name validation, plus archive API notices, so a new message never pushes controls or actions.
- Ensure archive creation and extraction cancellation reaches their existing active execution handles. Preserve the conflict dialog's parent-operation cancellation behavior. Close silently after a clean cancellation; retain the dialog only for an actionable error, partial-output, or unknown outcome.

### Phase 4: Destructive and conflict workflows

Migrate `ConfirmDeleteDialog` and `OverwriteConflictDialog`.

- `ConfirmDeleteDialog`: a single item uses `Item to delete` as an identifier context. For multiple items, show at most six single-line filename rows with identifier shortening, followed by a localized summary of the undisplayed count. Do not use a scrollable full list or one newline-delimited textarea.
- `OverwriteConflictDialog`: retain the target-name field, source/existing-target group headings, metadata grids, direction cue, resolution controls, and actions. Move the target-name field below the resolution choices and render it only for Rename, accepting that state change's layout shift. Include each item's filename in its one-line, semantically shortened `Path` value. Keep modified time and size in their current compact rows. Replace the local `PathValue` display with `DialogIdentifierDisplay` after migration.
- Apply the constrained-migration checklist above. Do not alter owner-supplied resolutions, safe defaults, batch policy, decision payloads, or archive-extraction action mapping.
- Preserve the current safe default focus on Cancel for delete and Skip or the owner-supplied safe choice for conflicts.
- Retain the current disabled pending controls for delete. While a conflict dialog is waiting for a choice, its enabled `Cancel operation` delegates to the active parent copy, move, or extraction operation. Once `Continue` has submitted a decision and the owner is persisting it, disable the conflict controls to prevent duplicate decisions; do not add a separate cancellation request for that short submission state.
- Apply the shared fixed form-notice slot to same-directory, delete, and conflict errors or warnings that do not belong to a specific input.

### Phase 5: Cleanup

- Migrate or retire remaining display-only `InlineItemName` operation-context call sites.
- Remove obsolete `Trans` markup keys only after all locale resources have been migrated.
- Complete the `pathDisplay.ts` consolidation: migrate `BreadcrumbsNavigation` and every new dialog call site to its exported utilities, then remove their local shortening implementations.
- Do not remove `DialogReadOnlyField`; retain it for editable/read-only form controls where a native input is the appropriate interaction, rather than presentation-only context.

## Documentation Changes

The version-specific style-guide update is planned for `website/content/docs/1.0/developer-guide/frontend-architecture/settings-form-dialog-pattern/index.md` after the reference implementation is accepted. Keep the published guide aligned with implemented components and behavior.

Add an "Operation Context" section that requires:

- Outcome-only descriptions for operation dialogs.
- A vertical labelled context for dynamic names and paths.
- One visual line per identifier, semantic type-aware abbreviation, full-value accessibility, and bidi isolation.
- `DialogOperationContext` for shared display structure, with operation-specific translations and state kept in the owning dialog.
- No source/target interpolation in translated prose.

Revise the existing guidance that says to name a single source item in the description so it instead directs authors to the labelled context. Retain the existing guidance for `ResponsiveFormDialog`, form surfaces, focus, validation, safe defaults, and mobile drawers.

Follow the repository documentation update workflow when editing the website document, including its documentation style guide and derived-artifact refresh requirements.

## Accessibility Requirements

- Continue using `ResponsiveFormDialog` for title labelling, focus trapping, Escape behavior, and focus restoration.
- Keep `aria-describedby` associated with the short outcome description, not a potentially long structured source/target listing. Users of assistive technology can then navigate the semantic context without an excessive announcement when the dialog opens.
- Use semantic `dl`, `dt`, and `dd` structure for labelled operation metadata.
- Give every shortened identifier an accessible name containing its complete value. The visual shortened text remains visible rather than being hidden from assistive technology.
- Show the full value in a hover-only tooltip only when it has been shortened. Ensure the tooltip does not become the sole accessible representation.
- Preserve text selection in read-only values where it already exists. Do not make display-only code values keyboard-focusable solely for selection.
- Do not use color alone to communicate source versus target; labels and group headings must establish meaning.
- Verify 200% browser zoom and a 320 CSS-pixel viewport without horizontal scrolling caused by a context value.

## Test Plan

### Utility tests

Add unit tests for filename and path shortening:

- Short inputs are unchanged.
- A long filename retains an ellipsis and final extension.
- Dotfiles are not treated as extension-bearing filenames.
- A Unicode grapheme cluster is never split.
- Long paths preserve the provider/root and basename while collapsing ancestors.
- Unix, Windows-style, and provider-prefixed paths are covered.
- Widths too small for the root or basename return a stable safe fallback.
- Existing `abbreviatePath` expectations remain valid or are deliberately updated with documented improved results.

### Component tests

For `DialogIdentifierDisplay` and `DialogOperationContext`:

- Labels and values render as `dt` followed by a full-width `dd`, never a side-by-side grid.
- The full value is exposed through the accessible name when shortened.
- Tooltip content is present on hover only for shortened output; focus and touch do not open it.
- The original value is used in the DOM input/props and no abbreviated value leaks into callbacks.
- `bdi` with `dir="auto"` is rendered around the identifier value.
- Resize behavior reruns shortening when a test-controlled `ResizeObserver` width changes.
- Field feedback and form notices reserve their one-line height while idle, visible, and pending; long messages do not wrap or shift adjacent controls or dialog actions.
- A shortened feedback message retains its complete accessible text and tooltip; a field-owned error is not duplicated in the form notice.
- The conflict form-notice slot keeps its pre-metadata height while idle, reveals an owner error without moving later content, and receives focus when shown.
- Archive extraction progress uses two real-data states: preparation before a member is processed, then a `members_processed` count with an indeterminate bar. Its frontend mapper preserves the existing aggregate counter and never derives a false total from selected top-level sources.
- Archive progress never renders byte figures, including when a backend provides them.

### Dialog regression tests

Extend tests for every migrated dialog:

- Short values retain the existing operational behavior and translated outcome text.
- Very long source names and destination paths render in separate rows.
- Single-item copy/move retains its editable destination filename and submit behavior.
- Multi-item copy/move uses count pluralization and does not render every name in its description.
- Archive creation uses the selected-item count and the singular/plural outcome description without rendering selected names in prose.
- Archive creation shows an indeterminate localized `Creating archive...` state without a count or percentage. Archive extraction shows localized preparation, then neutral `Processed {{processed}} archive items...` wording based on the existing `members_processed` count, always with an indeterminate bar.
- Archive extraction remains count-only when transport data includes processed or total bytes.
- Archive extraction renders `Destination name` only for the single-pane sibling-directory mode, initializes it from the archive basename, and omits it for every fixed-target scope.
- Rename, create, delete, archive creation and extraction, conflict resolution, and archive-member failure show the expected labels and full accessibility values.
- Existing focus, validation, loading, cancel, error, and terminal-state tests remain green.
- Validation errors, warnings, and non-field API notices use the shared fixed feedback slots and do not create a second line or shift the dialog layout at narrow and desktop widths.
- Pending copy, move, archive creation, and archive extraction retain an enabled cancellation route. Assert that invoking it reaches the existing abort or job-cancellation controller and prevents duplicate requests. Assert that conflict `Cancel` delegates to the active parent operation. Clean cancellation closes without a terminal dialog; actionable cancellation errors, partial output, and unknown outcomes retain their context and notice. Assert that rename, create-item, and delete pending states preserve their existing disabled controls.

### Localization and browser checks

- Add translation fixtures for an RTL locale and a locale whose sentence order differs from English. Assert that dynamic values remain in field rows and are not coupled to prose order.
- Use mixed Latin/RTL filenames and paths containing separators and digits.
- Add Playwright coverage at 320 px, 768 px, and desktop widths for the long-name copy/move scenario.
- Check light and dark themes, 200% zoom, hover tooltip behavior, and a short mobile viewport where drawer actions remain reachable.
- Manually verify the approved frontend browser connection at `http://localhost:3000/browse/smb/demo` after implementation.

## Delivery Order

1. ✅ Extend `pathDisplay.ts` with pure, grapheme-safe filename and path abbreviation utilities; migrate the breadcrumb helper and add unit tests.
2. ✅ Build and test `DialogIdentifierDisplay`, including measurement, tooltip, full-value accessibility, and bidi isolation.
3. ✅ Build and test `DialogOperationContext` with vertical semantic layout.
4. ✅ Migrate and browser-test `CopyMoveDialog` as the reference implementation.
5. ✅ Migrate and test `ArchiveOperationProgress` using only existing frontend data: `operation="create"` for indeterminate creation status, and the already-returned extraction `members_processed` aggregate for indeterminate count-only extraction status.
6. ✅ Migrate delete and overwrite conflict workflows, including their bounded multi-item preview and existing metadata grids.
7. ✅ Update the dialog style guide to document the accepted, implemented reference pattern.
8. ✅ Remove obsolete inline-prompt markup and duplicated path display components after every caller is migrated.
9. ✅ Run focused frontend tests during each migration, then the full frontend test suite, TypeScript check, lint, and responsive browser checks.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Measurement differs after custom fonts load or the dialog resizes. | Recalculate with `ResizeObserver` and after `document.fonts.ready`; retain CSS overflow as a final safeguard. |
| Generated display text splits emoji or combining characters. | Segment by grapheme cluster, never UTF-16 index. |
| Bidi values reorder punctuation or surrounding translated content. | Isolate each value with `<bdi dir="auto">`; do not concatenate it with prose. |
| Screen readers announce a large amount of path data on opening. | Limit `aria-describedby` to the short outcome description and retain structured context in normal navigation order. |
| A validation or API message shifts controls and actions, or becomes a second line. | Use the shared fixed one-line field-feedback and form-notice slots; truncate only visually while retaining the full accessible message and tooltip. |
| An archive progress bar implies a total that is not known, especially for selected directories. | Keep both archive modes indeterminate. For extraction, use preparation before any member is processed, then the existing `members_processed` counter without an inferred total. |
| Some archive backends provide byte totals while others do not. | Keep archive progress count-only across all backends; retain byte fields outside the dialog UI. |
| An archive-member selection implies a new output name when the target is fixed. | Drive `Destination name` solely from the single-pane sibling-directory mode; initialize it from the archive basename and omit it in dual-pane mode. |
| A migration regresses editable-field focus or submission. | Keep context display-only and run the existing dialog test suite before migrating another dialog. |
| The shared component becomes an operation-specific abstraction. | Limit its API to labels, values, and identifier type. Keep business state and translations in owners. |

## Acceptance Criteria

The work is complete when all of the following are true:

- Every migrated operation dialog presents each filename and path as a labelled, full-width, one-line identifier display.
- No filename or path shares a prose line with action text or another identifier.
- Long filenames preserve a recognizable prefix and final extension; long paths preserve root/provider and basename before shortening the basename.
- The complete raw value is available to assistive technology and through hover without changing the underlying operation value.
- Outcome descriptions can be translated without embedding dynamic identifiers in sentence markup.
- Mixed LTR/RTL identifier content is isolated from surrounding localized UI text.
- Existing dialog keyboard, focus, validation, pending, cancel, and responsive behaviors remain correct.
- Pending copy, move, archive creation, and archive extraction can be cancelled through an enabled dialog action connected to their existing request or job handle; other pending dialog types retain their current behavior until their APIs support cancellation.
- Archive creation remains indeterminate without invented counts. Archive extraction uses preparation before any member is processed, then shows neutral `Processed {{processed}} archive items...` wording based on the existing `members_processed` count with an indeterminate bar; neither operation infers a total or displays a determinate percentage.
- Archive extraction never displays processed or total byte figures.
- Archive extraction shows `Destination name` only for single-pane sibling-directory extraction, never because the user selected multiple archive members.
- Successful operations and clean cancellations close without a terminal dialog; terminal dialogs appear only for actionable errors, warnings, partial output, or unknown outcomes.
- The frontend test suite, type check, lint, and required browser checks pass.
