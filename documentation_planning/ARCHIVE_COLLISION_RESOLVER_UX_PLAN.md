# Overwrite Resolution Dialog UX Plan

## Goal

Replace archive extraction's collision list with a reusable, responsive **Overwrite Resolution Dialog** for archive extraction, file copy, and file move operations. It resolves one existing-target conflict at a time, makes source and target easy to compare, and lets people intentionally apply a supported choice to the remaining conflicts in the same operation.

The dialog must remain usable when an operation discovers one conflict or thousands. It preserves each operation owner's durable, direct-local, relay, and cancellation contracts; the dialog decides only the current conflict and never invents policy or operation state.

## Design Principles

- Show one current conflict. Do not render a preview list, queue, or one action group per conflict.
- State the condition plainly: a target already exists.
- Present source and target identities as separately labelled, full-width values. Show the target path, but do not show a source path.
- Treat complete names and paths as primary decision data: never place source and target names side by side, wrap a filename onto multiple lines, truncate it with an ellipsis, or rely on a tooltip to reveal omitted text.
- Reserve side-by-side comparison for compact metadata such as size and modification time.
- Keep the decision compact. The footer contains exactly `Cancel [operation]` and `Continue`; resolutions belong in the body.
- Default to the least destructive valid choice, normally `Skip`. Never make overwriting the implicit Enter action.
- Make bulk behavior opt-in, operation-scoped, and available only for actions the owner declares supported.
- Preserve selected resolution, bulk preference, target-name draft, and actionable errors after a failed request.
- Show a conflict count or progress total only when the owner can provide it accurately.

## Research And Dialog Design Basis

- Material dialogs should present one clear decision and normally have no more than two footer actions. Scrollable bodies retain visible titles and actions. <https://m3.material.io/components/dialogs/guidelines>
- WAI-ARIA modal dialogs contain focus, expose a clear cancellation path, and should direct initial focus to safe or explanatory content appropriate to the decision. <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- Recovery guidance favors clear local explanations, an available remedy, and preservation of user input after errors. <https://www.nngroup.com/articles/error-message-guidelines/>
- The application's dialog guide classifies overwrite conflicts as decision dialogs: use `ResponsiveFormDialog` directly with compact content, rather than `SettingsFormSurface`. It also requires responsive Drawer behavior below `sm`, persistent reachable actions, focus restoration, and Escape cancellation. <../website/content/docs/0.9/developer-guide/frontend-architecture/settings-form-dialog-pattern/>

## Scope

| Operation | Source label | Dialog title | Cancel action |
| --- | --- | --- | --- |
| Archive extraction | Archive item | Resolve existing target | Cancel extraction |
| Copy | Source item | Resolve existing target | Cancel copy |
| Move | Source item | Resolve existing target | Cancel move |

The generic dialog receives operation-specific wording so it never implies a copy is an extraction or a move leaves its source in place. The title remains task-oriented and hides transport or storage implementation details.

Out of scope: pre-scanning every source item, fabricating a conflict total, collecting decisions before a collision is reached, adding a global preference that outlives the operation, or replacing existing confirmation, picker, rename, and active-progress UI.

## Target Experience

1. An operation pauses only when it reaches a target that already exists.
2. The title is `Resolve existing target`; a concise prompt says that a target already exists without repeating a potentially very long item name.
3. Full-width one-line fields show the source name, target name, and target path. The target-name field is read-only unless Rename is selected. A separate static comparison presents size and modification time when useful.
4. The person selects a valid resolution, optionally applies it to future conflicts in this operation, and selects `Continue`.
5. The owner validates and persists the decision, resumes work, and opens the next dialog only for another conflict without an applied policy.
6. A rejected request leaves the dialog open with selections and input intact, explains the failure beside its remedy or in a stable alert, and permits retry.
7. Footer cancel, Escape, and the responsive-shell close request issue the same cancellation request. The dialog never silently closes active work.

## Content And Information Hierarchy

### Prompt

Use a concise description such as: `A target with this name already exists.` The prompt communicates a condition, not an instruction to overwrite. Do not repeat the source or target name in this sentence because a legal filename can be too long to scan or fit well there. Associate only this concise description with the dialog through `aria-describedby`; do not attach the full structured content.

### Source And Target Summary

Use semantic definition-list or table-like markup, never `ListItemText` secondary content. Block content must not be nested in a paragraph. The summary has two distinct regions: full-width identities and a compact metadata comparison.

Render these full-width, individually labelled, one-line values in this order:

1. `Source name`: required.
2. `Target name`: required.
3. `Target path`: required; show only this target path, not a source path.

Names are not comparison columns at any breakpoint. `Source name` and `Target path` use a single-line `DialogReadOnlyField`, or equivalent readonly control, with normal field height and horizontal scrolling for values wider than the field. `Target name` uses that same field in its normal read-only state. The fields must not wrap, grow vertically, show an ellipsis, line-clamp, or hide the full value. They must scroll horizontally with the keyboard and pointer, including while the value is selected; a visible scrollbar is acceptable when the platform renders one. Values remain keyboard-selectable and copyable.

Very long source names, target names, and paths are expected data, not an error state. Preserve their exact value in the control and accessibility tree. Do not shorten a name for the visual UI while exposing a different full value only through a tooltip, `title`, clipboard control, or screen reader. A copy affordance may supplement selection but never replace access to the complete one-line value through horizontal scrolling.

After the identity fields, use a semantic comparison for compact metadata only:

| Property | Source | Existing target |
| --- | --- | --- |
| Size | Show when meaningful and known | Show when meaningful and known |
| Modified | Show when meaningful and known | Show when meaningful and known |

Use centralized byte and date formatting helpers. Missing or non-applicable values render as an intentional unavailable value, never `0 bytes`, a fabricated timestamp, or a blank gap. For directories, omit metadata that is not useful or cannot be truthful; do not present file-only data as directory metadata.

`Existing target` metadata always describes the item that caused the conflict. Selecting Rename changes only the `Target name` field to the proposed new name; it does not alter, duplicate, or relabel the existing target metadata.

At `md` and above, show property names in the first metadata column and aligned source/target values. Below `md`, retain property order but stack source and target metadata values with visible labels. This responsive rule applies only to metadata: full-width source name, target name, and target path fields remain vertically stacked and one line tall at every width. Each field scrolls horizontally as needed; the dialog body scrolls vertically only for the dialog's overall content.

### Resolution Selection

Use a single labelled `RadioGroup` named `Choose a resolution`. Its options derive from the owner's authoritative `allowedActions`; the UI never displays an action the operation cannot honor. The safe supported action is preselected for ordinary file conflicts, normally `Skip`.

| Selection | Meaning | Bulk availability |
| --- | --- | --- |
| Skip | Leave the existing target unchanged and do not transfer this source item. | Optional |
| Overwrite | Replace the existing target with the source item. | Optional |
| Overwrite only older | Replace a target only when source timestamp is newer. | Operation-wide policy only |
| Rename | Transfer the source under a new valid target name. | Never |
| Merge directories | Combine directory contents when explicitly supported. | Owner-defined |

Terminology matches item type and capability. Do not offer rename, merge, timestamp comparison, or overwrite when unsupported. A directory conflict that permits only a safe non-destructive action focuses that action or the static comparison summary when opening.

### Apply To Remaining Conflicts

For `Skip` and `Overwrite`, show an unchecked checkbox directly below the radio group when the corresponding all-remaining action is allowed:

> Apply this choice to remaining conflicts in this operation

The checkbox is disabled or absent for unsupported actions. It is hidden for Rename because every Rename draft must be validated per conflict. `Overwrite only older` is already an operation-wide policy, so it does not show a checkbox. The label makes scope and duration clear: it applies only to later conflicts in the current operation and resets when that operation completes, fails, or is cancelled.

When the resolution changes, retain the checkbox only if the new resolution supports the same bulk scope; otherwise visibly clear it. A checked control requests an all-remaining action from the owner, rather than promising frontend-managed behavior.

### Rename In The Target-Name Field

Do not add or reserve a separate Rename row. `Target name` is the single stable target-name field and occupies the same position in every resolution state. Before Rename is selected, it is read-only and displays the existing target name. When Rename is selected, the same field becomes editable, keeps its `Target name` label, and replaces its displayed value with an extension-aware suggestion derived from the existing target name, such as `report (copy).pdf`.

This mode change must not add, remove, move, resize, or relabel the field. Preserve the immutable existing target name in view-model state; do not render it a second time. Keep a separate rename draft in state so moving away from Rename restores the original read-only target name, while returning to Rename restores the person's previous draft. Validate empty names, invalid filename characters or segments, and known target collisions before submitting where possible. Focus and select the suggested value when Rename is selected so it can be replaced efficiently.

Reserve one helper-text line beneath `Target name` in every resolution state so inline validation does not shift the layout. Preserve the draft after a rejected request and reset it only when the current conflict changes or the operation is cancelled.

### Footer And Pending State

The footer contains exactly two actions:

- `Cancel extraction`, `Cancel copy`, or `Cancel move`: secondary action that requests cancellation from the operation owner.
- `Continue`: primary action that submits the resolution. Disable it while selection or editable target name is invalid, or while a decision request is pending.

While pending, disable duplicate submission and resolution controls, retain the visible selected option, and expose an accessible busy state. Do not add a second cancellation control or close the dialog until the owner reports a resolved terminal state.

## Shared Contract And State Model

### Generic View Model

Create a transport-independent frontend model for one current conflict containing:

- Operation kind and operation-specific labels.
- Source item kind, display name, optional size, and optional modification time.
- Existing target item kind, display name, full target path, optional size, and optional modification time.
- Authoritative `allowedActions` and the actions that permit an all-remaining policy.
- Optional truthful progress context, such as a known ordinal or total.
- Selected action, apply-to-remaining state, target-name rename draft, validation errors, request state, and operation-level error.

The UI may receive multiple conflicts from a transport, but queues them only for display after the previous decision is accepted. It never pre-submits a decision for a future item. Omit a total when the backend discovers collisions incrementally.

### Decision Mapping

Normalize operation-specific protocol names behind dialog adapters. Existing archive action names may remain unchanged; copy and move owners may use their own identifiers.

| Dialog selection | Apply to remaining | Semantic decision |
| --- | --- | --- |
| Skip | No | `skip` |
| Skip | Yes | `skip_all` |
| Overwrite | No | `overwrite` or operation equivalent |
| Overwrite | Yes | `overwrite_all` or operation equivalent |
| Overwrite only older | Always | `overwrite_older` or operation equivalent |
| Rename | No | `rename` with validated target name |
| Merge directories | Owner-defined | Explicit merge decision only when supported |

Do not infer availability from extensions, timestamps, item counts, or frontend assumptions. Owners validate item kind, target, permissions, policy support, rename value, and operation identity before persisting a decision. The frontend handles stale, rejected, or already-resolved decisions with a stable actionable error or refreshed current conflict.

### Lifecycle

1. The operation owner encounters an existing target and records one pending conflict.
2. Its adapter projects that conflict into the generic view model and opens the dialog.
3. The person submits one decision. The client disables duplicates but does not optimistically advance its queue.
4. The owner validates and durably records the decision, resumes work, applies an all-remaining policy where applicable, and returns the next state.
5. The client closes only when the operation has resumed, completed, failed terminally, or been cancelled. A subsequent unhandled conflict opens a fresh dialog with safe default state.

## Component And Ownership Plan

1. Replace `ArchiveExtractionConflictDialog`'s list body with reusable `OverwriteResolutionDialog` decision content.
2. Keep `ResponsiveFormDialog` as the shared shell. It owns desktop Dialog and phone Drawer behavior, sticky mobile actions, safe-area insets, title/prompt relationships, focus restoration, and close blocking.
3. Keep source-specific orchestration in thin archive extraction, copy, and move adapters. They provide wording, view-model conversion, decision mapping, cancellation, and operation subscriptions.
4. Keep action definitions, permission checks, persistence, queue progression, and durable-operation recovery in the operation owners. The dialog is not a policy engine.
5. Extract only genuinely shared helpers: byte and date formatting, full-width single-line identity display with its read-only/editable target-name mode, and the compact metadata comparison layout.
6. Keep active-operation progress separate from the decision body. Archive fallback wording remains `Source archive` until member-level progress exists; copy and move use truthful source-item wording.

## Responsive, Accessibility, And Error Behavior

- Below `sm`, use the existing `ResponsiveFormDialog` Drawer with a scrollable body and actions reachable above safe-area insets. From `sm` upward use its shared Dialog; title and footer remain available while the body scrolls.
- Do not use `SettingsFormSurface` or a two-column settings-editor layout. This is a compact decision dialog. Use normal-height outlined controls with floating labels for the read-only identity fields and the same target-name control when it becomes editable.
- Keep source name, target name, and target path as separate full-width one-line horizontally scrollable fields at every breakpoint. Use desktop comparison columns only for compact metadata and labelled stacked metadata on narrow screens. Title, prompt, identity fields, radios, bulk control, and both actions must remain reachable in a short viewport through vertical body scrolling. Selecting Rename must not shift this layout.
- Initially focus the preselected `Skip` radio for normal file conflicts. For a conflict without a safe selectable action, focus the static comparison summary. Arrow keys navigate the native radio group.
- When Rename is selected, focus and select the editable `Target name` value. After a failed submit, focus the first invalid field; for an owner-level error with no field remedy, focus the stable alert.
- Enter submits only when `Continue` is enabled and focus is not actively editing `Target name` or using composition input. Escape and shell-close requests call the same cancellation request as the footer; show a failure if cancellation is rejected.
- Preserve each complete source name, target name, and target path in the accessibility tree, matching the one-line field value. Keyboard users must be able to focus, select, and horizontally scroll long values. Use programmatic labels for mobile metadata values, such as `Size: Source` and `Size: Existing target`. Preserve contrast, focus indicators, and pending/disabled states in light and dark themes.
- Use field-level errors when editable `Target name` owns the remedy. Use a stable alert above comparison content for stale operations, permission changes, unavailable targets, rejected policies, cancellation failures, or transport errors. Retain valid selections and inputs, and refresh only when the owner reports a new authoritative state.
- If the target disappears before submission, the owner must report changed state; the client resumes without a conflict or displays a refreshed conflict. It must never silently overwrite another item.

## Delivery Sequence

1. Define the generic overwrite-conflict model, action-capability model, and adapter boundary without changing operation protocols.
2. Implement `OverwriteResolutionDialog` with one-conflict presentation, semantic comparison, safe default, conditional bulk control, and stable target-name edit mode with validation.
3. Migrate archive extraction through an archive adapter while preserving durable and direct-local decision mapping.
4. Migrate file copy and move through dedicated adapters, keeping wording, cancellation, and capabilities truthful.
5. Remove archive-only multi-conflict list UI, duplicate cancellation actions, and invalid block-in-paragraph comparison markup.
6. Verify responsive Drawer/Dialog behavior, operation recovery, and truthful progress labels across all adapters.
7. When implementation begins, document the reusable component and adapter contract in the developer architecture documentation.

## Test Plan

### Unit Tests

- Adapters map archive extraction, copy, and move data to neutral source/target labels and correct cancellation wording.
- Allowed actions govern visible choices; unsupported overwrite, rename, merge, timestamp, and bulk options never render.
- Selection and bulk state map to each operation's exact protocol identifier.
- Selecting Rename changes the stable target-name field to an extension-aware suggestion without layout shift; validation blocks invalid continuation and the draft survives failed requests.
- Shared identity display preserves exact very long names and paths in one-line horizontally scrollable controls without wrapping or truncation, while byte and date formatting handles known, unknown, and directory-specific metadata without fabricated values.

### Component And Integration Tests

- A thousand queued or reported conflicts show one current conflict and do not increase initial dialog height, DOM action count, or tab stops.
- File and directory conflicts show source and target names in separate full-width one-line fields, target-only path, and relevant metadata.
- `Skip` is the safe default where allowed; `Continue` has a single explicit submission path.
- Applying Skip or Overwrite to remaining conflicts sends the all-remaining policy and suppresses later prompts only when the owner confirms it.
- Overwrite-only-if-newer is an explicit operation-wide policy without a redundant bulk checkbox.
- Rename is never bulk, keeps a single `Target name` field in place, and preserves its draft after validation and API failures.
- Copy, move, and extraction cancel through their owner contracts from footer, Escape, and shell close requests.
- Errors retain the dialog, selections, and valid inputs; focus moves to the correct field or alert.

### Accessibility And Browser Checks

- Verify modal focus containment, safe initial focus, radio arrow-key navigation, target-name edit focus, Enter behavior, Escape cancellation, and focus restoration.
- Assert semantic source/target associations using a screen-reader-oriented DOM check.
- Check phone Drawer, `sm` through `<md` Dialog, and desktop Dialog at short and tall viewport heights so persistent actions never obscure content.
- Check maximum-length legal filenames for source and target, plus deep target paths, at narrow and desktop widths. Assert one-line field height, no wrapping, no ellipsis or line clamp, keyboard selection, and horizontal scrolling to the complete value without page-level horizontal overflow. Check that selecting Rename changes the existing `Target name` field in place without layout shift.
- Check light and dark themes for readable comparison, validation, focus, disabled controls, and pending states.

## Acceptance Criteria

- Archive extraction, copy, and move use one shared overwrite-resolution decision UI with operation-specific wording and owner-specific adapters.
- The dialog clearly says a target exists and identifies source and target with separate full-width one-line fields.
- Complete source and target names are selectable and horizontally scrollable at every viewport width; they are never side-by-side, wrapped, truncated, line-clamped, or revealed only through a tooltip.
- The identity summary contains exactly one `Target name` field. It displays the existing target name while read-only and becomes the editable proposed name for Rename without changing position, size, or label.
- The identity summary lists source name, target name, and target path only; the compact metadata comparison lists useful known size and modification timestamp values for source and existing target.
- A conflict presents one current item, one resolution group, one optional explicitly scoped bulk control, and two footer actions.
- The least destructive valid action is initially focused; overwrite is never implicit or an accidental Enter action.
- A bulk choice affects only future conflicts in the same operation and only when the owner exposes an authoritative all-remaining action.
- Rename is conditional, validated, non-bulk, and preserves input after errors.
- Directory options, metadata, and wording remain valid for owner-reported item types; unsupported policies never appear.
- The responsive phone Drawer and desktop Dialog keep body content scrollable and both actions reachable without duplication.
- Durable, direct-local, and relay contracts continue to validate, persist, cancel, resume, and recover decisions without frontend-owned policy assumptions.
