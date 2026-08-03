+++
title = "Theming System and Theme Selection"
+++

Sambee's theming system is centralized. Theme configuration, runtime state, persistence, and selection UI are all treated as one frontend subsystem.

Use this page when you are changing palette behavior, adding a built-in theme, wiring a theme-aware component, or debugging why a selected theme is not applied consistently.

## Main Pieces

| Path | Responsibility |
|---|---|
| `frontend/src/theme/types.ts` | TypeScript theme interfaces and theme configuration shape |
| `frontend/src/theme/themes.ts` | built-in theme definitions plus default-theme helpers |
| `frontend/src/theme/ThemeContext.tsx` | runtime theme state, persistence, and theme switching |
| `frontend/src/theme/index.ts` | public theme exports for the rest of the app |
| `frontend/src/components/ThemeSelector.tsx` | theme-selection UI and dialog |
| `frontend/src/components/themeSelectorStrings.ts` | localized strings and built-in-theme labels for the selector |

These pieces matter together. Theme behavior is not just a palette file or just a toolbar widget.

## What the System Supports

The theme model currently supports:

- built-in light and dark themes
- persistent theme preferences
- custom theme storage and runtime selection
- theme-aware MUI palette generation
- one shared provider that updates the app when the theme changes

## Built-In Themes

The built-in themes live in `builtInThemes` in `frontend/src/theme/themes.ts`.

Current built-ins include:

- `sambee-light`: the default light branded theme
- `sambee-dark`: the default dark branded theme

The helper functions contributors use most are:

- `getDefaultTheme()`
- `getDefaultTheme("light")`
- `getDefaultTheme("dark")`
- `getThemeById(id)`

The theme module also includes compile-time assertions around the default-theme indices so the expected built-in defaults cannot silently disappear.

## Runtime Flow

At runtime, theme selection follows this path:

1. the app renders inside `SambeeThemeProvider`
2. the current theme ID is restored from persisted state when available
3. built-in themes are resolved from code and combined with persisted custom themes
4. `useSambeeTheme().setThemeById()` updates the active theme
5. the selected theme is persisted
6. the MUI theme instance updates and the UI re-renders

That is why a theme bug can look like a local component styling issue while actually being a context, persistence, or provider problem.

## Theme Context Contract

`useSambeeTheme()` is the main runtime entry point.

Contributors typically consume values such as:

- `currentTheme`
- `muiTheme`
- `availableThemes`
- `setThemeById`
- `addCustomTheme`

The hook must be used inside `SambeeThemeProvider`. If you bypass that provider boundary, theme state becomes inconsistent immediately.

Representative usage:

```tsx
import { useSambeeTheme } from "../theme";

function ThemeExample() {
	const { currentTheme, setThemeById } = useSambeeTheme();

	return (
		<button onClick={() => setThemeById("sambee-dark")}>
			Current: {currentTheme.name}
		</button>
	);
}
```

## Theme Configuration Model

Themes are expressed as typed configuration rather than ad hoc color overrides.

The palette surface includes areas such as:

- `primary`
- `secondary`
- `background`
- `text`
- `action`

Common uses in the UI include:

- default primary controls and selected navigation from `primary.main`
- high-emphasis dark-mode states from `primary.light`
- light-mode pressed and contrast-sensitive controls from `primary.dark`
- page and standard application surfaces from `background.default`
- readable foreground text from `text`
- selection fills from `action.selected`

Material UI also derives additional palette values such as divider color when enough base information is present.

### Surface Policy

`background.default` is the standard application surface. Use it for pages, standard dialogs, settings, and compact controls.

`background.paper` remains populated at runtime because Material UI expects the token. Sambee normalizes it to `background.default`; application components should not select it as a separate surface.

The shared settings form surface is a deliberate derived exception: it darkens the default surface by 4% in light mode and lightens it by 8% in dark mode. Inside a dark dialog, it uses a 12% black mix of the actual dialog paper surface, preserving a warm but recessed form area; its outlined fields inherit the dialog paper surface to remain visually distinct from the surrounding form layer. Application chrome is another exception: light-mode AppBar and StatusBar use the primary color, while dark-mode chrome uses the shared opaque brown `#382c0a`. Standard Material UI Dialog papers and popup menus use that same opaque dark-mode color, preventing the backdrop from showing through. Fullscreen viewers retain their dedicated viewer surfaces. Dark dialog backdrops use a high-opacity neutral composite of `background.default`, preventing nested dialogs from tinting the surface behind them. Dialogs do not add an elevation shadow because the modal backdrop provides their separation. Menu selection, hover, and keyboard focus use `action.selected`.

Standard Material UI Alerts use the theme's `components.alert` semantic colors for their info, success, warning, and error backgrounds, text, and icons. Apply alert semantics through the shared theme rather than per-component overrides.

### Primary Palette Roles

`primary.main` is the default primary control color. It should not be the brightest available shade in a dark theme, because Material UI applies it to contained buttons, radios, selected icons, and many other default controls.

Use `primary.light` for brighter dark-mode hover and high-emphasis states. Use `primary.dark` for pressed and contrast-sensitive light-mode controls. Do not swap `main` and `dark` between modes: Material UI treats `dark` as the darker interaction shade.

The built-in dark theme uses a subdued golden `main`, a brighter golden `light`, and a darker pressed `dark` shade. The exact values live in `frontend/src/theme/themes.ts`.

### Foreground Color Policy

Standard application UI uses two base foreground roles:

- `text.primary` is high-emphasis text: headings, selected or active labels, form values, selectable menu choices, file names, and information required to complete the current task.
- `text.secondary` is the default supporting layer: descriptions, metadata, timestamps, helper copy, captions, inactive navigation icons, and other text that should be readable without competing with the task.

The built-in dark theme intentionally makes `text.secondary` a muted version of the warm primary text. This reduces glare during extended use while preserving a clear emphasis hierarchy. Use `text.disabled` for non-interactive content and dedicated palette roles such as `statusBar.textSecondary`, alert colors, and viewer toolbar colors when the surface has its own semantic contract.

For Material UI `Typography`, apply dotted palette roles through `sx`, for example `sx={{ color: "text.secondary" }}`. In this application's Material UI v9 configuration, `color="text.secondary"` does not emit a palette color rule, so the element falls back to inherited text.

Icons should inherit the role of their associated text. Use `currentColor` for adaptable inline SVG illustrations. Brand assets, file-type registry icons, document rendering, syntax highlighting, and semantic alerts are deliberate exceptions: their colors convey identity, content type, or state and should remain separately named rather than being forced into the general text palette.

## Built-In Theme Characteristics

The current built-ins intentionally align with Sambee's branding.

### Sambee Light

- ID: `sambee-light`
- mode: light
- branded golden primary palette
- cream-toned background
- dark secondary contrast surface

### Sambee Dark

- ID: `sambee-dark`
- mode: dark
- branded golden primary palette
- dark background
- light secondary contrast surface

The exact palette values live in `frontend/src/theme/themes.ts`. Keep the docs focused on architectural meaning rather than duplicating every color token when the code is already authoritative.

## Theme Selector UI

The visible selection UI lives in `frontend/src/components/ThemeSelector.tsx`.

The selector:

- opens a dialog listing available themes
- shows a preview of theme colors
- uses localized strings through `themeSelectorStrings.ts`
- calls `setThemeById` when the user changes themes

The selector is already integrated into the file-browser toolbar, and the current preferences UI also consumes the same theme state.

## Persistence Model

Theme preferences are persisted in local storage.

The main keys are:

- `theme-id-current`: the currently selected theme ID
- `themes-custom`: user-created custom themes

This matters for two reasons:

- the selected theme survives reloads
- built-in theme definitions can still be refreshed from code when the app updates

The system syncs built-in themes from code so users pick up reviewed built-in theme changes without losing their custom themes.

## Custom Themes

The theme context supports custom themes in addition to the built-ins.

That means contributors should treat theme IDs, storage layout, and theme resolution as stable interfaces rather than temporary implementation details.

When adding custom-theme features or editing persistence logic:

- preserve separation between built-in and custom theme sets
- keep the active theme valid even if a custom theme is removed
- preserve a safe fallback to the default theme

Representative pattern:

```tsx
import { useSambeeTheme } from "../theme";

function addExampleTheme() {
	const { addCustomTheme } = useSambeeTheme();

	addCustomTheme({
		id: "my-custom-theme",
		name: "My Custom Theme",
		description: "A unique theme",
		mode: "light",
		primary: { main: "#ff6b6b" },
	});
}
```

## Theme Schema and Future Builder Support

`frontend/src/theme/types.ts` also exports `THEME_SCHEMA`.

That schema is runtime-accessible metadata describing:

- field types such as text, color, and select
- labels and descriptions for UI
- required versus optional fields
- nested field definitions
- select options such as `light` and `dark`

New custom themes should provide `primary.main` and may provide the other primary shades, background, text, and selection colors. The runtime resolver supplies stable mode-aware defaults for omitted optional fields so existing minimally configured themes remain valid.

`action.focus`, `components.appBar`, and `components.statusBar` are honored for already persisted themes but are intentionally not exposed by `THEME_SCHEMA`. New themes derive those values from the palette contract.

It exists so future theme-builder tooling can generate forms and validation from one typed source instead of re-encoding theme structure in multiple places.

## Theme-Aware Component Rules

When building UI components:

- use the active MUI theme instead of hard-coded surface and text colors when the style belongs to the app theme
- use `text.primary` and `text.secondary` to establish normal UI hierarchy; do not recreate muted text with local opacity values
- prefer `useTheme()` or the shared theme context rather than duplicating palette lookups manually
- derive viewer toolbar borders, muted labels, disabled controls, and subtle fills from the configured toolbar text color
- keep file-type icon colors and other intentionally non-theme registry colors separate from the app palette when they serve a different product purpose

A theme-aware component typically reads from `theme.palette` and `theme.spacing` rather than introducing standalone constants.

## Browser and PWA Integration

The theme system also updates the browser `theme-color` meta tag to match the selected theme's primary color.

That affects:

- browser UI tinting on supported browsers
- Android browser chrome behavior
- installed PWA status-bar appearance

If a theme appears correct inside the app but wrong in browser chrome, check this integration path rather than only inspecting component styles.

## Common Failure Modes

- a component hard-codes colors that should come from the active theme
- a new built-in theme is added without keeping default-theme helpers valid
- theme state is read outside `SambeeThemeProvider`
- a persistence change breaks fallback to the default theme
- built-in theme updates and custom theme persistence start overwriting each other
- contributors treat selector labels as static strings instead of localized UI copy

## Validation Expectations

When the theming system changes, usually run:

```bash
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
```

Pay particular attention to:

- theme-provider tests under `frontend/src/theme/__tests__/`
- built-in-theme and default-theme tests
- `types.test.ts` coverage around `THEME_SCHEMA`
- theme-selector tests under `frontend/src/components/__tests__/`
- manual checks that text remains readable in both built-in themes

## Where to Continue

- [Frontend Overview](../frontend-overview/): broader browser-app structure and the place of theme behavior in the frontend
- [Keyboard Shortcuts and Command Model](../keyboard-shortcuts-and-command-model/): another shared frontend subsystem with central configuration and runtime binding
- [Localization and Locale Behavior](../../cross-cutting-systems/localization-and-locale-behavior/): shared UI-system rules that often change alongside settings and preferences surfaces
