+++
title = "Theming System and Theme Selection"
+++

Sambee has two built-in themes (`sambee-light` and `sambee-dark`), user-owned themes, and administrator-managed site themes. Built-in IDs stay stable across upgrades, so updating their palettes doesn't change anyone's selection.

## Theme Data

| Path | Responsibility |
|---|---|
| `frontend/src/theme/types.ts` | Palette types and editor field labels |
| `frontend/src/theme/themes.ts` | Built-in definitions with stable IDs |
| `frontend/src/theme/themeDefinition.ts` | Editable color catalog, hex checks, and versioned import/export |
| `frontend/src/theme/palette.ts` | Shared effective palette for the app |
| `frontend/src/theme/viewerStyles.ts` | Viewer and Markdown document surfaces |
| `frontend/src/theme/ThemeContext.tsx` | Registry refresh and Material UI theme |
| `frontend/src/pages/PreferencesSettings.tsx` | Selection grid and selected-theme actions |
| `frontend/src/components/Settings/ThemeEditorDialog.tsx` | Responsive theme editor |
| `backend/app/api/themes.py` | Validated theme operations and site default |

Each editable theme has its own server row with a globally unique ID, scope, owner (for user themes), and version. Built-in definitions remain in frontend code. A new theme ID is assigned by the server; an ID in an imported file does not claim or replace a stored theme.

New and imported themes must define every editable color role. Colors use `#RRGGBB` or `#RRGGBBAA`; the server normalizes valid hex to uppercase. The role catalog includes primary, backgrounds, text, selection, links, viewer surfaces, Markdown document surfaces, search highlights, and alerts. File-type icons and document syntax colors aren't theme roles. Derived colors such as scrollbar shades, focus rings, and `background.paper` compatibility aren't editor fields.

## Selection And Defaults

`SambeeThemeProvider` combines built-ins with the current user's themes and shared site themes from `GET /api/themes`. The per-user selection is saved separately through `appearance.theme_id` in `PUT /api/auth/me/settings`. The backend reports whether that value is an explicit override.

A user without an override follows the site default (initially `sambee-light`). A user who explicitly chooses `sambee-light` keeps that ID even if an administrator changes the site default. The selected ID points at a theme definition, never at a frozen copy of a built-in. The provider refreshes shared themes, the default, and user settings on initial load, tab focus, visibility return, and local writes. It discards out-of-date responses when the account changes.

Appearance settings display Your themes, Site themes, then Built-in themes. Clicking a tile or selecting its radio applies the theme and creates an explicit user override, even when it already matches the site default. Moving focus between radios doesn't change the applied theme or the target of Copy, Edit, Delete, and Set as default. The Default chip is distinct from the selected radio. Copy keeps writable themes in their group and copies read-only themes into Your themes without applying the copy. Editing read-only themes permits inspection and Save copy, but not Save. Only an administrator can save or delete site themes or make a built-in or site theme the default.

## Editing And Persistence

The editor uses a responsive dialog with collapsible color groups. A swatch opens an alpha-aware picker and each color has an editable hex field. Invalid text stays in the field without changing the valid draft. Changes in the editor aren't applied to the app until Save succeeds; Cancel discards the draft. Import replaces only the draft after validating a versioned JSON definition, and Export writes the same format.

`POST /api/themes` creates a theme. Save copy opens a destination menu with Your themes for everyone and Site themes for administrators. It always creates a new theme in the chosen group without changing the applied selection. If its name already exists in that group, the editor adds ` (copy)` or a numbered copy suffix. Save updates only the opened theme in its existing group and cannot create a copy. `PUT /api/themes/{id}` and `DELETE /api/themes/{id}?version=...` require the version read by the client; a stale version returns HTTP 409. The server checks ownership, admin permissions, names, IDs, and palette completeness before committing. Bulk writes to `appearance.custom_themes` are no longer supported. There is no migration of older custom themes or compatibility promise for older exports.

Deleting a theme clears explicit selections referencing it. If it was the site default, that setting is cleared too; users without an override then fall back to Sambee light. An explicit selection of another theme is unaffected.

## Component Guidance

Prefer the effective colors in `resolveThemePalette` and the MUI palette to hard-coded surfaces. `background.default` is the normal application surface; `background.paper` resolves to the same value for MUI compatibility. Dark chrome and dialogs use the editable `background.chrome` role. Markdown code, tables, blockquotes, and heading borders use the built-in theme's explicit document colors.

Viewer toolbar foreground variants, scrollbars, and subdued states can still derive opacity-adjusted values from their source color. Keep fixed colors for assets, syntax/content rendering, and file-type icons separate from the editor palette.

## Verification

Run focused theme tests and the project checks after changing the palette, API, or editor:

```bash
cd frontend && npm run test -- src/theme/__tests__ src/pages/__tests__/PreferencesSettings.test.tsx
cd frontend && npm run build && npm run lint
cd backend && .venv/bin/python -m pytest tests/test_user_settings.py
```

Check the Appearance grid and editor on a phone and desktop in both built-in modes. Verify selection and saved-theme refresh after focus, color picker keyboard use and placement, alpha values and export, Cancel without applying the draft, and stale-save feedback.
