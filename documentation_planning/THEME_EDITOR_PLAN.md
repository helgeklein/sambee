# Theme Editor Plan

## Goal And Scope

- In Settings > Appearance, let users select, copy, edit, import, and export themes. Let administrators manage site themes and set the site default.
- Keep theme selection stable across upgrades and make the editor usable despite a large palette.
- Do not migrate pre-existing custom themes or promise compatibility with older exports. Require new, copied, and imported themes to satisfy the new validation contract.

## Current State

- Sambee ships two built-in themes: `sambee-light` and `sambee-dark`.
- The frontend selects themes by persistent ID; the backend stores per-user custom themes. Site themes and a site default do not yet exist.
- The backend returns `sambee-light` even when no user preference is stored. Before adding a site default, distinguish:
	- No user override: use the site default (initially Sambee light).
	- An explicit selection, including Sambee light: retain that selection when the site default changes.
- Keep built-in IDs stable. An upgrade may update a built-in definition without changing the ID or replacing a user's selection with a frozen copy.
- IDs must be unique across built-in, user, and site themes.

## Preparation: Editable Palette

### Roles And Boundaries

- Define one typed contract for **user-editable color roles**, with matching labels and descriptions in the editor.
	- Include primary, backgrounds, text, selection, links, search highlights, viewer surfaces and toolbars, and alert colors.
	- Include Markdown document colors for code, tables, blockquotes, and heading borders, with explicit light and dark values in the built-in themes.
	- Audit fixed colors in theme-dependent app surfaces, including dark app chrome and dialogs. Make each an editable role or document why it remains derived.
	- Exclude file-type icons, content/syntax colors, and unrelated fixed asset colors.
- Audit `frontend/src/theme/types.ts`, `palette.ts`, `viewerStyles.ts`, `commonStyles.ts`, and the theme preview in `PreferencesSettings.tsx` for missing roles and duplicated defaults.
	- The existing `THEME_SCHEMA` omits links and alerts. Complete it or replace it with an editor field catalog checked against the typed contract.
	- Keep the catalog focused on labels, grouping, and descriptions; do not build a generic form engine.
- Keep calculated effects out of the editable palette:
	- Opacity-adjusted focus/search rings, scrollbar shades, and MUI-generated colors.
	- Compatibility values such as `background.paper`, which currently resolves to `background.default`.
	- Retire or explicitly account for legacy `action.focus` and fallback-only `action.selectedDarker`; do not show ignored fields as editable.

### Validation And Resolution

- Require both built-in themes to define every editable role explicitly. Newly saved and imported themes must use the same complete shape.
- Accept `#RRGGBB` and `#RRGGBBAA`. Validate both in the editor and on the server; the current backend checks only ID, name, mode, and nonempty primary color.
	- Reject malformed JSON, invalid colors, missing roles, duplicate IDs, and collisions with built-in or site IDs before changing stored data.
- Resolve the validated palette at one boundary shared by the app, viewers, previews, and editor.
	- Consumers read the same effective colors instead of providing local defaults.
	- Keep explicit role values separate from derived presentation effects. Do not substitute a universal hard-coded color for an omitted brand role.

## Theme Selection

### Grid And Actions

- Use a responsive preview grid. Show nonempty groups in this order: Your themes, Site themes, Built-in themes.
- Mark the site default with a compact badge inside its tile; mark the selected theme separately, visually and accessibly.
- Put Copy, Edit, Delete, and Set as default below the grid. Each action applies to the selected tile:
	- **Copy:** Keep writable copies in the source group; copy read-only themes to Your themes. Append ` (copy)` to the name and allocate a new unique ID.
	- **Edit:** Open the editor even for read-only themes, but disable Save when the user lacks write permission.
	- **Delete:** Disable for built-ins and for site themes without admin permission.
	- **Set as default:** Disable except for site themes. Require admin permission. This changes the default for users without an explicit selection, not their individual preferences.

### Storage And Permissions

- Add shared storage and admin-managed endpoints for site themes. The per-user `appearance.custom_themes` setting is not site-theme storage.
- Enforce ownership, admin permissions, and ID uniqueness on the server as well as in the UI, including edits, deletion, default changes, and overwrites.
- When a theme is deleted that is being used/selected by users, treat it as new user: apply the site default (if existing) or the built-in default.
- Preserve an explicitly selected built-in ID across upgrades even if its definition changes.

## Theme Editor Dialog

### Layout And Color Controls

- Use `ResponsiveDialogShell` and the shared settings-form layout as one responsive form.
- Put Name, Description, Light/Dark, and Storage (Your themes or Site themes) first. Only administrators may save to Site themes; IDs are internal, not editable names.
- Organize color roles into collapsible groups: core colors first, then viewer, Markdown, search, and alert colors.
	- Show each role's label, hex value, and small swatch; describe unfamiliar roles briefly.
	- Keep one group open at a time on phones. Scroll the dialog body, not a nested color panel, and keep actions reachable.
- Use `react-colorful`'s `HexAlphaColorPicker` in a MUI popover opened from the swatch. Show its built-in alpha slider directly below the hue slider, with a checkerboard transparency track as in the demo (https://omgovich.github.io/react-colorful/); no separate opacity slider is needed. The library has no runtime dependencies.
	- Pair it with a MUI hex text field for precise entry and copying. Keep the picker and text field synchronized with the same draft color.
	- Show opaque values as `#RRGGBB` and translucent values as `#RRGGBBAA`. Normalize valid entries; retain invalid text with an inline error until corrected, without applying it to the preview.
	- Show transparency in the swatch even when the picker is closed. Verify keyboard access, focus, and popover placement on phones and desktops.

### Draft Preview And Actions

- Do not add a separate preview panel. When editing the currently selected theme, apply valid draft changes to the app without persisting them.
	- An incomplete or invalid hex entry must not break rendering. Editing another theme must not silently change the user's selection.
	- Closing or canceling restores the last persisted theme and makes discarding changes clear. Successful Save or Save as clears the draft preview and uses the persisted result.
- **Save:** Update only a writable theme; disable for built-ins and site themes without admin permission.
- **Save as:** Create a theme in an allowed group with a fresh ID, or overwrite a writable target after explicit confirmation. Preserve the target ID on overwrite; never overwrite a built-in or unauthorized site theme. Detect name and ID conflicts rather than silently replacing a theme.
- **Import:** Validate JSON and replace the draft without saving it. A failed import leaves the previous draft intact.
- **Export:** Download the current draft in the same versioned definition format accepted by Import.
- On a failed save, keep the draft and show a specific, actionable error.

## Delivery And Verification

1. **Palette foundation**
	 - Define and test the role catalog, built-in completeness, color normalization, and shared resolution boundary.
	 - Audit remaining theme-dependent fixed colors. Keep IDs and selection independent of palette revisions.
2. **Persistence and permissions**
	 - Add site-theme storage, site default, authorization, and server validation; integrate them with user-theme IDs and selection.
	 - Test permissions, collisions, referenced-theme deletion, and users with no override versus an explicit Sambee light selection.
3. **Selection and editor**
	 - Build the grid and form with the existing dialog system.
	 - Test copy, Save, Save as, overwrite confirmation, Import/Export, draft preview and revert, invalid colors, alpha preservation, and keyboard use.
	 - Check phone and desktop layouts in light and dark themes. Confirm that updating a built-in definition preserves its selected ID.
