import type { SxProps, Theme } from "@mui/material";

//
// componentStyles
//

/**
 * Centralized styling for custom components that match app bar styling
 * This provides consistent theming across the application for bar-like components
 */

//
// Text Colors
//

/**
 * Get the standard text color for the current theme mode
 * Use this as the default for all text unless a specific variant is needed
 *
 * @param theme - The MUI theme object
 * @param variant - Text variant: 'primary' for main text, 'secondary' for muted/subtle text
 * @returns Color value for the text
 */
export const getTextColor = (theme: Theme, variant: "primary" | "secondary" = "primary"): string => {
  return variant === "primary" ? theme.palette.text.primary : theme.palette.text.secondary;
};

/**
 * Get text color for app bar and status bar text
 * Provides correct contrast based on the bar background (which changes between light/dark modes)
 *
 * @param theme - The MUI theme object
 * @param variant - Text variant: 'primary' for main text, 'secondary' for muted text
 * @returns Color value for the text
 */
export const getBarTextColor = (theme: Theme, variant: "primary" | "secondary" = "primary"): string => {
  if (theme.palette.mode === "dark") {
    // In dark mode, bars use paper background, so use standard text colors
    return variant === "primary" ? theme.palette.text.primary : theme.palette.text.secondary;
  }
  // In light mode, bars use primary background, so use contrast text
  return theme.palette.primary.contrastText || "#000000";
};

//
// Component Styles
//

/**
 * Get status bar styles that match the app bar theme
 * The status bar uses primary color in light mode and paper background in dark mode
 * for better visual hierarchy and consistency with Material Design patterns
 *
 * @param theme - The MUI theme object
 * @returns SxProps for the status bar
 */
export const getStatusBarStyles = (theme: Theme): SxProps<Theme> => ({
  px: 2,
  py: 0.75,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderTop: 1,
  borderColor: "divider",
  backgroundColor: theme.palette.mode === "dark" ? "background.paper" : "primary.main",
  color: getBarTextColor(theme, "primary"),
});

/**
 * @deprecated Use getBarTextColor instead for consistency
 */
export const getStatusBarTextColor = getBarTextColor;
