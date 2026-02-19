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
      default: "#F6F1E8", // Cream/off-white
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1F262B",
      secondary: "#1F262BB3", // 70% opacity
    },
    action: {
      selected: "#F4C43029", // 16% opacity
      focus: "#F4C430", // Golden yellow - primary color for focus outlines
    },
    components: {
      appBar: {
        background: "#F4C430", // Golden yellow - primary color in light mode
        text: "#1F262B", // Dark text for contrast on yellow background
        focus: "#1F262BB3", // Dark outline for contrast on yellow background
      },
      statusBar: {
        background: "#F4C430", // Matches app bar in light mode
        text: "#1F262B", // Primary text - dark on yellow
        textSecondary: "#1F262BB3", // 70% opacity
      },
      link: {
        main: "#D4A020", // Darker yellow
        hover: "#F4C430", // Golden yellow on hover
      },
      pdfViewer: {
        viewerBackground: "#F6F1E8", // Default background
        toolbarBackground: "#F6F1E8", // Default background
        toolbarText: "#1F262B", // Primary text
      },
      imageViewer: {
        viewerBackground: "#1F262B", // Dark mode background
        toolbarBackground: "#1F262B", // Dark mode background
        toolbarText: "#F6F1E8", // Dark mode primary text
      },
      markdownViewer: {
        viewerText: "#1F262B", // Primary text
        viewerBackground: "#F6F1E8", // Default background
        toolbarBackground: "#1F262B", // Dark mode background
        toolbarText: "#F6F1E8", // Dark mode primary text
      },
      alert: {
        info: {
          background: "#E3F2FD", // Light blue
          text: "#1565C0", // Dark blue
          icon: "#1976D2", // Blue
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
      main: "#F4C430", // Golden yellow
      light: "#F6E58D",
      dark: "#D4A020",
      contrastText: "#1F262B",
    },
    background: {
      default: "#1F262B", // Dark charcoal
      paper: "#2A3239",
    },
    text: {
      primary: "#F6F1E8",
      secondary: "#F6F1E8B3", // 70% opacity
    },
    action: {
      selected: "#F4C43029", // 16% opacity
      focus: "#F4C430", // Golden yellow - primary color for focus outlines
    },
    components: {
      appBar: {
        background: "#2A3239", // Dark paper color - not primary in dark mode
        text: "#F6F1E8", // Light text for contrast on dark background
        focus: "#F4C430", // Golden yellow for focus outlines on dark background
      },
      statusBar: {
        background: "#2A3239", // Matches app bar in dark mode (paper color)
        text: "#F6F1E8", // Primary text - light on dark
        textSecondary: "#F6F1E8B3", // 70% opacity
      },
      link: {
        main: "#F4C430", // Golden yellow
        hover: "#F6E58D", // Lighter yellow on hover
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
      },
      alert: {
        info: {
          background: "#0D47A1", // Deep blue
          text: "#BBDEFB", // Light blue text
          icon: "#64B5F6", // Light blue icon
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
