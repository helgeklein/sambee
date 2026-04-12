import type { SxProps, Theme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ThemeConfig } from "./types";

/**
 * Common reusable style patterns for consistent UI
 */

/** Focus ring width to match FOCUS_OUTLINE_WIDTH_PX from theme constants */
const FOCUS_RING_WIDTH = 3;
const CONTAINED_BUTTON_FOCUS_INNER_RING_WIDTH = 1;

function getPrimaryAccentColor(theme: Theme): string {
  return theme.palette.primary.dark ?? theme.palette.primary.main;
}

function getContainedButtonFocusAccentColor(theme: Theme): string {
  return theme.palette.action.focus ?? getPrimaryAccentColor(theme);
}

export function getElevatedButtonFocusRing(theme: Theme): string {
  const ringColor = alpha(getPrimaryAccentColor(theme), theme.palette.mode === "dark" ? 0.38 : 0.24);

  return `0 0 0 ${FOCUS_RING_WIDTH}px ${ringColor}`;
}

export function getContainedButtonFocusVisibleBoxShadow(theme: Theme, shadowIndex = 3): string {
  return `${theme.shadows[shadowIndex]}, 0 0 0 ${CONTAINED_BUTTON_FOCUS_INNER_RING_WIDTH}px ${getContainedButtonFocusAccentColor(theme)}`;
}

export interface SecondaryToolbarSurfaceColors {
  stripBackground: string;
  popupBackground: string;
  textColor: string;
  borderColor: string;
  pillBackground: string;
  groupedBackground: string;
  activeBackground: string;
  hoverBackground: string;
  separatorColor: string;
  shadow: string;
}

export function getSecondaryToolbarSelectedBackground(theme: Theme, themeConfig?: ThemeConfig): string {
  return (
    themeConfig?.components?.markdownViewer?.secondaryToolbarSelected ??
    themeConfig?.action?.selectedDarker ??
    themeConfig?.action?.selected ??
    theme.palette.action.selected
  );
}

export function getSecondaryToolbarSurfaceColors(
  theme: Theme,
  overrides?: Partial<Pick<SecondaryToolbarSurfaceColors, "pillBackground" | "activeBackground" | "hoverBackground">>
): SecondaryToolbarSurfaceColors {
  const textColor = theme.palette.text.secondary;
  const pillBackground = overrides?.pillBackground ?? theme.palette.action.selected;
  const activeBackground = overrides?.activeBackground ?? overrides?.pillBackground ?? alpha(textColor, 0.12);
  const hoverBackground = overrides?.hoverBackground ?? activeBackground;

  return {
    stripBackground: theme.palette.background.default,
    popupBackground: theme.palette.background.default,
    textColor,
    borderColor: theme.palette.divider,
    pillBackground,
    groupedBackground: alpha(textColor, 0.06),
    activeBackground,
    hoverBackground,
    separatorColor: alpha(textColor, 0.06),
    shadow: theme.shadows[2],
  };
}

export function getSecondaryActionStripStyle(theme: Theme) {
  const colors = getSecondaryToolbarSurfaceColors(theme);

  return {
    px: 2,
    py: 0.5,
    minHeight: 36,
    bgcolor: colors.stripBackground,
    color: colors.textColor,
    boxShadow: 2,
    zIndex: 1,
  };
}

export const secondaryActionStripSx: SxProps<Theme> = (theme) => getSecondaryActionStripStyle(theme);

export function getSecondaryToolbarMenuPaperStyle(theme: Theme) {
  const colors = getSecondaryToolbarSurfaceColors(theme);

  return {
    bgcolor: colors.popupBackground,
    color: colors.textColor,
    border: 1,
    borderColor: colors.borderColor,
    boxShadow: colors.shadow,
  };
}

export const secondaryToolbarMenuPaperSx: SxProps<Theme> = (theme) => getSecondaryToolbarMenuPaperStyle(theme);

/**
 * fileNamePillSx
 *
 * Inline "pill" style for displaying file names, connection names, or
 * paths inside dialog text.  Uses medium weight and a tinted background
 * derived from the theme's primary color to make the name visually
 * distinct from surrounding prose — without relying on quotes.
 *
 * Apply as `sx` on a `<Box component="span">` or `<Typography component="span">`.
 *
 * Handles long names gracefully via `wordBreak: "break-word"`.
 */
export const fileNamePillSx: SxProps<Theme> = {
  fontWeight: 500,
  fontSize: "0.95em",
  bgcolor: "action.selected",
  borderRadius: 0.5,
  px: 0.75,
  py: 0.25,
  wordBreak: "break-word",
};

/**
 * pillButtonStyle
 *
 * Pill-style button with subtle border and background.
 * Used for control buttons like selectors, menus, and toggles.
 * Provides clear visual affordance while maintaining a flat, elegant aesthetic.
 *
 * On focus, transforms the border to the focus color with increased visual weight
 * using box-shadow (avoids layout shift from changing border width).
 */
export const pillButtonStyle: SxProps<Theme> = {
  border: 1,
  borderColor: (theme) => getSecondaryToolbarSurfaceColors(theme).borderColor,
  borderRadius: 3,
  bgcolor: (theme) => getSecondaryToolbarSurfaceColors(theme).pillBackground,
  color: (theme) => getSecondaryToolbarSurfaceColors(theme).textColor,
  textTransform: "none",
  "&:hover": {
    bgcolor: (theme) => getSecondaryToolbarSurfaceColors(theme).pillBackground,
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: "primary.main",
    boxShadow: (theme) => `0 0 0 ${FOCUS_RING_WIDTH - 1}px ${theme.palette.primary.main}`,
  },
};
