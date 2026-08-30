# Archive Collision Resolver UX Plan

## Goal

Replace the archive extraction collision list with a focused, responsive decision workflow that stays usable for one conflict or thousands while preserving the existing durable and direct-local archive operation contracts.

## Problem

The current resolver renders up to ten conflicts, three actions per conflict, batch actions, and a second cancellation action in the same modal. This creates an overlong dialog, duplicate choices, and a large keyboard tab sequence. The current `ListItemText` secondary content also places block content inside a paragraph element.

## Research Basis

- Material dialogs should present one clear decision, normally with no more than two footer actions. Scrollable dialogs retain visible titles and actions. <https://m3.material.io/components/dialogs/guidelines>
- WAI-ARIA modal dialogs contain focus, have a visible cancellation path, and should focus a static summary when structured content must be read before acting. <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- Error-recovery guidance favors information beside its remedy, clear recovery language, and preservation of user input. <https://www.nngroup.com/articles/error-message-guidelines/>

## Target Experience

1. Keep the existing extraction confirmation and operational-progress states.
2. When a collision pauses extraction, show a single current conflict rather than a repeated list.
3. Present archive member, destination path, and only metadata that differs or helps choose an action.
4. Let the user select a resolution, then explicitly continue. The footer contains only `Cancel extraction` and `Continue`.
5. Support an intentional `Apply to remaining conflicts` option for skip and replace. Map it to the existing `skip_all` and `replace_all` decisions.
6. Offer `Replace only older files` as an explicit all-remaining policy when supported.
7. Reveal a validated rename field only after the Rename choice is selected. Preserve its input after failed requests.
8. Use the existing responsive Drawer below `sm`; stack comparison values on mobile and use archive/existing columns on desktop.

## Contract And State Model

The current direct-local and durable operation owners already validate one pending member, persist the decision, resume extraction, and pause again for the next conflict. Preserve that protocol.

Add a frontend view model that has one current conflict and its allowed actions. If a transport provides multiple conflicts, queue them only for display; do not pre-submit decisions. Keep conflict count optional because some owners discover collisions incrementally and cannot truthfully provide a total.

Keep `allowedActions` authoritative. Map selections as follows:

| User selection | Apply to remaining | Existing action |
| --- | --- | --- |
| Skip | No | `skip` |
| Skip | Yes | `skip_all` |
| Replace | No | `replace` |
| Replace | Yes | `replace_all` |
| Replace only older files | Always | `replace_older` |
| Rename | No | `rename` |

## Component Plan

1. Replace `ArchiveExtractionConflictDialog`'s conflict list with a focused `ArchiveConflictResolver` component.
2. Use semantic comparison markup rather than `ListItemText` secondary content. Long paths must wrap safely.
3. Use centralized date and byte formatting helpers; avoid direct `toLocaleString()` calls in the resolver.
4. Keep shared dialog shell, form control styles, and responsive insets in `ResponsiveFormDialog` and `SettingsFormLayout`.
5. Keep active-operation progress separate from the decision body. Rename the fallback label from “Current item” to “Source archive” until member-level progress is actually available.

## Accessibility

- Keep focus inside the modal and place initial focus on the safe Skip choice for file conflicts, or the static conflict summary for directory-only rename cases.
- Arrow keys navigate the resolution choice control. Enter activates Continue only after a valid choice.
- Escape triggers the same cancellation request as `Cancel extraction`; it never silently closes active work.
- Preserve inline validation and form values after an error.
- Avoid using `aria-describedby` for large structured comparison content; keep it attached only to the concise dialog prompt.

## Delivery Sequence

1. Build the frontend decision model and one-conflict resolver without changing archive APIs.
2. Wire choice selection, rename validation, and existing action mapping.
3. Replace duplicate per-row and global actions with the two-action footer.
4. Add responsive comparison layout and semantic markup.
5. Update progress labels to distinguish source archive from truthful member progress.
6. Add unit, integration, keyboard, mobile viewport, and large-collision regression tests.

## Acceptance Criteria

- A thousand collisions do not increase initial modal height or action count.
- File conflicts have one safe default and one explicit Continue action.
- Directory conflicts only expose valid rename behavior.
- The same workflow works with direct-local, relay, and durable extraction.
- Mobile provides a full-height, scrollable body with persistent cancellation and continuation actions.
- No duplicated cancellation controls, invalid block-in-paragraph markup, or fabricated progress totals remain.
