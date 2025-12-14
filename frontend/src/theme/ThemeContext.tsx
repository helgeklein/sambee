import { createTheme, type Theme } from "@mui/material/styles";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { builtInThemes, getDefaultTheme } from "./themes";
import type { ThemeConfig } from "./types";

//
// Theme context
//

const THEME_ID_STORAGE_KEY = "theme-id-current";
const BUILTIN_THEMES_STORAGE_KEY = "themes-builtin";
const CUSTOM_THEMES_STORAGE_KEY = "themes-custom";

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

  // Load or update built-in themes
  const [storedBuiltInThemes, setStoredBuiltInThemes] = useState<ThemeConfig[]>(() => {
    const saved = localStorage.getItem(BUILTIN_THEMES_STORAGE_KEY);
    const stored = saved ? JSON.parse(saved) : [];

    // Check if built-in themes need updating (compare with shipped themes)
    const needsUpdate =
      stored.length !== builtInThemes.length || builtInThemes.some((theme) => !stored.find((s: ThemeConfig) => s.id === theme.id));

    if (needsUpdate) {
      // Update localStorage with current built-in themes from code
      localStorage.setItem(BUILTIN_THEMES_STORAGE_KEY, JSON.stringify(builtInThemes));
      return builtInThemes;
    }

    return stored;
  });

  const [customThemes, setCustomThemes] = useState<ThemeConfig[]>(() => {
    // Load custom themes from localStorage
    const saved = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  // Sync built-in themes whenever they change in code
  useEffect(() => {
    const currentStored = JSON.stringify(storedBuiltInThemes);
    const currentShipped = JSON.stringify(builtInThemes);

    if (currentStored !== currentShipped) {
      localStorage.setItem(BUILTIN_THEMES_STORAGE_KEY, currentShipped);
      setStoredBuiltInThemes(builtInThemes);
    }
  }, [storedBuiltInThemes]);

  // All available themes (built-in + custom)
  const availableThemes = useMemo(() => [...storedBuiltInThemes, ...customThemes], [storedBuiltInThemes, customThemes]);

  // Current theme configuration
  const currentTheme = useMemo(
    () => availableThemes.find((t) => t.id === currentThemeId) ?? getDefaultTheme(),
    [availableThemes, currentThemeId]
  );

  // Material-UI theme object
  const muiTheme = useMemo(() => {
    return createTheme({
      palette: {
        mode: currentTheme.mode,
        primary: currentTheme.primary,
        secondary: currentTheme.secondary,
        ...(currentTheme.background && { background: currentTheme.background }),
        ...(currentTheme.text && { text: currentTheme.text }),
        ...(currentTheme.action && { action: currentTheme.action }),
      },
      typography: {
        fontFamily: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"].join(","),
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              scrollbarColor: currentTheme.mode === "dark" ? "#6b6b6b #2b2b2b" : "#c1c1c1 #f1f1f1",
              "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
                width: 12,
                height: 12,
              },
              "&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb": {
                borderRadius: 8,
                backgroundColor: currentTheme.mode === "dark" ? "#6b6b6b" : "#c1c1c1",
                minHeight: 24,
                border: currentTheme.mode === "dark" ? "3px solid #2b2b2b" : "3px solid #f1f1f1",
              },
              "&::-webkit-scrollbar-corner, & *::-webkit-scrollbar-corner": {
                backgroundColor: currentTheme.mode === "dark" ? "#2b2b2b" : "#f1f1f1",
              },
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

  // Persist custom themes
  useEffect(() => {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(customThemes));
  }, [customThemes]);

  const setThemeById = (themeId: string) => {
    if (availableThemes.find((t) => t.id === themeId)) {
      setCurrentThemeId(themeId);
    }
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
    setCustomThemes((prev) => prev.filter((t) => t.id !== themeId));
    // If removing current theme, switch to default
    if (currentThemeId === themeId) {
      setCurrentThemeId(getDefaultTheme().id);
    }
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
