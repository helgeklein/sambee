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
    secondary: {
      main: "#1F262B", // Dark charcoal
      light: "#3A4550",
      dark: "#0F1419",
      contrastText: "#F6F1E8", // Light text for contrast
    },
    background: {
      default: "#F6F1E8", // Cream/off-white
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1F262B",
      secondary: "rgba(31, 38, 43, 0.7)",
    },
    action: {
      hover: "rgba(244, 196, 48, 0.08)", // Golden yellow with low opacity
      selected: "rgba(244, 196, 48, 0.16)", // Golden yellow with higher opacity
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
    secondary: {
      main: "#F6F1E8", // Light cream
      light: "#FFFFFF",
      dark: "#D4CFC0",
      contrastText: "#1F262B",
    },
    background: {
      default: "#1F262B", // Dark charcoal
      paper: "#2A3239",
    },
    text: {
      primary: "#F6F1E8",
      secondary: "rgba(246, 241, 232, 0.7)",
    },
    action: {
      hover: "rgba(244, 196, 48, 0.08)", // Golden yellow with low opacity
      selected: "rgba(244, 196, 48, 0.16)", // Golden yellow with higher opacity
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

  return builtInThemes[themeIndex]!;
};
