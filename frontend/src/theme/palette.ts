import { alpha, darken, lighten } from "@mui/material";
import type { ThemeConfig } from "./types";

const LIGHT_DEFAULT_BACKGROUND = "#FBF9F4";
const DARK_DEFAULT_BACKGROUND = "#1F262B";
const LIGHT_DEFAULT_TEXT = "#1F262B";
const DARK_DEFAULT_TEXT = "#F6F1E8";
const LIGHT_SURFACE_DARKEN_AMOUNT = 0.04;
const DARK_SURFACE_LIGHTEN_AMOUNT = 0.08;
const DARK_CHROME_SURFACE = "#382c0a";
const DARK_DIALOG_BACKDROP_OPACITY = 0.92;
const DARK_DIALOG_FORM_SURFACE_BLACK_MIX_PERCENT = 12;

export const DIALOG_SURFACE_CSS_VARIABLE = "--sambee-dialog-surface";
export const DIALOG_FORM_SURFACE_CSS_VARIABLE = "--sambee-dialog-form-surface";

export interface DialogSurfaceTokens {
  backdrop: string | undefined;
  form: string;
  paper: string;
}

export interface ResolvedThemePalette {
  background: {
    default: string;
    paper: string;
  };
  text: {
    primary: string;
    secondary: string;
  };
  action: {
    selected: string;
    selectedDarker?: string;
    focus: string;
  };
  appBar: {
    background: string;
    text: string;
    focus: string;
  };
  statusBar: {
    background: string;
    text: string;
    textSecondary: string;
  };
  link: {
    main: string;
    hover: string;
  };
}

export function getControlAccentColor(theme: ThemeConfig): string {
  if (theme.mode === "dark") {
    return theme.primary.main;
  }

  return theme.primary.dark ?? theme.primary.main;
}

export function getModeAdjustedSurfaceColor(background: string, mode: ThemeConfig["mode"]): string {
  return mode === "dark" ? lighten(background, DARK_SURFACE_LIGHTEN_AMOUNT) : darken(background, LIGHT_SURFACE_DARKEN_AMOUNT);
}

export function getDarkChromeSurfaceColor(): string {
  return DARK_CHROME_SURFACE;
}

export function getDialogSurfaceTokens(background: string, mode: ThemeConfig["mode"]): DialogSurfaceTokens {
  const paper = mode === "dark" ? getDarkChromeSurfaceColor() : background;

  return {
    backdrop: mode === "dark" ? alpha(background, DARK_DIALOG_BACKDROP_OPACITY) : undefined,
    paper,
    form:
      mode === "dark"
        ? `color-mix(in srgb, black ${DARK_DIALOG_FORM_SURFACE_BLACK_MIX_PERCENT}%, ${paper})`
        : getModeAdjustedSurfaceColor(paper, mode),
  };
}

export function resolveThemePalette(theme: ThemeConfig): ResolvedThemePalette {
  const isDark = theme.mode === "dark";
  const defaultBackground = isDark ? DARK_DEFAULT_BACKGROUND : LIGHT_DEFAULT_BACKGROUND;
  const defaultText = isDark ? DARK_DEFAULT_TEXT : LIGHT_DEFAULT_TEXT;
  const backgroundDefault = theme.background?.default ?? defaultBackground;
  const textPrimary = theme.text?.primary ?? defaultText;
  const textSecondary = theme.text?.secondary ?? alpha(textPrimary, 0.7);
  const selected = theme.action?.selected ?? alpha(theme.primary.main, isDark ? 0.22 : 0.16);
  const controlAccent = getControlAccentColor(theme);
  const focus = theme.action?.focus ?? controlAccent;
  const appBarBackground = isDark ? getDarkChromeSurfaceColor() : theme.primary.main;
  const appBarText = isDark ? textPrimary : (theme.primary.contrastText ?? textPrimary);
  const linkMain = theme.components?.link?.main ?? theme.primary.main;
  const linkHover =
    theme.components?.link?.hover ?? (isDark ? (theme.primary.light ?? theme.primary.main) : (theme.primary.dark ?? theme.primary.main));

  return {
    background: {
      default: backgroundDefault,
      // Standard app surfaces intentionally use background.default. Paper remains populated for MUI compatibility.
      paper: backgroundDefault,
    },
    text: {
      primary: textPrimary,
      secondary: textSecondary,
    },
    action: {
      selected,
      selectedDarker: theme.action?.selectedDarker,
      focus,
    },
    appBar: {
      background: appBarBackground,
      text: appBarText,
      focus: isDark ? focus : appBarText,
    },
    statusBar: {
      background: appBarBackground,
      text: appBarText,
      textSecondary,
    },
    link: {
      main: linkMain,
      hover: linkHover,
    },
  };
}
