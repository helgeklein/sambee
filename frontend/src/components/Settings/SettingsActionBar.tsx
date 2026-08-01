import { Box, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

const SETTINGS_ACTION_BAR_BUTTON_HEIGHT_PX = 40;
const SETTINGS_ACTION_BAR_VERTICAL_PADDING_PX = 12;
const SETTINGS_ACTION_BAR_DIVIDER_HEIGHT_PX = 1;

export const SETTINGS_ACTION_BAR_MIN_HEIGHT_PX =
  SETTINGS_ACTION_BAR_BUTTON_HEIGHT_PX + SETTINGS_ACTION_BAR_VERTICAL_PADDING_PX * 2 + SETTINGS_ACTION_BAR_DIVIDER_HEIGHT_PX;

interface SettingsActionBarProps {
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  sx?: SxProps<Theme>;
}

/** Persistent page-level action area for settings edits and creation actions. */
export function SettingsActionBar({ primaryActions, secondaryActions, sx }: SettingsActionBarProps) {
  const baseSx: SxProps<Theme> = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 1.5,
    flexWrap: "wrap",
    minHeight: SETTINGS_ACTION_BAR_MIN_HEIGHT_PX,
    px: { xs: 2, sm: 3, md: 4 },
    pt: 1.5,
    pb: "calc(12px + env(safe-area-inset-bottom))",
    borderTop: 1,
    borderColor: "divider",
    bgcolor: "background.default",
  };
  const resolvedSx: SxProps<Theme> = Array.isArray(sx) ? [baseSx, ...sx] : sx ? [baseSx, sx] : baseSx;

  return (
    <Box sx={resolvedSx}>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>{primaryActions}</Box>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", marginLeft: "auto" }}>{secondaryActions}</Box>
    </Box>
  );
}
