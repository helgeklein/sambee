import type { SxProps, Theme } from "@mui/material";

/**
 * Common reusable style patterns for consistent UI
 */

/**
 * pillButtonStyle
 *
 * Pill-style button with subtle border and background.
 * Used for control buttons like selectors, menus, and toggles.
 * Provides clear visual affordance while maintaining a flat, elegant aesthetic.
 */
export const pillButtonStyle: SxProps<Theme> = {
  border: 1,
  borderColor: "divider",
  borderRadius: 3,
  bgcolor: "action.hover",
  textTransform: "none",
  "&:hover": {
    bgcolor: "action.selected",
  },
};
