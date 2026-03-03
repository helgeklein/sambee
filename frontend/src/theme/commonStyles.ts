import type { SxProps, Theme } from "@mui/material";

/**
 * Common reusable style patterns for consistent UI
 */

/** Focus ring width to match FOCUS_OUTLINE_WIDTH_PX from theme constants */
const FOCUS_RING_WIDTH = 3;

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
  borderColor: "divider",
  borderRadius: 3,
  bgcolor: "action.selected",
  textTransform: "none",
  "&:hover": {
    bgcolor: "action.selected",
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: "primary.main",
    boxShadow: (theme) => `0 0 0 ${FOCUS_RING_WIDTH - 1}px ${theme.palette.primary.main}`,
  },
};
