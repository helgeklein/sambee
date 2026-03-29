import { createTheme, type Theme } from "@mui/material/styles";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { loadCurrentUserSettings, patchCurrentUserSettings } from "../services/userSettingsSync";
import { getContainedButtonFocusVisibleBoxShadow } from "./commonStyles";
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
  /** Switch to a different theme by ID */
  setThemeById: (themeId: string) => void;
  /** Add a custom theme */
  addCustomTheme: (theme: ThemeConfig) => void;
  /** Remove a custom theme */
  removeCustomTheme: (themeId: string) => void;
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

  // All available themes (built-in + custom)
  const availableThemes = useMemo(() => [...builtInThemes, ...customThemes], [customThemes]);

  // Current theme configuration
  const currentTheme = useMemo(
    () => availableThemes.find((t) => t.id === currentThemeId) ?? getDefaultTheme(),
    [availableThemes, currentThemeId]
  );

  // Material-UI theme object
  const muiTheme = useMemo(() => {
    // Derive colors once to avoid repetition
    const isDark = currentTheme.mode === "dark";

    // App bar derived colors
    const appBarBackground =
      currentTheme.components?.appBar?.background ?? (isDark ? currentTheme.background?.paper : currentTheme.primary.main);
    const appBarText = currentTheme.components?.appBar?.text ?? (isDark ? currentTheme.text?.primary : currentTheme.primary.contrastText);
    const appBarFocus = currentTheme.components?.appBar?.focus ?? appBarText ?? currentTheme.primary.contrastText;

    // Focus color for general use
    const focusColor =
      currentTheme.action?.focus ??
      (isDark ? (currentTheme.primary.light ?? currentTheme.primary.main) : (currentTheme.primary.dark ?? currentTheme.primary.main));

    // Scrollbar colors derived from theme
    const scrollbarThumb = isDark ? "#6b6b6b" : "#c1c1c1";
    const scrollbarTrack = isDark ? "#2b2b2b" : "#f1f1f1";

    // Shared focus outline style for buttons (outline ring only, no fill change)
    const buttonFocusOutline = {
      outline: `${FOCUS_OUTLINE_WIDTH_PX}px solid ${focusColor}`,
      outlineOffset: `${FOCUS_OUTLINE_OFFSET_PX}px`,
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
        ...(currentTheme.background && { background: currentTheme.background }),
        ...(currentTheme.text && { text: currentTheme.text }),
        ...(currentTheme.action && { action: currentTheme.action }),
        // Add component semantic tokens to palette for direct access
        ...(currentTheme.components && {
          appBar: currentTheme.components.appBar,
          statusBar: currentTheme.components.statusBar,
        }),
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
              backgroundColor: appBarBackground,
              color: appBarText,
              // Remove default dark mode overlay gradient
              backgroundImage: "none",
              // Ensure Select components inside AppBar inherit the text color
              "& .MuiSelect-select": { color: appBarText },
              "& .MuiSelect-icon": { color: appBarText },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: appBarText },
              // Focus outline for buttons inside AppBar
              "& .MuiButtonBase-root.Mui-focusVisible": {
                outline: `${FOCUS_OUTLINE_WIDTH_PX}px solid ${appBarFocus}`,
                outlineOffset: `${FOCUS_OUTLINE_OFFSET_PX}px`,
              },
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundColor: currentTheme.background?.default,
              backgroundImage: "none",
            },
          },
        },
        MuiLink: {
          defaultProps: {
            underline: "none",
          },
          styleOverrides: {
            root: {
              color: currentTheme.components?.link?.main ?? currentTheme.primary.main,
              "&:hover": {
                color: currentTheme.components?.link?.hover ?? currentTheme.primary.dark,
              },
              "&.Mui-focusVisible": {
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
              backgroundColor: currentTheme.background?.default,
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
                backgroundColor: currentTheme.action?.selected,
              },
              "&.Mui-focusVisible": {
                backgroundColor: currentTheme.action?.selected,
              },
              "&.Mui-selected": {
                fontWeight: 600,
                backgroundColor: "transparent",
                "&:hover": {
                  backgroundColor: currentTheme.action?.selected,
                },
                "&.Mui-focusVisible": {
                  backgroundColor: currentTheme.action?.selected,
                },
              },
            },
          },
        },
        // Focus styles for Button - clean outline ring (keyboard nav only)
        MuiButton: {
          defaultProps: {
            disableFocusRipple: true,
          },
          styleOverrides: {
            root: {
              textTransform: "none",
              "&.Mui-focusVisible": buttonFocusOutline,
            },
            // Text/outlined buttons: strip background on focus for a clean look.
            // In dark mode, override text color for visibility.
            text: {
              "&.Mui-focusVisible": {
                backgroundColor: "transparent",
                ...(isDark && { color: currentTheme.primary.main }),
              },
            },
            outlined: {
              "&.Mui-focusVisible": {
                backgroundColor: "transparent",
                ...(isDark && { color: currentTheme.primary.main }),
              },
            },
            contained: ({ theme }) => ({
              "&.Mui-focusVisible": {
                outline: "none",
                boxShadow: getContainedButtonFocusVisibleBoxShadow(theme),
              },
            }),
          },
        },
        // Focus styles for IconButton - clean outline ring (keyboard nav only)
        MuiIconButton: {
          defaultProps: {
            disableFocusRipple: true,
          },
          styleOverrides: {
            root: {
              "&.Mui-focusVisible": buttonFocusOutline,
            },
          },
        },
        // Keep form labels readable when focused (don't use primary yellow color)
        MuiInputLabel: {
          styleOverrides: {
            root: {
              "&.Mui-focused": {
                color: currentTheme.text?.primary,
              },
            },
          },
        },
        // Keep helper text readable when input is focused
        MuiFormHelperText: {
          styleOverrides: {
            root: {
              color: currentTheme.text?.secondary,
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

  // Persist theme selection
  useEffect(() => {
    localStorage.setItem(THEME_ID_STORAGE_KEY, currentThemeId);
  }, [currentThemeId]);

  useEffect(() => {
    let cancelled = false;

    const syncFromBackend = async () => {
      const settings = await loadCurrentUserSettings(true);
      if (!settings || cancelled) {
        return;
      }

      const backendCustomThemes = Array.isArray(settings.appearance.custom_themes) ? settings.appearance.custom_themes : [];
      const resolvedThemes = [...builtInThemes, ...backendCustomThemes];

      setCustomThemes((previousThemes) =>
        areThemeCollectionsEqual(backendCustomThemes, previousThemes) ? previousThemes : backendCustomThemes
      );

      const backendThemeId = settings.appearance.theme_id;
      if (resolvedThemes.some((theme) => theme.id === backendThemeId)) {
        setCurrentThemeId(backendThemeId);
      }
    };

    void syncFromBackend();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist custom themes
  useEffect(() => {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(customThemes));
  }, [customThemes]);

  const setThemeById = (themeId: string) => {
    if (availableThemes.find((t) => t.id === themeId)) {
      setCurrentThemeId(themeId);
      void patchCurrentUserSettings({
        appearance: {
          theme_id: themeId,
        },
      });
    }
  };

  const addCustomTheme = (theme: ThemeConfig) => {
    let nextCustomThemes: ThemeConfig[] = [];

    setCustomThemes((prev) => {
      // Replace if exists, add if new
      const existing = prev.findIndex((t) => t.id === theme.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = theme;
        nextCustomThemes = updated;
        return updated;
      }
      nextCustomThemes = [...prev, theme];
      return nextCustomThemes;
    });

    void patchCurrentUserSettings({
      appearance: {
        custom_themes: nextCustomThemes,
      },
    });
  };

  const removeCustomTheme = (themeId: string) => {
    if (builtInThemes.some((theme) => theme.id === themeId)) {
      return;
    }

    let nextCustomThemes: ThemeConfig[] = [];
    const nextThemeId = currentThemeId === themeId ? getDefaultTheme().id : undefined;

    setCustomThemes((prev) => {
      nextCustomThemes = prev.filter((t) => t.id !== themeId);
      return nextCustomThemes;
    });

    // If removing current theme, switch to default
    if (nextThemeId) {
      setCurrentThemeId(nextThemeId);
    }

    void patchCurrentUserSettings({
      appearance: {
        ...(nextThemeId ? { theme_id: nextThemeId } : {}),
        custom_themes: nextCustomThemes,
      },
    });
  };

  const value: ThemeContextValue = {
    currentTheme,
    muiTheme,
    availableThemes,
    setThemeById,
    addCustomTheme,
    removeCustomTheme,
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
