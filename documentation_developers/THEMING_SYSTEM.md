# Theming System

## Overview

Sambee includes a flexible theming system that allows users to customize the visual appearance of the application. The system supports:

- Multiple built-in themes
- Light and dark modes
- Custom theme creation
- Persistent theme preferences

## Architecture

### Components

The theming system consists of several key components:

1. **Theme Configuration** (`src/theme/types.ts`)
   - TypeScript interfaces defining theme structure
   - Supports MUI palette configuration
   - Includes metadata (name, description)

2. **Built-in Themes** (`src/theme/themes.ts`)
   - Pre-configured themes shipped with the app
   - All themes stored in `builtInThemes` array
   - Sambee Light (default, branded golden theme)
   - Sambee Dark (dark mode with golden accents)
   - `getDefaultTheme(mode?)` function returns default theme for light or dark mode
   - Compile-time assertions ensure theme indices are valid

3. **Theme Context** (`src/theme/ThemeContext.tsx`)
   - React context for theme state management
   - Handles theme switching
   - Persists preferences to localStorage
   - Manages custom themes

4. **Theme Selector UI** (`src/components/ThemeSelector.tsx`)
   - User interface for changing themes
   - Visual preview of theme colors
   - Grid layout of available themes

### Data Flow

```
User clicks ThemeSelector
  ↓
ThemeSelectorDialog displays themes
  ↓
User selects theme
  ↓
useSambeeTheme().setThemeById()
  ↓
Theme saved to localStorage
  ↓
MUI ThemeProvider updates
  ↓
UI re-renders with new theme
```

## Built-in Themes

### Sambee Light (Default)
- **ID:** `sambee-light`
- **Colors:**
  - Primary: Golden yellow (#F4C430)
  - Secondary: Dark charcoal (#1F262B)
  - Background: Cream (#F6F1E8)
- **Mode:** Light
- **Use case:** Default branded theme inspired by app icon colors

### Sambee Dark
- **ID:** `sambee-dark`
- **Colors:**
  - Primary: Golden yellow (#F4C430)
  - Secondary: Light cream (#F6F1E8)
  - Background: Dark charcoal (#1F262B)
- **Mode:** Dark
- **Use case:** Dark mode with branded golden accents

All built-in themes are defined in the `builtInThemes` array and can be accessed via:
- `getDefaultTheme()` - Returns default light theme
- `getDefaultTheme("light")` - Returns default light theme
- `getDefaultTheme("dark")` - Returns default dark theme
- `getThemeById(id)` - Returns theme by ID or undefined

## Theme Configuration

### Configurable MUI Colors

Themes can configure the following Material-UI palette colors:

#### Primary Palette
- `primary.main` - Main primary color (used for directories in file browser, action buttons, focused elements)
- `primary.light` - Lighter shade of primary color
- `primary.dark` - Darker shade of primary color
- `primary.contrastText` - Text color on primary backgrounds (used for toolbar text, connection selector)

#### Secondary Palette
- `secondary.main` - Main secondary color
- `secondary.light` - Lighter shade of secondary color
- `secondary.dark` - Darker shade of secondary color
- `secondary.contrastText` - Text color on secondary backgrounds

#### Background Colors
- `background.default` - Default page background
- `background.paper` - Surface/card background

#### Text Colors
- `text.primary` - Primary text color
- `text.secondary` - Secondary/muted text color

#### Action Colors
- `action.hover` - Background color for hover states (used for file list items on hover)
- `action.selected` - Background color for selected items (used for selected file in file list)

#### Automatic Derivations
Material-UI automatically generates additional palette values when action colors are not explicitly defined:
- `divider` - Color for dividers and borders

### Special Uses
- **Directories:** Use `primary.main` color in the file browser
- **Toolbar:** Uses `primary.main` as background with `primary.contrastText` for text
- **Connection Selector:** Uses `primary.contrastText` for text and borders
- **File Icons:** Non-directory files use hardcoded colors defined in FileTypeRegistry
- **Selected File:** Uses `action.selected` for background color in file list

## Usage

### Accessing Theme

```tsx
import { useSambeeTheme } from '../theme';

function MyComponent() {
  const { currentTheme, muiTheme, availableThemes, setThemeById } = useSambeeTheme();

  return (
    <div>
      <p>Current: {currentTheme.name}</p>
      <button onClick={() => setThemeById('sambee-dark')}>
        Switch to Dark Mode
      </button>
    </div>
  );
}
```

### Getting Default Themes

```tsx
import { getDefaultTheme } from '../theme';

// Get default light theme (sambee-light)
const lightTheme = getDefaultTheme();
const lightTheme2 = getDefaultTheme("light");

// Get default dark theme (sambee-dark)
const darkTheme = getDefaultTheme("dark");
```
```

### Adding Theme Selector

The `ThemeSelector` component is already integrated into the FileBrowser toolbar. To add it elsewhere:

```tsx
import { ThemeSelector } from '../components/ThemeSelector';

<ThemeSelector />
```

### Creating Custom Themes

Users or developers can create custom themes:

```tsx
import { useSambeeTheme } from '../theme';

function addCustomTheme() {
  const { addCustomTheme } = useSambeeTheme();

  addCustomTheme({
    id: 'my-custom-theme',
    name: 'My Custom Theme',
    description: 'A unique theme',
    mode: 'light',
    primary: { main: '#ff6b6b' },
    secondary: { main: '#4ecdc4' },
  });
}
```

## Persistence

Theme preferences are automatically saved to `localStorage`:

- **Key:** `theme-id-current` - ID of currently selected theme
- **Key:** `themes-builtin` - Built-in themes (synced from code, updated on app version changes)
- **Key:** `themes-custom` - User-created custom themes

On app load:
1. The last selected theme is restored from `theme-id-current`
2. Built-in themes are synced from code (ensures users get latest theme updates)
3. Custom themes are loaded from `themes-custom`

The system automatically detects when built-in themes are updated in the code and syncs them to localStorage, ensuring users always have the latest theme definitions.

## Styling Best Practices

When creating custom components, use theme-aware styling:

```tsx
import { useTheme } from '@mui/material/styles';

function MyComponent() {
  const theme = useTheme();

  return (
    <Box sx={{
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
      padding: theme.spacing(2),
    }}>
      Theme-aware component
    </Box>
  );
}
```

## Meta Theme Color

The system automatically updates the browser's `theme-color` meta tag to match the selected theme's primary color. This affects:

- Android browser UI color
- PWA status bar color
- Browser toolbar tinting (on supported browsers)

## Future Enhancements

Potential future improvements:

1. **Theme Builder UI** - Visual theme designer using THEME_SCHEMA
2. **Theme Import/Export** - Share themes as JSON files
3. **System Theme Detection** - Auto-switch based on OS dark mode preference
4. **Per-connection Themes** - Different themes for different SMB connections
5. **Theme Marketplace** - Community-contributed themes
6. **Theme Variants** - Generate light/dark variants from single theme definition

## Technical Details

### LocalStorage Schema

```json
{
  "theme-id-current": "sambee-light",
  "themes-builtin": [
    {
      "id": "sambee-light",
      "name": "Sambee light",
      "mode": "light",
      "primary": { "main": "#F4C430" },
      "secondary": { "main": "#1F262B" }
    },
    {
      "id": "sambee-dark",
      "name": "Sambee dark",
      "mode": "dark",
      "primary": { "main": "#F4C430" },
      "secondary": { "main": "#F6F1E8" }
    }
  ],
  "themes-custom": [
    {
      "id": "custom-1",
      "name": "My Theme",
      "mode": "light",
      "primary": { "main": "#abc123" },
      "secondary": { "main": "#def456" }
    }
  ]
}
```

### Theme Schema

The system includes a runtime-accessible schema (`THEME_SCHEMA`) that defines:
- Field types (text, color, select)
- Labels and descriptions for UI
- Required/optional flags
- Nested field definitions
- Select options (e.g., mode: 'light' | 'dark')

This schema is designed for use by a future theme builder UI, providing metadata for form generation and validation.

### MUI Theme Structure

The system generates standard MUI themes with:
- Palette (colors)
- Typography (fonts)
- Component overrides (scrollbars, etc.)
- Spacing system
- Breakpoints

## Testing

To test themes:

1. Open the app
2. Click the palette icon in the toolbar
3. Select different themes and verify:
   - Colors update correctly
   - Text remains readable
   - Icons are visible
   - No layout issues

Test on:
- Desktop browser
- Mobile browser
- PWA installed mode
- Light/dark OS themes
