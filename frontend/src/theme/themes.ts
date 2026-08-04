import type { ThemeConfig } from "./types";

//
// Built-in theme definitions
//

/**
 * All built-in themes shipped with the application
 */
export const builtInThemes: ThemeConfig[] = [
  // Sambee default light theme
  {
    id: "sambee-light",
    name: "Sambee light",
    description: "Application default light theme",
    mode: "light",
    primary: {
      main: "#F4C430", // Golden yellow
      light: "#F6E58D",
      dark: "#D4A020",
      contrastText: "#1F262B", // Dark text for contrast
    },
    background: {
      default: "#FBF9F4", // Warm off-white
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1F262B",
      secondary: "#1F262BB3", // 70% opacity
    },
    action: {
      selected: "#F4C43029", // 16% opacity
      focus: "#1F262B91", // High-contrast focus ring on golden controls
    },
    components: {
      link: {
        main: "#C24400", // Dark for readability
        hover: "#FF5900", // Lighter on hover for visual feedback
      },
      search: {
        otherMatch: "#F57C00", // Strong orange for non-current search matches
        currentMatch: "#1976D2", // Blue for the current search match
      },
      pdfViewer: {
        viewerBackground: "#FBF9F4", // Default background
        toolbarBackground: "#FBF9F4", // Default background
        toolbarText: "#1F262B", // Primary text
      },
      imageViewer: {
        viewerBackground: "#1F262B", // Dark mode background
        toolbarBackground: "#1F262B", // Dark mode background
        toolbarText: "#F6F1E8", // Dark mode primary text
      },
      markdownViewer: {
        viewerText: "#1F262B", // Primary text
        viewerBackground: "#FBF9F4", // Default background
        toolbarBackground: "#1F262B", // Dark mode background
        toolbarText: "#F6F1E8", // Dark mode primary text
        secondaryToolbarSelected: "#D4A02042", // Selected background for the markdown editor secondary toolbar
      },
      alert: {
        info: {
          background: "#E3F2FD", // Light blue
          text: "#1565C0", // Dark blue
          icon: "#1976D2", // Blue
        },
        success: {
          background: "#E8F5E9", // Light green
          text: "#2E7D32", // Dark green
          icon: "#43A047", // Green
        },
        warning: {
          background: "#FFF3E0", // Light orange
          text: "#E65100", // Dark orange
          icon: "#F57C00", // Orange
        },
        error: {
          background: "#FFEBEE", // Light red
          text: "#C62828", // Dark red
          icon: "#D32F2F", // Red
        },
      },
    },
  },
  // Sambee default dark theme
  {
    id: "sambee-dark",
    name: "Sambee dark",
    description: "Application default dark theme",
    mode: "dark",
    primary: {
      main: "#D4A020", // Muted golden yellow for default dark-mode controls
      light: "#F4C430", // Brighter hover and high-emphasis shade
      dark: "#B8860B", // Pressed and low-emphasis shade
      contrastText: "#1F262B",
    },
    background: {
      default: "#1F262B", // Dark charcoal
      paper: "#1F262B",
    },
    text: {
      primary: "#F6F1E8",
      secondary: "#F6F1E8B3", // 70% opacity
    },
    action: {
      selected: "#D4A02038", // 22% opacity
      focus: "#F6F1E8F0", // High-contrast focus ring on golden controls
    },
    components: {
      link: {
        main: "#D4A020", // Default dark-mode primary shade
        hover: "#F4C430", // Brighter hover shade
      },
      search: {
        otherMatch: "#FFB74D", // Brighter orange for non-current search matches on dark backgrounds
        currentMatch: "#64B5F6", // Brighter blue for the current search match on dark backgrounds
      },
      pdfViewer: {
        viewerBackground: "#1F262B", // Default background
        toolbarBackground: "#1F262B", // Default background
        toolbarText: "#F6F1E8", // Primary text
      },
      imageViewer: {
        viewerBackground: "#1F262B", // Default background
        toolbarBackground: "#1F262B", // Default background
        toolbarText: "#F6F1E8", // Primary text
      },
      markdownViewer: {
        viewerText: "#F6F1E8", // Primary text
        viewerBackground: "#1F262B", // Default background
        toolbarBackground: "#2A3239", // App bar background
        toolbarText: "#F6F1E8", // Primary text
        secondaryToolbarSelected: "#D4A02042", // Selected background for the markdown editor secondary toolbar
      },
      alert: {
        info: {
          background: "#0D47A1", // Deep blue
          text: "#BBDEFB", // Light blue text
          icon: "#64B5F6", // Light blue icon
        },
        success: {
          background: "#1B5E20", // Deep green
          text: "#C8E6C9", // Light green text
          icon: "#81C784", // Light green icon
        },
        warning: {
          background: "#E65100", // Deep orange
          text: "#FFE0B2", // Light orange text
          icon: "#FFB74D", // Light orange icon
        },
        error: {
          background: "#B71C1C", // Deep red
          text: "#FFCDD2", // Light red text
          icon: "#EF9A9A", // Light red icon
        },
      },
    },
  },
];

/**
 * Get a theme by ID
 */
export const getThemeById = (id: string): ThemeConfig | undefined => {
  return builtInThemes.find((theme) => theme.id === id);
};

/**
 * Get the default theme
 * @param mode - Optional theme mode ('light' or 'dark'). If not specified, returns the light theme.
 */
export const getDefaultTheme = (mode?: "light" | "dark"): ThemeConfig => {
  const DEFAULT_LIGHT_THEME_INDEX = 0 as const;
  const DEFAULT_DARK_THEME_INDEX = 1 as const;

  const themeIndex = mode === "dark" ? DEFAULT_DARK_THEME_INDEX : DEFAULT_LIGHT_THEME_INDEX;

  // Compile-time type assertion: Ensure both theme indices exist
  type _AssertLightThemeExists = (typeof builtInThemes)[typeof DEFAULT_LIGHT_THEME_INDEX] extends ThemeConfig ? true : never;
  type _AssertDarkThemeExists = (typeof builtInThemes)[typeof DEFAULT_DARK_THEME_INDEX] extends ThemeConfig ? true : never;
  const _assertLightTheme: _AssertLightThemeExists = true;
  const _assertDarkTheme: _AssertDarkThemeExists = true;
  void _assertLightTheme;
  void _assertDarkTheme;

  // The compile-time assertions above guarantee this access is safe
  const theme = builtInThemes[themeIndex];
  if (!theme) {
    throw new Error(`Default theme at index ${themeIndex} not found`);
  }
  return theme;
};
