import { alpha, createTheme, type Theme } from "@mui/material";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadCurrentUserSettings, patchCurrentUserSettings, USER_SETTINGS_CHANGED_EVENT } from "../services/userSettingsSync";
import type { CurrentUserSettings, CurrentUserSettingsUpdate } from "../types";
import {
  DIALOG_FORM_SURFACE_CSS_VARIABLE,
  DIALOG_SURFACE_CSS_VARIABLE,
  getDarkChromeSurfaceColor,
  getDialogSurfaceTokens,
  resolveThemePalette,
} from "./palette";
import { builtInThemes, getDefaultTheme } from "./themes";
import type { ThemeConfig } from "./types";

//
// Theme context
//

const THEME_ID_STORAGE_KEY = "theme-id-current";
const CUSTOM_THEMES_STORAGE_KEY = "themes-custom";

// Styling constants
const FOCUS_OUTLINE_WIDTH_PX = 3;
const FOCUS_OUTLINE_OFFSET_PX = 0;
const SCROLLBAR_WIDTH_PX = 12;
const SCROLLBAR_THUMB_BORDER_RADIUS_PX = 8;
const SCROLLBAR_THUMB_MIN_HEIGHT_PX = 24;
const SCROLLBAR_THUMB_BORDER_PX = 3;
const POPUP_OVERLAY_Z_INDEX_OFFSET = 2;

function readStoredThemeConfigs(key: string): ThemeConfig[] {
  const saved = localStorage.getItem(key);
  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function areThemeCollectionsEqual(left: ThemeConfig[], right: ThemeConfig[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface ThemeContextValue {
  /** Current theme configuration */
  currentTheme: ThemeConfig;
  /** Material-UI theme object */
  muiTheme: Theme;
  /** All available themes */
  availableThemes: ThemeConfig[];
  /** Preview a different theme by ID without persisting it. */
  setThemeById: (themeId: string) => void;
  /** Persist a theme selection after it has been explicitly confirmed. */
  saveThemeById: (themeId: string, additionalSettings?: Pick<CurrentUserSettingsUpdate, "localization">) => void;
  /** Add or update a custom theme draft. */
  addCustomTheme: (theme: ThemeConfig) => void;
  /** Remove a custom theme draft. */
  removeCustomTheme: (themeId: string) => void;
  /** Persist custom-theme edits after they have been explicitly confirmed. */
  saveCustomThemes: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

//
// ThemeProvider
//

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme provider that manages theme state and persistence
 */
export function SambeeThemeProvider({ children }: ThemeProviderProps) {
  const [currentThemeId, setCurrentThemeId] = useState<string>(() => {
    // Load saved theme from localStorage
    const saved = localStorage.getItem(THEME_ID_STORAGE_KEY);
    return saved || getDefaultTheme().id;
  });

  const [customThemes, setCustomThemes] = useState<ThemeConfig[]>(() => {
    // Load custom themes from localStorage
    return readStoredThemeConfigs(CUSTOM_THEMES_STORAGE_KEY);
  });
  const previewThemeIdRef = useRef<string | null>(null);
  const pendingSavedThemeIdRef = useRef<string | null>(null);

  // All available themes (built-in + custom)
  const availableThemes = useMemo(() => [...builtInThemes, ...customThemes], [customThemes]);

  // Current theme configuration
  const currentTheme = useMemo(
    () => availableThemes.find((t) => t.id === currentThemeId) ?? getDefaultTheme(),
    [availableThemes, currentThemeId]
  );

  // Material-UI theme object
  const muiTheme = useMemo(() => {
    const isDark = currentTheme.mode === "dark";
    const palette = resolveThemePalette(currentTheme);
    const { appBar, action, background, link, statusBar, text } = palette;
    const focusColor = action.focus;
    const dialogSurfaces = getDialogSurfaceTokens(background.default, currentTheme.mode);
    const menuBackground = isDark ? getDarkChromeSurfaceColor() : background.default;
    const alertColors = currentTheme.components?.alert;
    const getStandardAlertStyle = (severity: "info" | "success" | "warning" | "error") => {
      const alertColor = alertColors?.[severity];

      if (!alertColor) {
        return {};
      }

      return {
        "&&": {
          backgroundColor: alertColor.background,
          color: alertColor.text,
          "& .MuiAlert-icon": {
            color: alertColor.icon,
          },
        },
      };
    };

    // Scrollbar colors derived from theme
    const scrollbarThumb = alpha(text.primary, isDark ? 0.4 : 0.28);
    const scrollbarTrack = alpha(text.primary, isDark ? 0.12 : 0.08);

    const getButtonFocusOutline = (theme: Theme, color?: string) => {
      const outlineColor = color === "warning" ? theme.palette.warning.main : color === "error" ? theme.palette.error.main : focusColor;

      return {
        outline: `${FOCUS_OUTLINE_WIDTH_PX}px solid ${outlineColor}`,
        outlineOffset: `${FOCUS_OUTLINE_OFFSET_PX}px`,
      };
    };

    return createTheme({
      // Custom breakpoints: 768px is the mobile/desktop threshold
      breakpoints: {
        values: {
          xs: 0,
          sm: 768, // Mobile/desktop threshold (default: 600)
          md: 960,
          lg: 1280,
          xl: 1920,
        },
      },
      palette: {
        mode: currentTheme.mode,
        primary: currentTheme.primary,
        background,
        text,
        action,
        appBar,
        statusBar,
      },
      typography: {
        fontFamily: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"].join(","),
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              scrollbarColor: `${scrollbarThumb} ${scrollbarTrack}`,
              "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
                width: SCROLLBAR_WIDTH_PX,
                height: SCROLLBAR_WIDTH_PX,
              },
              "&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb": {
                borderRadius: SCROLLBAR_THUMB_BORDER_RADIUS_PX,
                backgroundColor: scrollbarThumb,
                minHeight: SCROLLBAR_THUMB_MIN_HEIGHT_PX,
                border: `${SCROLLBAR_THUMB_BORDER_PX}px solid ${scrollbarTrack}`,
              },
              "&::-webkit-scrollbar-corner, & *::-webkit-scrollbar-corner": {
                backgroundColor: scrollbarTrack,
              },
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              backgroundColor: appBar.background,
              color: appBar.text,
              // Remove default dark mode overlay gradient
              backgroundImage: "none",
              // Ensure Select components inside AppBar inherit the text color
              "& .MuiSelect-select": { color: appBar.text },
              "& .MuiSelect-icon": { color: appBar.text },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: appBar.text },
              // Focus outline for buttons inside AppBar
              "& .MuiButtonBase-root.Mui-focusVisible": {
                outline: `${FOCUS_OUTLINE_WIDTH_PX}px solid ${appBar.focus}`,
                outlineOffset: `${FOCUS_OUTLINE_OFFSET_PX}px`,
              },
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundColor: background.default,
              backgroundImage: "none",
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            root: {
              "& .MuiBackdrop-root": {
                backgroundColor: dialogSurfaces.backdrop,
              },
            },
            paper: {
              backgroundColor: dialogSurfaces.paper,
              backgroundImage: "none",
              boxShadow: "none",
              [DIALOG_SURFACE_CSS_VARIABLE]: dialogSurfaces.paper,
              [DIALOG_FORM_SURFACE_CSS_VARIABLE]: dialogSurfaces.form,
            },
          },
        },
        MuiLink: {
          defaultProps: {
            underline: "none",
          },
          styleOverrides: {
            root: {
              color: link.main,
              "&:hover": {
                color: link.hover,
              },
              "&.Mui-focusVisible": {
                outline: "none",
                textDecoration: "underline",
                textDecorationThickness: "2px",
                textUnderlineOffset: "3px",
                textDecorationColor: focusColor,
              },
            },
          },
        },
        MuiMenu: {
          styleOverrides: {
            root: ({ theme }) => ({
              zIndex: theme.zIndex.modal + POPUP_OVERLAY_Z_INDEX_OFFSET,
            }),
            paper: {
              backgroundColor: menuBackground,
            },
          },
        },
        MuiPopover: {
          styleOverrides: {
            root: ({ theme }) => ({
              zIndex: theme.zIndex.modal + POPUP_OVERLAY_Z_INDEX_OFFSET,
            }),
          },
        },
        MuiPopper: {
          styleOverrides: {
            root: ({ theme }) => ({
              zIndex: `${theme.zIndex.modal + POPUP_OVERLAY_Z_INDEX_OFFSET} !important`,
            }),
          },
        },
        MuiMenuItem: {
          styleOverrides: {
            root: {
              "&:hover": {
                backgroundColor: action.selected,
              },
              "&.Mui-focusVisible": {
                backgroundColor: action.selected,
              },
              "&.Mui-selected": {
                fontWeight: 600,
                backgroundColor: action.selected,
                "&:hover": {
                  backgroundColor: action.selected,
                },
                "&.Mui-focusVisible": {
                  backgroundColor: action.selected,
                },
              },
            },
          },
        },
        MuiListItemIcon: {
          styleOverrides: {
            root: {
              color: "inherit",
            },
          },
        },
        MuiAlert: {
          styleOverrides: {
            standard: ({ ownerState }) =>
              ownerState.severity === "info" ||
              ownerState.severity === "success" ||
              ownerState.severity === "warning" ||
              ownerState.severity === "error"
                ? getStandardAlertStyle(ownerState.severity)
                : {},
          },
        },
        // Focus styles for Button - clean outline ring (keyboard nav only)
        MuiButton: {
          defaultProps: {
            disableFocusRipple: true,
          },
          styleOverrides: {
            root: ({ ownerState, theme }) => ({
              textTransform: "none",
              "&.Mui-focusVisible": getButtonFocusOutline(theme, ownerState.color),
            }),
            // Text/outlined buttons retain their semantic color when focused.
            text: {
              "&.Mui-focusVisible": {
                backgroundColor: "transparent",
              },
            },
            outlined: {
              "&.Mui-focusVisible": {
                backgroundColor: "transparent",
              },
            },
          },
        },
        // Focus styles for IconButton - clean outline ring (keyboard nav only)
        MuiIconButton: {
          defaultProps: {
            disableFocusRipple: true,
          },
          styleOverrides: {
            root: ({ theme }) => ({
              "&.Mui-focusVisible": {
                outline: `${FOCUS_OUTLINE_WIDTH_PX}px solid ${theme.palette.primary.main}`,
                outlineOffset: `${FOCUS_OUTLINE_OFFSET_PX}px`,
              },
            }),
          },
        },
        // Keep form labels readable when focused (don't use primary yellow color)
        MuiInputLabel: {
          styleOverrides: {
            root: {
              "&.Mui-focused": {
                color: text.primary,
              },
            },
          },
        },
        // Keep helper text readable when input is focused
        MuiFormHelperText: {
          styleOverrides: {
            root: {
              color: text.secondary,
              marginTop: 8,
              marginLeft: 0,
              marginRight: 0,
            },
          },
        },
        // Align dialog action buttons with dialog content padding
        MuiDialogActions: {
          styleOverrides: {
            root: {
              padding: "16px 24px",
            },
          },
        },
      },
    });
  }, [currentTheme]);

  // Update meta theme-color when theme changes
  useEffect(() => {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", currentTheme.primary.main);
    }
  }, [currentTheme.primary.main]);

  useEffect(() => {
    let cancelled = false;

    const applyAppearanceSettings = (settings: CurrentUserSettings | null) => {
      if (!settings || cancelled) {
        return;
      }

      const backendCustomThemes = Array.isArray(settings.appearance.custom_themes) ? settings.appearance.custom_themes : [];
      const resolvedThemes = [...builtInThemes, ...backendCustomThemes];

      setCustomThemes((previousThemes) =>
        areThemeCollectionsEqual(backendCustomThemes, previousThemes) ? previousThemes : backendCustomThemes
      );

      const backendThemeId = settings.appearance.theme_id;
      if (!resolvedThemes.some((theme) => theme.id === backendThemeId)) {
        return;
      }

      const pendingSavedThemeId = pendingSavedThemeIdRef.current;
      if (pendingSavedThemeId) {
        if (backendThemeId === pendingSavedThemeId) {
          pendingSavedThemeIdRef.current = null;
          setCurrentThemeId(backendThemeId);
        }
        return;
      }

      const previewThemeId = previewThemeIdRef.current;
      if (previewThemeId) {
        if (backendThemeId === previewThemeId) {
          previewThemeIdRef.current = null;
          setCurrentThemeId(backendThemeId);
        }
        return;
      }

      setCurrentThemeId(backendThemeId);
    };

    const syncFromBackend = async () => {
      const settings = await loadCurrentUserSettings();
      applyAppearanceSettings(settings);
    };

    const handleUserSettingsChanged = (event: Event) => {
      applyAppearanceSettings((event as CustomEvent<CurrentUserSettings>).detail);
    };

    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    void syncFromBackend();

    return () => {
      cancelled = true;
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  const setThemeById = (themeId: string) => {
    if (availableThemes.find((t) => t.id === themeId)) {
      previewThemeIdRef.current = themeId;
      pendingSavedThemeIdRef.current = null;
      setCurrentThemeId(themeId);
    }
  };

  const saveThemeById = (themeId: string, additionalSettings?: Pick<CurrentUserSettingsUpdate, "localization">) => {
    if (!availableThemes.find((theme) => theme.id === themeId)) {
      return;
    }

    previewThemeIdRef.current = null;
    pendingSavedThemeIdRef.current = themeId;
    setCurrentThemeId(themeId);
    localStorage.setItem(THEME_ID_STORAGE_KEY, themeId);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(customThemes));
    void patchCurrentUserSettings({
      ...additionalSettings,
      appearance: { theme_id: themeId, custom_themes: customThemes },
    });
  };

  const addCustomTheme = (theme: ThemeConfig) => {
    setCustomThemes((prev) => {
      // Replace if exists, add if new
      const existing = prev.findIndex((t) => t.id === theme.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = theme;
        return updated;
      }
      return [...prev, theme];
    });
  };

  const removeCustomTheme = (themeId: string) => {
    if (builtInThemes.some((theme) => theme.id === themeId)) {
      return;
    }

    const nextThemeId = currentThemeId === themeId ? getDefaultTheme().id : undefined;

    setCustomThemes((prev) => {
      return prev.filter((theme) => theme.id !== themeId);
    });

    // If removing current theme, switch to default
    if (nextThemeId) {
      setCurrentThemeId(nextThemeId);
    }
  };

  const saveCustomThemes = () => {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(customThemes));
    localStorage.setItem(THEME_ID_STORAGE_KEY, currentThemeId);
    void patchCurrentUserSettings({ appearance: { theme_id: currentThemeId, custom_themes: customThemes } });
  };

  const value: ThemeContextValue = {
    currentTheme,
    muiTheme,
    availableThemes,
    setThemeById,
    saveThemeById,
    addCustomTheme,
    removeCustomTheme,
    saveCustomThemes,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

//
// useTheme hook
//

/**
 * Hook to access theme context
 */
export function useSambeeTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useSambeeTheme must be used within SambeeThemeProvider");
  }
  return context;
}
