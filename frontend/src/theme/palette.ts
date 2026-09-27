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
const LIGHT_FOCUS_OPACITY = 0.57;
const DARK_FOCUS_OPACITY = 0.94;

export const VIEWER_FALLBACKS = {
  TOOLBAR_BG: "rgba(0,0,0,0.8)",
  TOOLBAR_TEXT: "#ffffff",
  IMAGE_VIEWER_BG: "#000000",
  PDF_VIEWER_BG: "#525252",
  MARKDOWN_VIEWER_BG: "#ffffff",
  MARKDOWN_VIEWER_TEXT: "#000000",
} as const;

export const OVERLAY_SURFACE_CSS_VARIABLE = "--sambee-overlay-surface";
export const FORM_SURFACE_CSS_VARIABLE = "--sambee-form-surface";

export interface OverlaySurfaceTokens {
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
  viewers: {
    image: { viewerBg: string; toolbarBg: string; toolbarText: string };
    pdf: { viewerBg: string; toolbarBg: string; toolbarText: string };
    markdown: { viewerBg: string; toolbarBg: string; toolbarText: string; viewerText: string; linkColor: string; linkHoverColor: string };
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

export function getDarkChromeSurfaceColor(theme?: ThemeConfig): string {
  return theme?.background?.chrome ?? DARK_CHROME_SURFACE;
}

export function getOverlaySurfaceTokens(background: string, mode: ThemeConfig["mode"], chrome?: string): OverlaySurfaceTokens {
  const paper = mode === "dark" ? (chrome ?? getDarkChromeSurfaceColor()) : background;

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
  const focus = alpha(textPrimary, isDark ? DARK_FOCUS_OPACITY : LIGHT_FOCUS_OPACITY);
  const appBarBackground = isDark ? getDarkChromeSurfaceColor(theme) : theme.primary.main;
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
    viewers: {
      image: {
        viewerBg: theme.components?.imageViewer?.viewerBackground ?? VIEWER_FALLBACKS.IMAGE_VIEWER_BG,
        toolbarBg: theme.components?.imageViewer?.toolbarBackground ?? VIEWER_FALLBACKS.TOOLBAR_BG,
        toolbarText: theme.components?.imageViewer?.toolbarText ?? VIEWER_FALLBACKS.TOOLBAR_TEXT,
      },
      pdf: {
        viewerBg: theme.components?.pdfViewer?.viewerBackground ?? VIEWER_FALLBACKS.PDF_VIEWER_BG,
        toolbarBg: theme.components?.pdfViewer?.toolbarBackground ?? VIEWER_FALLBACKS.TOOLBAR_BG,
        toolbarText: theme.components?.pdfViewer?.toolbarText ?? VIEWER_FALLBACKS.TOOLBAR_TEXT,
      },
      markdown: {
        viewerBg: theme.components?.markdownViewer?.viewerBackground ?? VIEWER_FALLBACKS.MARKDOWN_VIEWER_BG,
        toolbarBg: theme.components?.markdownViewer?.toolbarBackground ?? VIEWER_FALLBACKS.TOOLBAR_BG,
        toolbarText: theme.components?.markdownViewer?.toolbarText ?? VIEWER_FALLBACKS.TOOLBAR_TEXT,
        viewerText: theme.components?.markdownViewer?.viewerText ?? VIEWER_FALLBACKS.MARKDOWN_VIEWER_TEXT,
        linkColor: linkMain,
        linkHoverColor: linkHover,
      },
    },
  };
}
