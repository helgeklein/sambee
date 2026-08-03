+++
title = "Settings Form Dialog Pattern"
+++

Use this pattern for stateful settings editors that create or update configuration. It keeps the same form behavior across a phone drawer, a narrow dialog, and a desktop dialog while avoiding separate mobile and desktop forms.

The reference implementation is `frontend/src/components/Admin/ConnectionDialog.tsx`.

## When To Use It

Use the pattern when a dialog edits several related settings and needs validation, field descriptions, or more than one action.

Do not use it for a confirmation or destructive-action dialog. Those should continue to use `ResponsiveFormDialog` directly with focused content and actions.

## Shared Building Blocks

Import the structural primitives and control styles from `frontend/src/components/Settings/SettingsFormLayout.tsx`.

| Building block | Responsibility |
|---|---|
| `SettingsFormSurface` | Provides the muted, rounded background and shared interior padding. It darkens the default background by 4% in light mode and lightens it by 8% in dark mode. |
| `SettingsFormGroup` | Groups related rows and adds row dividers only at the desktop breakpoint. |
| `SettingsFormRow` | Uses one column below `md` and the two-column label/control grid at `md` and above. |
| `SettingsFormFieldLabel` | Renders a desktop label with its description or validation error. |
| `SettingsFormSection` | Separates groups with the standard settings heading, subdued divider, and spacing. |
| `SettingsSelectMenuItem` | Renders a select option with a label and supporting description. |
| `SettingsPasswordVisibilityToggle` | Renders the shared show/hide password adornment. The owning dialog keeps password visibility state and translated labels. |
| `settingsFormFieldControlSx` | Aligns a control to the desktop control column. |
| `settingsFormSelectControlSx` | Makes a desktop select content-width and right-aligned. |
| `settingsFormOutlinedControlSx` | Applies the shared outlined-field, focus, error, and floating-label treatment. |
| `settingsSelectSx` and `settingsSelectMenuProps` | Keep select values, icons, and options at the standard subdued text color. |

Keep field state, API calls, validation rules, translations, and the concrete MUI controls in the owning dialog. The shared layer owns layout and presentation; it must not become a schema-driven form engine.

## Responsive Contract

There are exactly two form layouts.

### Below `md`

Use one column in both responsive shells.

- Below `sm`, `ResponsiveFormDialog` renders the form in a Drawer.
- From `sm` through `<md`, it renders the same form in a Dialog.
- Use normal-height MUI outlined controls.
- Keep MUI labels inside empty fields and floating in the outline after focus or entry.
- Keep descriptions and validation errors directly below their controls as MUI helper text.
- Use the grouped surface and section heading, but do not show individual field-row dividers.

### At `md` And Above

Use the two-column desktop layout.

- Put labels and descriptions in the left column.
- Put compact controls in the right column.
- Replace the left-column description with the validation error instead of showing helper text below the input.
- Keep full-width text inputs within the control column.
- Use content-width, right-aligned selects when the selected option remains readable.
- For checkboxes and switches, use the external label and description on the left, with the control in the right column. Keep the control label and helper text next to the control below `md`.
- For boolean settings, use a `Switch` with a visible `On` or `Off` state label. Let Material UI apply its standard palette colors.
- For native `datetime-local` inputs, preserve the MUI shrunk input label below `md`; use the external desktop label at `md` and above.
- Show subdued dividers between rows in a group.

## Control Conventions

Apply `settingsSelectSx` and `settingsSelectMenuProps` to every settings `Select`. Use `SettingsSelectMenuItem` when an option needs a short explanation below its label.

Use `SettingsPasswordVisibilityToggle` as the end adornment for password fields. Keep its `visible` state, toggle handler, and localized show/hide labels in the owning dialog.

## Implementation Checklist

1. Start with `ResponsiveFormDialog` for the responsive Drawer and Dialog shell.
2. Wrap the fields in `SettingsFormSurface` and one or more `SettingsFormGroup` components.
3. Put every field in `SettingsFormRow`.
4. Render `SettingsFormFieldLabel` only when the current layout is `md` or wider.
5. Keep the below-`md` MUI `label`, `InputLabel`, and `FormHelperText` props in the concrete control.
6. Use `SettingsFormSection` between related groups instead of recreating section borders and title spacing locally.
7. Reuse the shared action styles when the dialog has split or responsive actions.
8. Render conditional fields or sections only when their state applies, while keeping each visible control in a `SettingsFormRow`.

## Accessibility And Validation

Associate desktop controls with their external labels and descriptions using `htmlFor`, `labelId`, and `aria-describedby` as appropriate. Preserve a description ID when an error replaces the description so the relationship remains valid.

After a failed save or test, focus the first invalid field. Do not remove normal MUI error states from controls; the desktop error text supplements them by making the issue readable in the label column.

Use field-level errors for validation that the dialog can determine before submitting. Keep API and cross-field failures in a stable form-level alert above the form surface so they do not disrupt a desktop field row.

## Testing And Review

For every dialog that adopts this pattern, cover all of the following:

- The mobile Drawer and the `sm` through `<md` Dialog use the same single-column form semantics.
- A populated narrow-screen field uses a floating MUI label, normal control height, and helper text below the field.
- The `md` layout retains external labels, compact controls, and desktop-only row dividers.
- Errors, focus-first-invalid behavior, keyboard handling, and pending action states still work.
- The surface, controls, and helper text remain legible in both light and dark themes.

Use a live browser check at a phone width and a desktop width in addition to focused tests. Check a short viewport as well so the fixed mobile actions do not obscure the final control.

