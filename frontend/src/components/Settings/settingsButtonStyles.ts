import type { SxProps, Theme } from "@mui/material";
import { alpha } from "@mui/material/styles";

const SETTINGS_BUTTON_MIN_HEIGHT_PX = 40;
const SETTINGS_BUTTON_FOCUS_RING_PX = 3;
const SETTINGS_ICON_BUTTON_SIZE_PX = 36;

function getSettingsAccentColor(theme: Theme): string {
  return theme.palette.primary.dark ?? theme.palette.primary.main;
}

function getSettingsSurfaceTint(theme: Theme): string {
  return theme.palette.action.selected ?? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.12);
}

function getSettingsFocusRing(theme: Theme): string {
  const ringColor = alpha(getSettingsAccentColor(theme), theme.palette.mode === "dark" ? 0.38 : 0.24);

  return `0 0 0 ${SETTINGS_BUTTON_FOCUS_RING_PX}px ${ringColor}`;
}

function getUtilityBorderColor(theme: Theme): string {
  return alpha(getSettingsAccentColor(theme), theme.palette.mode === "dark" ? 0.48 : 0.32);
}

const settingsButtonBaseSx: SxProps<Theme> = {
  minHeight: SETTINGS_BUTTON_MIN_HEIGHT_PX,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

export const settingsUtilityButtonSx: SxProps<Theme> = {
  ...settingsButtonBaseSx,
  color: "text.primary",
  borderColor: (theme) => getUtilityBorderColor(theme),
  bgcolor: (theme) => getSettingsSurfaceTint(theme),
  "&:hover": {
    borderColor: (theme) => getSettingsAccentColor(theme),
    bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.28 : 0.18),
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: (theme) => getSettingsAccentColor(theme),
    bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.3 : 0.2),
    boxShadow: (theme) => getSettingsFocusRing(theme),
  },
};

export const settingsPrimaryButtonSx: SxProps<Theme> = {
  ...settingsButtonBaseSx,
  boxShadow: 2,
  "&:hover": {
    boxShadow: 3,
  },
  "&.Mui-focusVisible": {
    outline: "none",
    boxShadow: (theme) => `${theme.shadows[3]}, ${getSettingsFocusRing(theme)}`,
  },
};

export const settingsDestructiveButtonSx: SxProps<Theme> = {
  ...settingsButtonBaseSx,
  borderColor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.64 : 0.38),
  color: "error.main",
  bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.18 : 0.08),
  "&:hover": {
    borderColor: "error.main",
    bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.24 : 0.12),
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: "error.main",
    bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.28 : 0.14),
    boxShadow: (theme) => getSettingsFocusRing(theme),
  },
};

export const settingsUtilityIconButtonSx: SxProps<Theme> = {
  color: (theme) => getSettingsAccentColor(theme),
  border: 1,
  borderColor: (theme) => getUtilityBorderColor(theme),
  bgcolor: (theme) => getSettingsSurfaceTint(theme),
  width: SETTINGS_ICON_BUTTON_SIZE_PX,
  height: SETTINGS_ICON_BUTTON_SIZE_PX,
  "&:hover": {
    borderColor: (theme) => getSettingsAccentColor(theme),
    bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.28 : 0.18),
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: (theme) => getSettingsAccentColor(theme),
    bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.3 : 0.2),
    boxShadow: (theme) => getSettingsFocusRing(theme),
  },
};

export const settingsDestructiveIconButtonSx: SxProps<Theme> = {
  ...settingsUtilityIconButtonSx,
  color: "error.main",
  borderColor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.64 : 0.38),
  bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.18 : 0.08),
  "&:hover": {
    borderColor: "error.main",
    bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.24 : 0.12),
  },
  "&.Mui-focusVisible": {
    outline: "none",
    borderColor: "error.main",
    bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.28 : 0.14),
    boxShadow: (theme) => getSettingsFocusRing(theme),
  },
};

export const settingsPrimaryFabSx: SxProps<Theme> = {
  boxShadow: 3,
  "&:hover": {
    boxShadow: 5,
  },
  "&.Mui-focusVisible": {
    outline: "none",
    boxShadow: (theme) => `${theme.shadows[5]}, ${getSettingsFocusRing(theme)}`,
  },
};
