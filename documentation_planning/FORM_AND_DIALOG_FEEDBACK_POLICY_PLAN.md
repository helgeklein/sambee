# Form And Dialog Feedback Policy Plan

## Status

Draft proposal. This is a temporary implementation plan and must be deleted after the work is complete. The versioned developer guide is the durable source of truth for the accepted policy.

## Purpose

Define one accessible, predictable feedback, persistence, and visual-consistency policy for all Sambee forms, dialogs, and settings surfaces. It covers validation errors, field warnings, immediate setting persistence, feedback caused by submitting an action, responsive field layout, and shared overlay/form surfaces.

The policy accepts that a newly displayed message occupies space and can move content downward. It prioritizes understandable feedback, normal Material UI behavior, and proximity to the user's task over preserving every pixel of layout geometry.

## Decision Summary

1. Do not reserve blank space for potential helper text or alerts.
2. Use the existing responsive field-layout system for field-owned messages.
3. Show field messages only while active, in normal document flow, with no forced one-line clipping.
4. Render dialog-level messages only while active. Never mount an empty or visually hidden `Alert`.
5. Place a dialog-level message near the top only when it explains an already-known condition of the dialog's initial context. Place a result of a user action near the bottom, immediately above the actions that initiated it.
6. Do not duplicate a field-owned error in a form-level message.
7. Use Material UI defaults unless a small explicit exception is needed for warning severity, accessibility role, or the existing two-column desktop form layout.
8. Use one shared overlay and form-surface token contract for responsive dialogs, the desktop settings dialog, and the mobile settings Drawer. Keep their distinct navigation and interaction models.
9. Ordinary settings persist a valid committed value immediately. Save buttons are reserved for neither routine settings nor hidden API batching; buttons remain only for explicit commands and workflows.
10. Every independently editable server or user setting has its own persisted key and single-target update contract. Do not retain JSON policy blobs for File Search or SMB settings. The backend atomically validates and persists every correlated settings aggregate, so independent client requests cannot commit an invalid combined state.
11. Every ordinary settings `PUT` returns a typed `{ field, value }` result for precisely the committed field; complete settings state remains a `GET` concern.
12. One central field-scoped current-user settings store owns all current-user reads, writes, synchronization, cross-tab invalidation, and subscriptions. It is bound to authenticated identity changes, rejects stale completions, and permits only one in-flight write per field while distinct fields remain concurrent. Components hold their own uncommitted drafts and never call its endpoint, broadcast synchronization, or persist server-backed current-user settings to local storage directly.
13. SMB policy fields persist immediately and use the existing post-commit runtime refresh lifecycle: refresh the in-process settings cache, retire pooled SMB contexts, stop directory caches, and restart active monitors. New connections and restarted directory services use the current policy; active pooled operations finish before their contexts retire.
14. Backend Pydantic models and concise handwritten frontend discriminated unions define the settings contract. Endpoint and client tests keep the matching `{ field, value }` request/result pairs aligned.

## Problem

The existing operation-dialog implementation reserves hidden helper-text and alert space to avoid reflow. In `CopyMoveDialog`, a hidden alert is located before the operation context. Together with normal description and stack margins, this creates a conspicuous empty region between the description and `Source item` in the normal no-message state.

This approach has three problems:

- It makes the common, successful state look sparse and disconnected.
- It changes the semantics of a live alert into a permanently mounted but hidden element.
- It constrains important error text to a one-line ellipsis and hover-only full value.

The existing settings and dialog surfaces also share form controls but do not consistently install or consume the same surface tokens across desktop dialogs, the desktop settings container, and the mobile settings Drawer. This makes the intended background hierarchy depend on the host rather than the user task.

Material UI documents helper text as part of a field's normal flow and notes that it changes a text field's height. Its recommended alignment workaround (an empty helper-text value) is appropriate only when adjacent fields must remain aligned. Material UI also states that alerts should not take keyboard focus, and that dynamically rendered alerts are announced while alerts already present on initial load are not.

The design decision is therefore to accept bounded downward reflow when feedback appears. The invariant is that feedback remains close to the control or action it concerns, not that unrelated content never moves.

## Scope

### Included

- All editable forms and dialogs, including settings forms and file-operation dialogs.
- Inline validation, field-level warnings, submit/API errors, and operation-result warnings.
- Both responsive settings layouts: one-column and desktop two-column.
- Desktop dialogs and mobile Drawer dialogs rendered by the existing responsive dialog shell.
- Desktop settings navigation dialog, mobile settings Drawer, `SettingsPage` frame and action bar, every settings category, and the Browser Viewer Picker and Theme Selector persistence workflows.
- Settings API models, endpoints, service methods, a central field-scoped current-user settings store, per-field persistence migration, and tests needed to support independent field-granular writes.
- Shared feedback primitives, their call sites, tests, and the versioned dialog style guide.

### Direct Implementation Scope

The policy applies to every included form and dialog whenever it is created or changed. This plan's direct implementation work is the shared foundations and named surfaces in **Direct Feedback And Persistence Migrations**; each has an identified feedback, persistence, or visual-host change. The policy does not require an additional repository-wide discovery or refactor before the named work is complete.

### Excluded

- A new global notification/toast system.
- Changing validation rules, business workflows, or cancellation behavior beyond removing routine settings and Theme Selector draft/Save behavior and relocating the Authentication activation command.
- Turning informational help copy into warnings or errors.
- Arbitrarily truncating actionable feedback to preserve dialog dimensions.
- Replacing the settings navigation dialog or mobile settings Drawer with `ResponsiveDialogShell`; their navigation, resizing, and category-selection behavior remain settings-specific.

## Feedback Taxonomy

Every message must have one owner and one placement. Authors must classify it before choosing a component.

| Category | Owner | Examples | Blocking | Placement |
| --- | --- | --- | --- | --- |
| Field error | One editable control | Invalid filename; required value; malformed port | Yes | Associated with that control |
| Field warning | One editable control | A valid but discouraged value | Usually no | Associated with that control |
| Field persistence status | One ordinary settings control | Saving; Saved | No | Small temporary status adjacent to that control |
| Contextual form notice | Dialog/form state known before submit | Batch destination is the current directory; an operation has partial state to explain before action | Depends on message | Top notice region |
| Action-result form notice | A submitted action with no field-owned remedy | API failure; completed copy with source retained; unavailable server-side condition | Depends on message | Bottom notice region |

Do not use a form-level notice for a condition that a user can remedy in one field. Do not show the same condition in both places. When a server rejects a value and identifies its field, map it to that field; otherwise treat it as an action-result notice.

Classify non-field failures by lifecycle as well as ownership. A load, retry, or external-state failure exists before the user submits the current form, so it is a contextual notice in the top region. A save, reset, delete, or operation outcome caused by an action is an action-result notice in the bottom region. Preserve an error's existing Retry control with its top contextual notice when retrying is the available remedy.

Routine settings writes are field-owned persistence, not form submission. A failed ordinary setting write is a field error, and routine success does not use an alert, snackbar, or page-level notice. Action-result notices remain for dialogs and explicit commands such as Authentication activation.

## Field Feedback Policy

### All Single-Column Forms

This includes one- and two-field operation dialogs at every viewport width, and all forms below `md`.

- Use normal Material UI `TextField` or composed `FormControl` helper text directly below the associated control.
- Render helper text only when help, a warning, or an error is active. Do not supply an idle nonbreaking space or set a fixed helper-text height.
- For an error, use the standard `error` prop and `helperText`. Preserve Material UI's normal `aria-describedby` relationship.
- For a warning, use helper text with a visible `Warning:` prefix and warning color. This small exception is necessary because `TextField` models errors directly but has no built-in warning-feedback state.
- Allow feedback to wrap at narrow widths. It must remain readable without hover, touch, or a tooltip.
- When validation is performed after submit, move focus to the first invalid control. Do not also move focus to a form-level alert.
- For immediate-persistence settings, retain an invalid or failed value locally and show its active field error. Clear that error when the user next edits the control or a later write succeeds; do not move focus for an asynchronous persistence failure.

### Multi-Field Forms At `md` And Above

Continue using the established two-column settings layout.

- Keep the external field label and normal description in the left column.
- When a field message is active, replace that field's normal description with the error or warning in the left column.
- Continue to set `error` on an invalid Material UI control so its native error affordance remains visible.
- Associate the control with the replacement message through the existing label/description ID relationship.
- Do not add duplicate helper text below the control at this breakpoint.
- Let the row grow to fit the active message. A longer label-column message moving later rows downward is expected and correct.

The field-layout helpers may need a severity-aware message input rather than their current error-only presentation. Keep label, description, and validation ownership in the concrete form; the shared helper only owns responsive placement and presentation.

### Field Message Content

- State the problem and the correction, for example: `Choose a different name; this name already exists.`
- Use warning only for a value that remains valid. An error blocks submission.
- Do not rely on color, an icon, or a tooltip as the sole indication of severity or content.
- Do not use a live region for feedback that changes on every keystroke. Validate dialog fields after submit unless early validation has a demonstrated user benefit. Settings text and numeric fields validate locally before their committed write.

### Immediate Setting Persistence

Every ordinary settings control follows one model: a valid committed value persists immediately. Users never need to infer whether a given settings page requires a separate Save action.

- Checkboxes, switches, radios, and selects write when their value changes.
- Text and numeric fields write on blur or Enter after local validation succeeds. Do not send a request for incomplete or invalid in-progress text.
- Requests remain independent across controls. Do not queue, serialize, debounce into batches, or coordinate writes between controls; the API applies each field-granular update as it arrives.
- A control permits at most one in-flight write. Disable its control while it is pending and do not queue a later value for it. When the same setting field is rendered by multiple controls, disable every representation of that field while its shared request is pending; unrelated fields remain available and may persist independently.
- Guard every commit handler with a field-local in-flight ref as well as the rendered `disabled` state, so blur and Enter cannot submit the same control twice before React applies its state update.
- Do not replace a field from a whole-settings or stale response. On success of that control's current in-flight request, apply only the server-returned canonical value for the field it wrote, then update its persistence state.
- Remove routine settings drafts, dirty-state comparisons, Save buttons, and successful-save alerts or snackbars.

Use existing Material UI primitives for the compact field status rather than a new notification system:

- While a write is pending, render a small `CircularProgress` adjacent to the field: inline with the desktop `FormFieldLabel` description, or as an `InputAdornment`/label-adjacent element in a single-column control.
- After a successful write, replace it briefly with `CheckCircleOutline`, then remove it. Define one named shared success-display duration constant rather than scattering timer values. The check is supplementary confirmation, not a persistent message or a layout reservation.
- Give an active saving status a localized accessible name with `role="status"`. Do not use `role="alert"` for routine saving or successful-save state.
- Render neither spinner nor check while idle. Do not add an empty adornment, helper line, or fixed-size status container.
- A write failure replaces the temporary status with the field error described above. It remains readable until another edit or successful write resolves it.
- Clear a field's pending and success-display timers when that field is edited, fails, unmounts, or begins another write. A completion callback must affect status only when it belongs to the current field-local write.

The frontend and API use one explicit single-target payload shape rather than reusing a whole-settings object for a one-field change. Each ordinary `PUT` request and result contains exactly one matching `{ field, value }` pair:

```ts
type SingleSettingUpdate<Field extends string, Values extends Record<Field, unknown>> = {
	[Key in Field]: { field: Key; value: Values[Key] };
}[Field];

type SystemSettingsUpdate = SingleSettingUpdate<SystemSettingsField, SystemSettingsValueByField>;
type CurrentUserSettingsUpdate = SingleSettingUpdate<CurrentUserSettingsField, CurrentUserSettingsValueByField>;
type SettingUpdateResult<Field extends string, Values extends Record<Field, unknown>> = SingleSettingUpdate<Field, Values>;
```

Every endpoint declares a Pydantic discriminated union for its permitted field/value pairs, with `extra="forbid"`; the frontend maintains the matching concise handwritten TypeScript union beside the API client. Reject empty, multi-target, unknown, mismatched, and legacy reset payloads at request validation. Do not accept endpoint-specific property-shaped alternatives or derive `field` from an arbitrary submitted property. The response echoes the canonical committed pair. A client applies a response only when its field matches the control's pending request. `GET` routes remain complete page-state reads. Settings APIs expose no reset command: remove legacy reset fields, handlers, buttons, source-gated reset affordances, and reset-specific translations.

Custom themes and viewer associations remain intentional compound values: each entire collection/map is one non-independent user-setting control, has one `UserSettingKey`, and is submitted and returned as one target. Do not split viewer associations into independently persisted entries or merge an update response into a stale cached map. Validate and canonicalize the complete compound value server-side, persist its one row, and replace only that compound value from the matching canonical response.

An initiating workflow outside a settings-page field still owns the same field-local lifecycle. The Browser Viewer Picker owns the `viewer_associations` compound control while `Always use` is selected; it must keep the dialog open while that one write is pending, disable the viewer list and `Always use` checkbox together as that compound control, render saving state on its confirming action, and render a failed write immediately above its actions. Cancellation remains available. It may open the viewer only after persistence succeeds. If product behavior permits opening without persistence after a failure, provide that as a distinct explicit action that leaves the failed association unsaved; do not silently proceed after a failed remembered-selection write.

Theme selection and custom-theme collection edits are distinct current-user controls. A theme selection writes only `theme_id`; a custom-theme add, edit, or removal writes only the complete `custom_themes` compound value. Define one version-controlled, packaged shared built-in-theme ID manifest consumed by the backend validator. The frontend retains its full theme-definition registry and a parity test compares its IDs with the manifest. A `theme_id` is valid only when it appears in that manifest or in the effective custom-theme collection. Custom-theme IDs must be unique and cannot collide with a built-in ID. Do not delete the active custom theme as a two-field transition: require a successful canonical response for a different theme before enabling removal.

Use one short SQLite immediate write transaction for each appearance mutation: acquire the write transaction before reading `theme_id` and `custom_themes`, apply the requested target to the effective aggregate, validate it, write only that target row, then commit. Roll back on every exception. This is required for every `theme_id` or `custom_themes` write, including stale tabs and direct API calls. Do not add a settings lock manager, lock table, keyed mutex, or client-side coordination.

Do not persist server-backed current-user settings to local storage. Theme preview is in-memory state owned by its initiating control only; on a failed write or discarded local candidate, it reverts to the store's last confirmed canonical field value. The initial rendered theme may use the application default while the store loads the authenticated settings, then updates from the complete authoritative `GET` result.

The File Search and SMB policy JSON blobs must be retired as part of this change. Add per-field `SystemSettingKey` values for File Search retention limit, result limit, excluded categories, and excluded extensions; and for SMB authentication mode, encryption mode, and connection timeout. Retain the existing independent SMB read-chunk-size key and the existing independent Network keys. Scalar integers and enum values use their canonical string representations in `SystemSetting.value`. Collection values use a shared JSON-array codec, with a sorted canonical encoding, strict array-of-string decoding, and the existing File Search normalization before persistence. This per-field collection encoding is not a policy blob: one row encodes only its own collection value.

Add one versioned backend database migration that runs after the `systemsetting` table exists. In one database transaction, it must parse each legacy `file_search.policy` and `smb.policy` JSON row with the existing Pydantic models, write its values into missing per-field keys without overwriting a pre-existing per-field value, and delete the legacy JSON row only after all per-field writes succeed. Each materialized row inherits the legacy row's `updated_at` and `updated_by_user_id`; an existing per-field row retains its own value and metadata. Invalid legacy JSON must fail migration with an actionable error and roll back every row created by that migration, leaving both legacy rows untouched. New read, runtime-policy, and update paths must use only per-field keys after the migration; do not retain lazy read fallback or dual-write compatibility behavior.

Invalid request shape is rejected by strict request validation; a well-shaped request with an invalid value or effective configuration receives an actionable field error. For File Search, use one short SQLite immediate write transaction: acquire the write transaction before reading its effective settings, apply the candidate, validate the complete `FileSearchSettings`, trim history when required, write only the target row, then commit. Roll back on every exception. This prevents invalid combined configuration without a database lock subsystem or client serialization. Every endpoint returns the matching canonical field result rather than a whole settings object. Remove source metadata used only to expose reset behavior, including SMB policy source.

Replace `userSettingsSync` with one `userSettingsStore` module. It is the only frontend module permitted to call `GET /auth/me/settings` or `PUT /auth/me/settings`; do not expose a general `patchCurrentUserSettings` helper to components. The store owns the complete canonical snapshot, field selectors, and a `useCurrentUserSetting(field)` hook that exposes `confirmedValue`, shared `pending` and `error` state, `commit(value)`, and `clearError()`. Components retain uncommitted text, selected candidates, and transient previews locally; they clear a field error when the candidate changes.

Extend `authSession` with one identity-change subscription that supplies the user ID and a monotonically increasing epoch. Advance it when the authenticated identity changes or clears, including a later login as the same user; do not advance it for a same-user token refresh. The store clears its snapshot, pending state, errors, and queued refresh when the epoch changes, then loads once for a new authenticated identity. Each `GET` and `PUT` captures that epoch and ignores a completion from an earlier session.

The store keeps one snapshot version and one in-flight request token per field. Beginning a commit increments the snapshot version, marks that field pending, and sends its `{ field, value }` request immediately. A second same-field commit is rejected without sending or queuing another request; distinct fields remain concurrent. On success, replace only the canonical returned field, clear its error, notify subscribers, and publish one BroadcastChannel `invalidate` message. On failure, clear pending, retain the field error, and request a normal refresh; the control continues showing its local candidate and offers retry. The store never returns an ambiguous `null` success/failure result.

Keep one coalesced complete-settings `GET`. It captures the epoch and snapshot version; apply its response only when both still match. Otherwise discard it and run one queued refresh after the active read settles. Focus, visibility, and BroadcastChannel invalidation use that same refresh function. BroadcastChannel carries only `invalidate`, never setting values. Remove `USER_SETTINGS_CHANGED_EVENT` and its complete-settings payload. This protects a newer local write from an older read while controls retain their own drafts.

`ThemeContext`, `LocalePreferencesProvider`, Browser Viewer Picker, Theme Selector, and every File Browser preference hook consume only their owned field selector/hook. ThemeContext derives the active visual theme from store data and supports transient preview, but owns no persistence request, settings event listener, or local-storage write. The initiating UI control owns preview rollback, pending, and failure presentation. Enforce this ownership with targeted searches and tests: no component outside `userSettingsStore` imports `api.updateCurrentUserSettings`, calls the current-user settings endpoint, uses `patchCurrentUserSettings`, listens for `USER_SETTINGS_CHANGED_EVENT`, or writes a storage key for a server-backed current-user setting.

Persist required side effects with a defined order. A File Search retention-limit decrease writes the one field and trims recent-file history inside its aggregate transaction before it commits. An SMB authentication-mode, encryption-mode, or timeout update commits its one persisted field, refreshes the in-process system-settings cache, retires all SMB connection contexts, stops directory caches, and restarts active directory monitors using the existing runtime-refresh implementation. Context retirement immediately removes idle contexts and marks active pooled contexts to retire after their final lease, while restarted directory services establish sessions with the current cache-backed policy. A read-chunk-size update does not trigger this policy-refresh lifecycle. The update returns the normal canonical `{ field, value }` result only after the existing lifecycle completes; retain the established operational error handling for runtime-refresh failure. This model relies on the supported single-backend-worker deployment; changing that deployment requires an explicit cross-worker cache-invalidation design before enabling additional workers.

Explicit commands are not ordinary setting persistence. The settings action bar retains only page-level commands such as Add connection and Add user. Authentication mode activation remains an explicit command because it changes active sign-in behavior and can end the current session; locate it directly below the Authentication mode selector and its description, with its progress and action-result feedback adjacent to that control.

## Form-Level Notice Policy

### Top Contextual Notice Region

Use the top region only for an active message that is already true when the form/dialog is presented, or changes because external context changes rather than because the user submitted the form.

Place it after the outcome description and before the operation context or first control. Render nothing while no message is active.

For a settings page, use this region only for load, retry, or external-state failure. Place it after the settings page header and before the first form control in the page's scrollable content.

Examples:

- A multi-item copy/move whose destination is the current directory.
- A known limitation or partial state that changes the meaning of a pending action.

This region may move the context and controls down when it first becomes relevant. That is acceptable. Do not reserve its height while idle.

### Bottom Action-Result Notice Region

Use the bottom region for a message caused by pressing a dialog/form action where no individual field owns the correction.

Place it after the form body and immediately before submit/cancel actions:

- On desktop, render it at the end of `DialogContent`, directly before `DialogActions`.
- On a mobile Drawer, render it at the end of the scrollable content, directly before the sticky action area.
- On a non-dialog explicit-command form, render it at the end of the form body, immediately before its action row.

Examples:

- The server rejected the requested copy after validation passed.
- A move completed but the source could not be removed.
- An archive action failed without identifying an editable field as the remedy.

The action area may move downward on desktop and the scrollable content may grow on mobile. Actions must remain reachable. Do not place result feedback before passive source/destination context simply to avoid this reflow. Routine setting writes use field-local persistence status and errors, not this region.

### Stacking And Coexistence

- Render one visible notice for one active condition.
- When independent conditions genuinely coexist, stack only the active notices with normal theme spacing.
- Do not reserve one hidden alert-height row for each possible condition.
- Do not combine unrelated messages into one broad alert solely to preserve space.
- A dialog may use both top and bottom regions only when the messages have distinct owners, such as an opening contextual warning and a later API failure. This should be uncommon.

### Severity And Accessibility

- Use `<Alert severity="error">` for an urgent, action-blocking form-level error. Its Material UI default `role="alert"` announces dynamically inserted content.
- Use `severity="warning"` with `role="status"` for a non-urgent warning. Do not assertively interrupt a user for every advisory message.
- Do not focus an `Alert`. Keep focus on the submit action that produced an action-result notice, or move it to the first invalid field for field validation.
- Do not render an empty alert with `visibility: hidden`, `aria-hidden`, or placeholder text. A real alert exists only while there is a real message.
- Keep messages actionable and concise, but allow wrapping. Do not clip, ellipsize, or make full error content available only through a pointer-hover tooltip.

## Target Component Architecture

The current locations reflect historical ownership, not reusable responsibilities. The following is the desired ownership structure, but delivery of feedback and persistence behavior may use the existing modules. Move or rename a cohesive primitive only after its behavior migration is complete and its direct tests pass:

```text
	theme/
		palette.ts                    # shared overlay and form-surface token contract
	components/
	Dialog/
		ResponsiveDialogShell.tsx   # responsive desktop Dialog/mobile Drawer shell
		DialogNotice.tsx            # visible-only contextual and action-result notices
		DialogReadOnlyField.tsx     # labelled selectable value shown in a dialog
	Form/
		FormLayout.tsx              # reusable form surface, group, row, field label, and control styles
	Settings/
		SettingsFormLayout.tsx      # settings-only sections composed with SettingsGroup
		SettingsDialog.tsx          # settings product container
		SettingsPage.tsx            # settings content frame and contextual-notice host
		SettingsActionBar.tsx       # page-level command row only
```

The refactor is intentionally responsibility-based:

- `ResponsiveFormDialog` becomes `ResponsiveDialogShell` and moves out of `Admin`, because it is an application-wide responsive overlay shell rather than an admin form component.
- `DialogFormNotice` and `DialogFormNoticeRegion` become `DialogNotice` and `DialogNoticeRegion` in `components/Dialog`. They are dialog-level message primitives and must not be owned by Settings.
- Reusable `SettingsFormSurface`, `SettingsFormGroup`, `SettingsFormRow`, `SettingsFormFieldLabel`, and generic control styles become `FormSurface`, `FormGroup`, `FormRow`, `FormFieldLabel`, and corresponding `form*` style exports in `components/Form/FormLayout.tsx`.
- `SettingsFormSection` remains settings-specific because it composes `SettingsGroup` and its settings section-heading conventions. It remains in a reduced `components/Settings/SettingsFormLayout.tsx` or moves to an equivalently named settings-only module.
- `DialogReadOnlyField` moves from `Admin` to `Dialog` without changing its interaction semantics.
- `DialogOperationContext` and `DialogIdentifierDisplay` remain in `FileBrowser`: they express file-operation identifiers, not generic form or dialog behavior.
- Generalize `getDialogSurfaceTokens`, `DIALOG_SURFACE_CSS_VARIABLE`, and `DIALOG_FORM_SURFACE_CSS_VARIABLE` into `getOverlaySurfaceTokens`, `OVERLAY_SURFACE_CSS_VARIABLE`, and `FORM_SURFACE_CSS_VARIABLE`. This describes their shared use by dialogs and settings overlays without assigning their ownership to either feature area.
- `ResponsiveDialogShell`, `SettingsDialog`, and `MobileSettingsDrawer` install the same overlay/form tokens on their Paper surfaces. `SettingsPage`, `SettingsActionBar`, and generic form controls consume them, with a theme-background fallback for an unhosted render.
- `SettingsDialog` and `MobileSettingsDrawer` remain settings-specific hosts. They must not be rebuilt on `ResponsiveDialogShell`, because desktop resizing/sidebar navigation and mobile category navigation are distinct product behavior.

Do not introduce compatibility re-exports or duplicate implementations for a completed cleanup. A source-to-target import rewrite is a mechanical follow-up to each move, not a prerequisite for behavior changes and not a single all-or-nothing refactor.

Complete this refactor alongside the direct behavior migrations that establish each primitive's reuse. It does not require unrelated forms, dialogs, or settings pages to migrate before a completed workflow group can be delivered.

## Shared Component Design

### Form Layout Helpers

Retain the established responsive behavior through the current row and field-label primitives. Revise the field-label contract so a field can express an optional message with severity rather than treating only errors as special. A later cleanup may rename or relocate those primitives to the target Form ownership path.

Define and use one shared `FieldFeedback` contract in `components/Form`:

```ts
type FieldFeedback =
	| {
			message: ReactNode;
			severity: "error" | "warning";
		}
	| null;
```

`FormFieldLabel` receives this optional feedback together with the existing field description and description ID. The concrete form remains responsible for validation and chooses whether a valid warning blocks submission. The shared layout owns only the responsive presentation: error color and standard control error state remain separate concerns; warning feedback uses the existing warning color and a localized visible `Warning:` prefix. In both layouts, the control's `aria-describedby` must reference the active message ID, or the normal description ID when no message is active.

The helpers must support:

- no active message: normal description appears;
- error: normal description is replaced by an associated error at desktop widths and helper text at single-column widths;
- warning: normal description is replaced by an associated warning at desktop widths and helper text at single-column widths.

Do not create a separate visual system for operation dialogs. One- and two-field operation dialogs continue to use standard MUI labels and helper text in a single column.

### Dialog Notice Components

Implement `DialogNotice` as a small shared visible-only `Alert` wrapper. It accepts message, severity, test ID, and an optional accessibility role. It returns `null` when no message is supplied.

The component must not:

- set `minHeight` for an idle state;
- set `visibility: hidden`;
- render placeholder content;
- force single-line overflow or text ellipsis;
- wrap content in a hover-only tooltip;
- set `tabIndex` or move focus.

`DialogNoticeRegion` is a visible-only stack for callers that genuinely have concurrent notices. It returns `null` when every message is absent.

### Responsive Dialog Shell

Implement optional named `contextualNotice` and `actionNotice` slots in the existing responsive dialog shell, so desktop and mobile placements cannot drift. A later cleanup may rename it to `ResponsiveDialogShell`.

The shell should render:

```text
Title
Description
[contextual notice, only while active]
Operation context and form body
[action-result notice, only while active]
Actions
```

On mobile, the action-result notice must be in the scrollable content directly before the sticky actions, never underneath or behind them.

Non-dialog forms should use the same top/bottom order in their own form body and action row. The policy is universal even where `ResponsiveDialogShell` is not the host component.

### Settings Page Frame

Implement `SettingsPage` as the non-dialog host for top contextual notices. It accepts an optional `contextualNotice` slot and renders:

```text
Settings page header
[contextual notice, only while active]
Settings form or page body
[page-level command action bar, only when commands exist]
```

The contextual notice is inside existing scrollable content and precedes the body. The frame renders no notice element or placeholder while idle. It does not own an action-result slot for routine setting persistence: ordinary setting writes use field-local saving, saved, and error states. Explicit commands own feedback next to their command.

### Shared Overlay And Form Surfaces

Install the shared overlay and form-surface CSS variables on every overlay Paper host. Use the overlay value for the settings navigation/sidebar, settings page, and dialog paper; use the form value for `FormSurface` and outlined field label backgrounds. Preserve the current theme fallback when a component is rendered outside an overlay host.

For `ResponsiveDialogShell`, compose the token-setting base Paper styles before the caller-provided `paperSx` rather than replacing it. Caller styles continue to own geometry and specialized behavior such as the resizable Keyboard Shortcuts dialog; they may override a surface value only through an explicit, intentional `paperSx` declaration. Apply the same composition rule in the desktop Dialog and mobile Drawer paths.

Apply this token contract on both desktop and mobile before making page-level visual adjustments. This is a visual unification, not a change to spacing, keyboard behavior, settings navigation, resizing, or responsive breakpoints.

### Settings Responsive Layout

Use `FormRow` and `FormFieldLabel` at `md` and above only for genuine multi-field settings editors. Keep their two equal columns, external labels/descriptions, and normal row dividers. Below `md`, keep a single-column layout with full-width controls and active helper text below the associated control.

Do not force the two-column form layout onto category navigation, searchable lists, viewer selection, or a compact one-control preference. Those surfaces retain their task-appropriate single-column/list presentation while inheriting the shared overlay and form colors.

## Direct Feedback And Persistence Migrations

The following surfaces have an identified feedback, persistence, or visual-host change. Surfaces without one are not implementation work for this plan; they retain their current task-specific behavior.

### Shared Foundations And Hosts

| Surface | Location | Processing required |
| --- | --- | --- |
| Responsive dialog and Drawer shell | `components/Admin/ResponsiveFormDialog.tsx` | Direct behavior migration: add named visible-only contextual and action-result notice slots with identical desktop/mobile order. Relocate and rename it to `components/Dialog/ResponsiveDialogShell.tsx` only as a separate mechanical cleanup. |
| Dialog notices, read-only field, and reusable form layout | `components/Settings/SettingsFormLayout.tsx`, `components/Admin/DialogReadOnlyField.tsx` | Direct behavior migration: remove idle reservations and add severity-aware field feedback in the existing helpers. Extract or relocate cohesive dialog/form primitives only after the behavior tests pass. |
| Overlay/form surface tokens | `theme/palette.ts`, `components/Settings/settingsSurface.ts` | Direct visual migration: apply one overlay/form token contract to every host while preserving theme fallbacks. Rename dialog-specific token APIs only as a separate mechanical cleanup. |
| Settings page and action frame | `components/Settings/SettingsPage.tsx`, `components/Settings/SettingsActionBar.tsx`, `components/Settings/SettingsSectionHeader.tsx` | Direct migration: add a visible-only contextual notice slot; render the action bar only for page-level commands; consume the shared surface hierarchy. |
| Settings update APIs and persistence | `shared/built_in_theme_ids.json`, `frontend/src/theme/themes.ts`, `frontend/src/services/authSession.ts`, `backend/app/core/system_setting_definitions.py`, `backend/app/db/migrations.py`, `backend/app/models/system_settings.py`, `backend/app/api/system_settings.py`, `backend/app/services/system_settings.py`, `backend/app/models/user_settings.py`, `backend/app/api/auth.py`, `backend/app/services/user_settings.py`, `frontend/src/services/api.ts`, `frontend/src/services/userSettingsStore.ts`, `frontend/src/types/` | Direct migration: add a packaged shared built-in-theme ID manifest for backend validation and registry parity testing; replace `file_search.policy` and `smb.policy` JSON blobs with independent per-field keys through one versioned transactional migration; use strict `{ field, value }` requests and canonical single-field responses for File Search, Network, SMB, System, and current-user settings. Replace `userSettingsSync` with the sole field-scoped frontend owner of current-user API access, identity-aware snapshot refresh, cross-tab invalidation, and subscriptions. |
| Settings dialog container | `components/Settings/SettingsDialog.tsx` | Direct visual migration: retain resize/sidebar behavior while installing shared overlay/form tokens and preserving the desktop two-column form breakpoint. |
| Mobile settings Drawer | `components/Mobile/MobileSettingsDrawer.tsx` | Direct visual migration: retain category navigation while installing shared overlay/form tokens and ensuring scrollable notices/actions remain readable and reachable. |

### Direct Feedback And Visual Migrations

These concrete surfaces currently own feedback, host a feedback-owning workflow, or need a policy-driven visual/layout update. This is the direct implementation checklist; it does not require discovery or migration of additional surfaces before these entries are complete.

| Surface | Location | Current feedback | Required result |
| --- | --- | --- | --- |
| Copy / Move | `components/FileBrowser/CopyMoveDialog.tsx` | Hidden notice region before operation context; fixed filename feedback | Same-directory batch condition is a visible-only top contextual notice. API errors/warnings are visible-only action-result notices. Filename validation uses normal helper text. |
| Shared name-entry dialog | `components/FileBrowser/NameInputDialog.tsx` | Fixed helper feedback and hidden API notice | Render active field feedback normally and API feedback only above actions. |
| Rename workflow | `components/FileBrowser/RenameDialog.tsx` | Uses `NameInputDialog` with rename-specific validation | Adapt and test through the shared dialog; no duplicate rename error notice. |
| Create file/directory workflow | `components/FileBrowser/CreateItemDialog.tsx` | Uses `NameInputDialog` | Adapt and test through the shared dialog, retaining destination context and normal name feedback. |
| Archive extraction | `components/FileBrowser/ArchiveExtractDialog.tsx` | Fixed destination-name feedback and hidden API notice before content | Use normal destination-name helper feedback and a visible-only action-result notice above actions. While member resolution is active, it exclusively owns the member-error action-result notice because it also owns Retry/Ignore/Cancel actions. |
| Archive member error resolution | `components/FileBrowser/ArchiveMemberErrorResolver.tsx` | Active error/warning alert with Retry/Ignore actions | Remove its direct alert. Render only error-specific operation context and resolution controls; the parent supplies the one visible, fully readable action-result notice. |
| Overwrite conflict resolution | `components/FileBrowser/OverwriteConflictDialog.tsx` | Hidden owner-error notice before metadata, alert focus, fixed Rename feedback | Move owner feedback to visible-only action-result placement; remove alert focus; retain field-owned Rename feedback at its control. |
| Connection editor | `components/Admin/ConnectionDialog.tsx` | Multi-field validation, descriptions, and server errors | Apply the existing one-/two-column policy consistently and ensure no placeholder helper space is introduced. |
| Change password | `pages/AccountSettings.tsx` | Password-confirmation feedback | Remove idle placeholder helper text and use normal active field feedback. |
| OIDC configuration editor | `pages/AuthenticationSettings.tsx` | Multi-field provider and role-mapping validation | Apply the desktop label-column and mobile helper-text rules to every validation path. |
| OIDC mapping review dialog | `pages/AuthenticationSettings.tsx` | Mapping-selection and validation feedback | Apply the same responsive field and action-result notice policy. |
| User editor | `pages/UserManagementSettings.tsx` | Multi-field validation, including duplicate usernames | Apply the desktop label-column and mobile helper-text rules without duplicate notices. |
| Reset password | `pages/UserManagementSettings.tsx` | Password validation | Use visible-only field feedback; verify action-result errors have the correct owner and placement. |
| OIDC account-mapping editor | `pages/UserManagementSettings.tsx` | Expected-username/account-selection validation | Apply the existing responsive field rules and visible-only action-result notices where applicable. |
| Appearance settings | `pages/PreferencesSettings.tsx`, `theme/ThemeContext.tsx`, `services/userSettingsStore.ts` | Draft/preview state, page Save action, and fire-and-forget custom-theme persistence | Persist theme and locale choices immediately through the field-scoped store; remove page-wide draft/Save behavior while retaining an initiating control's local preview. The initiating theme/custom-theme controls own their one-target commit, pending/error/retry state, and preview rollback; ThemeContext owns no settings persistence or local storage. |
| Theme Selector | `components/ThemeSelector.tsx`, `theme/ThemeContext.tsx`, `services/userSettingsStore.ts` | Preview draft, Save action, and immediate dialog close after a fire-and-forget theme write | Persist the selected theme immediately through the one `theme_id` store hook, disable its selectable list while pending, and associate saving/saved/error state with that list. Do not close automatically for pending or failed writes; clearing the local candidate after a failure restores the last confirmed preview. |
| File Browser settings | `pages/FileBrowserSettings.tsx` | Draft preference state and page Save action | Persist each preference immediately; remove draft/saved comparison and the Save action; retain explicit clear-history dialogs. |
| File Browser runtime preferences | `pages/FileBrowser/preferences.ts`, `services/userSettingsStore.ts` | Fire-and-forget current-user writes, whole-settings event listeners, and optimistic local-storage updates outside the Settings page | Direct migration: route every current-user preference through its field-scoped store hook and selector. Keep the initiating control as the status/error owner, disable it while pending, and remove local-storage persistence for server-backed values. |
| Text Editor settings | `pages/TextEditorSettings.tsx` | Draft numeric input and page Save action | Persist a locally valid value on blur or Enter; remove saved-value comparison and the Save action. |
| File Search settings | `pages/FileSearchSettings.tsx` | Full-policy Save action and field validation | Persist each valid setting through a single-target API request and apply its canonical response only to that field; show local saving/saved/error state and remove the Save action. |
| Network settings | `pages/NetworkSettings.tsx` | Full-form Save action and field help | Persist each valid field through a single-target API request, apply canonical URL/CIDR output only to that field, show local saving/saved/error state, and remove the Save action. |
| SMB settings | `pages/SmbSettings.tsx` | Full-form Save action plus load/retry and field validation | Persist each valid policy or resource setting through a single-target API request; retain top load/retry contextual notice and field-local persistence feedback; remove the Save action. |
| System settings | `pages/AdvancedSettings.tsx` | Full-page Save action, legacy reset handler, and dynamic validation | Retain composed `FormControl` accessibility; persist each valid setting with a single-target partial request, apply only its canonical response, use field-local status/error feedback, remove the Save action and legacy reset UI/handler. |
| Browser Viewer Picker | `components/FileBrowser/BrowserViewerPicker.tsx`, `pages/FileBrowser/useFileBrowserPane.ts`, `services/userSettingsStore.ts` | Responsive dialog shell, read-only file field, single-column selection list, and a remembered viewer-association write that currently outlives the dialog | Use the shared dialog feedback behavior and overlay/form tokens. Retain its list-based single-column picker layout; do not add a two-column settings form. When `Always use` is selected, use the one compound `viewer_associations` store hook; keep the picker open, disable the viewer list and checkbox while pending, show pending state on Confirm, and show failure immediately above the actions. Open the viewer only after success, or after a separately explicit open-without-saving choice. |

### Scope Guard

Do not add feedback primitives, field layouts, or visual rewrites to confirmation dialogs, viewer dialogs, menus, navigation Drawers, searchable lists, or read-only settings pages without an identified feedback or persistence defect. List, picker, and read-only settings tasks retain their existing task-appropriate layout.

### Workflow Owners Requiring Integration Verification

These are not independent feedback presentations, but they construct or launch an in-scope dialog and must be checked so errors retain the correct owner and placement.

| Owner | Location | Verification |
| --- | --- | --- |
| File browser orchestration | `pages/FileBrowser.tsx` | Archive-create and transfer workflow errors reach the shared dialog's correct contextual or action-result slot. |
| Connection settings launcher | Settings connection-management surface | Connection errors continue to reach `ConnectionDialog` without a duplicate page-level notice. |

The policy deliberately excludes transient snackbars, menus, popovers, code-editor find/replace controls, and inline search/filter controls. They are not dialogs or submitted forms and retain their existing component-specific feedback behavior.

## Documentation Revisions

Before deleting this plan, revise the versioned developer guide:

- `website/content/docs/1.0/developer-guide/frontend-architecture/settings-form-dialog-pattern/index.md` must describe visible-only field feedback and contextual/action-result form notices.

The published guide must not claim that notices remain mounted while idle, that feedback is one line, that tooltips supply the only complete error text, or that routine settings require a Save action. Document the feedback taxonomy, immediate-persistence commit events, no-client-serialization rule, field-granular `{ field, value }` contract, saving/saved/failure accessibility behavior, one-column/two-column field rules, top/bottom form-notice placement, and accessibility requirements. It must define `userSettingsStore` as the sole frontend API boundary, one in-flight write per field, identity-change hydration, stale request rejection, invalidation-only cross-tab refresh, and the prohibition on server-backed local storage. Document the built-in-theme ID manifest, transaction-based aggregate validation, and SMB's existing complete post-commit runtime refresh lifecycle. Keep implementation mechanisms such as snapshot versions and refresh coalescing in code and tests, not the durable guide. Update `DIALOG_OPERATION_CONTEXT_UX_PLAN.md` only as needed to remove a contradictory completed-policy claim; it is not a second durable policy source.

## Implementation Plan

### Phase 0: Persistence And Store Prerequisites

1. Add the File Search and SMB per-field `SystemSettingKey` values and one versioned migration. In one transaction, materialize valid legacy JSON rows into missing per-field rows, retain existing row values and metadata, preserve inherited legacy metadata for inserted rows, and delete a legacy row only after all replacement rows are durable. Invalid legacy JSON fails with an actionable error and rolls back every migration write. New reads and updates use only the new keys.
2. Change File Search, Network, SMB, System, and current-user endpoints and frontend clients to strict discriminated `{ field, value }` request/result unions. Remove whole-settings update responses, reset inputs, reset UI, source-gated reset state, and reset-only response metadata. Preserve explicit empty, false-like, and null values when valid for their documented field.
3. Add the built-in-theme ID manifest for backend validation and a frontend-registry parity test. Implement the File Search and per-user appearance aggregate mutations as short SQLite immediate write transactions: read the effective aggregate, apply one target, validate, perform the required row write and side effect, then commit or roll back.
4. Replace `userSettingsSync` with `userSettingsStore`. Add an auth identity epoch that changes on logout or identity transition but not same-user token refresh. Implement a canonical snapshot, one snapshot version, one coalesced refresh, and one pending request token per field. The hook exposes only `confirmedValue`, `pending`, `error`, `commit`, and `clearError`; components own local drafts and previews. Delete direct current-user API calls, complete-settings window events, and server-backed current-user local-storage writes outside the store.
5. Retain the existing post-commit SMB runtime refresh for policy fields: refresh `SystemSettingsStore`, retire pooled contexts, stop directory caches, and restart active monitors. Read-chunk updates do not perform that refresh.

### Phase 1: Establish Visible-Only Behavior

1. Add a small shared message type containing `message` and `severity` in the current shared layout module.
2. Remove fixed-height, placeholder, ellipsis, and tooltip behavior from the current field-feedback helper; use native MUI props where clearer.
3. Make the shared dialog notice return `null` when idle and use normal MUI `Alert` rendering while active. It may be extracted and renamed to `DialogNotice` after its behavior tests pass.
4. Add named top/bottom notice slots to the current responsive dialog shell with matching desktop and mobile placement. Rename or relocate the shell only as a later mechanical cleanup.
5. Add a named top contextual-notice slot to `SettingsPage`. Render it in scrollable content before the page body only while active; do not add a general bottom action-result slot for routine setting writes.

### Phase 2: Adapt Field Layouts And Settings Visual Frame

1. Extend the existing field-label helper to present error or warning text and compact field persistence status in the desktop label column while preserving the control's accessible description relationship.
2. Provide one small field-local persistence-state helper for system settings and `useCurrentUserSetting` for current-user settings. Each provides pending/error state, duplicate-commit exclusion, cleanup, and a named success-display timer. The store keeps same-field pending state shared; controls keep drafts and preview state. Neither mechanism queues, serializes, batches, or coordinates distinct field writes.
3. Update single-column controls to render only active normal MUI helper text plus the compact saving/saved status at the field label or input adornment. Disable every representation of a pending setting field while leaving unrelated controls enabled.
4. Keep existing settings forms on their established two-column/one-column breakpoint behavior.
5. Verify each affected field remains correctly labelled and described in both modes.
6. Apply the shared overlay/form tokens to the responsive dialog shell, `SettingsDialog`, and `MobileSettingsDrawer`, then ensure `SettingsPage`, `SettingsActionBar`, form surfaces, and outlined controls consume the same hierarchy.
7. Make `SettingsActionBar` command-only: remove routine Save actions and render no empty bar. Preserve list, picker, read-only, navigation, and resize behavior rather than applying form geometry indiscriminately.

### Phase 3: Migrate Feedback And Overlay Consumers

1. Migrate the file-operation workflows: `CopyMoveDialog` first, then `NameInputDialog` and its Rename/Create callers, `ArchiveExtractDialog`, `ArchiveMemberErrorResolver`, and `OverwriteConflictDialog`. Remove each idle reservation and use the shared named slots where the policy assigns ownership to the dialog. For archive member resolution, derive one `actionNotice` in `ArchiveExtractDialog` from the active member-resolution state, clear it when that state clears, and remove the resolver's direct alert so the message appears exactly once above Retry/Ignore/Cancel.
2. Migrate `BrowserViewerPicker` to the shared dialog feedback behavior and verify its desktop/mobile surface hierarchy without changing its single-column list layout. Replace its direct preference write with the `viewer_associations` store hook. When its remembered-selection compound control persists, keep the dialog open, disable the viewer list and `Always use` checkbox as that one compound control, show pending state on the confirming action, and place an actionable failure immediately above the actions; do not open the viewer until persistence succeeds or the user chooses a separately explicit open-without-saving action. Keep cancellation available.
3. Migrate the connection editor in `ConnectionDialog`, preserving its established responsive field layout and mapping server feedback to its owning field or action-result notice.
4. Migrate the Account settings Change Password form, including its confirmation-field feedback and submit-result feedback.
5. Migrate the Authentication settings OIDC configuration editor and mapping-review dialog, including every validation and action-result path. Move non-OIDC Activation below the Authentication mode selector and description; retain it as an explicit local command with adjacent progress and action-result feedback.
6. Migrate the User Management user editor, Reset Password workflow, and OIDC account-mapping editor, including every validation and action-result path. Retain only Add user in the settings action bar.
7. Migrate Appearance, Theme Selector, File Browser settings and runtime preferences, and Text Editor settings to immediate persistence through `userSettingsStore`. Remove page-wide drafts, dirty-state comparison, Save actions, save-success messages, direct current-user API calls, current-user settings events, and server-backed current-user local-storage persistence while preserving existing explicit commands. Each initiating control receives its own success/failure result from its store hook; compound custom-theme and viewer-association editors persist their complete compound value as their one control. On failed Theme Selector persistence, clearing the control's local candidate restores its last confirmed preview. Make ThemeContext a store consumer and visual-theme provider only. Migrate `LocalePreferencesProvider` and every File Browser preference hook to field selectors/hooks. Require a successfully persisted replacement theme before allowing removal of the active custom theme, while the backend appearance transaction rejects a stale or direct removal attempt that would orphan the active custom theme.
8. Migrate File Search, Network, SMB, and System settings to immediate field-granular persistence. Keep local validation and composed-control behavior; send independent valid single-target writes; apply a matching request's canonical field response without replacing unrelated local fields; show field-local saving/saved/error states; retain top contextual load/retry notices; remove routine Save actions and all legacy reset UI, handlers, and translations. SMB policy fields use the same ordinary field-persistence states as every other setting while their existing post-commit runtime refresh completes.
9. Run focused tests after each workflow group. A group is independently deliverable when its named behavior and tests are complete. Remove its now-unused fixed-slot exports and call sites after that group, without waiting for unrelated groups.

### Phase 4: Documentation And Validation

1. Update the versioned developer guide with the accepted policy and remove only contradictory completed-policy claims from the prior operation-context plan.
2. Refresh website derived documentation artifacts through the required docs workflow.
3. Run focused backend and frontend tests after each dialog, settings-page, API-model, and overlay-host migration.
4. Run the full backend and frontend test suites, TypeScript check, lint, and responsive browser checks after the final migration.
5. Delete `FORM_AND_DIALOG_FEEDBACK_POLICY_PLAN.md` after the developer guide, implementation, and validation are complete.

## Test Plan

### Shared Feedback And Hosts

- The responsive dialog shell preserves its current responsive, focus, Escape, and action behavior while rendering no idle field-feedback or notice space.
- Active field errors and warnings are associated with their control; desktop multi-field forms replace the left-column description and mobile forms render helper text below the control.
- Active notices wrap, have the required alert/status role, and never receive programmatic focus. Idle notices render no `Alert` element.
- `SettingsPage` renders a load/retry notice before its body only while active. Overlay/form tokens apply to the responsive shell, desktop settings, and mobile settings without changing resize, navigation, or specialized caller Paper styles.

### Persistence And API

- The migration splits valid legacy File Search and SMB blobs into per-field rows, preserves existing-row precedence and inserted-row metadata, deletes a legacy row only after durable replacement rows, and rolls back fully on invalid JSON.
- Each settings endpoint accepts exactly one documented `{ field, value }` pair and returns its canonical pair. Tests reject empty, multi-target, unknown, mismatched, retired policy, and reset payloads while accepting documented empty, false-like, or null values.
- A field update preserves unrelated persisted settings and reflects canonical URL, CIDR, and extension normalization only in the matching control.
- File Search and appearance mutations use an immediate SQLite write transaction. Tests cover valid aggregate updates, rejected invalid aggregates, retention trimming in the same transaction, and request orderings that must not leave an invalid effective configuration.
- Theme validation accepts built-in manifest IDs and effective custom themes, rejects duplicate custom IDs and built-in collisions, and prevents removing the active custom theme. The manifest and frontend theme registry have matching IDs.
- Custom themes and viewer associations remain complete compound field values; no stale client-side map merge occurs.
- SMB policy changes retain the existing cache refresh, context retirement, cache stop, monitor restart, and normal canonical response. Read-chunk updates do not trigger that lifecycle.

### Current-User Store And Controls

- Targeted searches prove that `userSettingsStore` is the only frontend caller of current-user settings APIs and that `userSettingsSync`, its window event, direct patch helper, and server-backed local-storage writes have no remaining consumer.
- The store loads once for a new authenticated identity, retains its snapshot across a same-user token refresh, clears on logout or identity change, and ignores `GET` or `PUT` completions from an earlier epoch.
- A `GET` that began before a commit cannot overwrite the commit result: its snapshot-version mismatch discards it and schedules at most one follow-up refresh. Refreshes coalesce across focus, visibility, and BroadcastChannel invalidation.
- A successful commit replaces only its canonical field and sends one invalidation. A failed commit exposes a concrete field error, retains the initiating control's local candidate, and requests a normal refresh. Invalidations contain no setting value.
- Duplicate same-field commits send no second request; distinct field commits remain concurrent. Every representation of a pending field is disabled while unrelated fields remain usable.
- Selects and toggles commit on change; text and numeric inputs commit only a locally valid value on blur or Enter. Pending, saved, and failure feedback is field-local, accessible, and has no idle reservation.

### Direct Workflows And Regression

- Each listed direct dialog migration has a focused test for its contextual notice, action-result notice, or field feedback. Archive member resolution renders exactly one parent-owned notice above its controls.
- The Browser Viewer Picker remains a single-column list, stays open for a remembered-viewer write, and opens a viewer only after persistence succeeds or an explicit unsaved path is chosen.
- Theme Selector, File Browser preferences, locale, and text-editor preferences use immediate persistence through the store. Failed theme persistence restores the initiating control's last confirmed preview when its local candidate is discarded.
- Routine settings pages have no Save button, dirty-state comparison, success alert, reset control, or reset-only response metadata. The settings action bar contains only explicit page commands.
- Existing validation focus, cancellation, i18n, identifier formatting, bidi isolation, and conflict-resolution behavior remain unchanged. Feedback is readable at 200% zoom and a 320 CSS-pixel viewport.
- Run focused backend and frontend tests throughout, then the full frontend suite, TypeScript check, lint, backend validation, and approved browser checks at `http://localhost:3000/browse/smb/demo`.

## Acceptance Criteria

- Forms and dialogs render feedback only while active; messages are readable, associated with their owner, and placed near the relevant field or action.
- Ordinary settings persist valid committed values immediately with independent field writes, local saving/saved/error feedback, and no routine Save or reset workflow.
- All ordinary update APIs use strict canonical `{ field, value }` request/result pairs. File Search and SMB policy blobs are migrated to per-field keys without compatibility reads or dual writes.
- File Search and user appearance invariants are enforced by short immediate SQLite transactions; the frontend does not serialize independent writes.
- `userSettingsStore` is the sole current-user API owner. It protects identity changes and stale complete reads with an epoch and snapshot version, rejects duplicate same-field writes, invalidates other tabs without sending values, and never persists server-backed settings locally.
- SMB policy writes preserve the existing complete post-commit runtime refresh lifecycle before returning.
- The responsive dialog shell, desktop settings, and mobile settings share the intended surface hierarchy while retaining their distinct behavior. Component relocations or renames are optional mechanical cleanup after behavior delivery.
- The developer guide records the durable policy, this temporary plan is deleted after completion, and focused tests, full validation, and browser checks pass.
