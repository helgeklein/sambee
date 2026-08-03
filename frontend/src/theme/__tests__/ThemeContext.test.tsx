import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUserSettings } from "../../types";
import { SambeeThemeProvider, useSambeeTheme } from "../ThemeContext";

const { loadCurrentUserSettingsMock, patchCurrentUserSettingsMock, userSettingsChangedEvent } = vi.hoisted(() => ({
  loadCurrentUserSettingsMock: vi.fn(),
  patchCurrentUserSettingsMock: vi.fn(),
  userSettingsChangedEvent: "sambee:user-settings-changed",
}));

vi.mock("../../services/userSettingsSync", () => ({
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: patchCurrentUserSettingsMock,
  USER_SETTINGS_CHANGED_EVENT: userSettingsChangedEvent,
}));

//
// ThemeContext.test.tsx
//

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("Theme System - ThemeContext", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    loadCurrentUserSettingsMock.mockResolvedValue(null);
    patchCurrentUserSettingsMock.mockResolvedValue(null);
  });

  const wrapper = ({ children }: { children: ReactNode }) => <SambeeThemeProvider>{children}</SambeeThemeProvider>;

  describe("Initialization", () => {
    it("should initialize with default light theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.currentTheme.id).toBe("sambee-light");
      expect(result.current.currentTheme.mode).toBe("light");
    });

    it("should provide availableThemes", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.availableThemes.length).toBeGreaterThanOrEqual(2);
      expect(result.current.availableThemes.some((t) => t.id === "sambee-light")).toBe(true);
      expect(result.current.availableThemes.some((t) => t.id === "sambee-dark")).toBe(true);
    });

    it("should provide a valid MUI theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.muiTheme).toBeDefined();
      expect(result.current.muiTheme.palette).toBeDefined();
      expect(result.current.muiTheme.palette.primary).toBeDefined();
      expect(result.current.muiTheme.palette.background.paper).toBe(result.current.muiTheme.palette.background.default);
    });

    it("does not override Material UI checkbox defaults", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.muiTheme.components?.MuiCheckbox).toBeUndefined();
    });

    it("applies the semantic dark warning colors to standard alerts", () => {
      localStorageMock.setItem("theme-id-current", "sambee-dark");

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });
      const standardOverride = result.current.muiTheme.components?.MuiAlert?.styleOverrides?.standard as
        | ((props: { ownerState: { severity: string } }) => object)
        | undefined;

      expect(standardOverride?.({ ownerState: { severity: "warning" } })).toEqual({
        "&&": {
          backgroundColor: "#E65100",
          color: "#FFE0B2",
          "& .MuiAlert-icon": {
            color: "#FFB74D",
          },
        },
      });
      expect(standardOverride?.({ ownerState: { severity: "success" } })).toEqual({
        "&&": {
          backgroundColor: "#1B5E20",
          color: "#C8E6C9",
          "& .MuiAlert-icon": {
            color: "#81C784",
          },
        },
      });
    });

    it("should restore theme from localStorage", () => {
      localStorageMock.setItem("theme-id-current", "sambee-dark");

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.currentTheme.id).toBe("sambee-dark");
    });

    it("should fall back to default if localStorage has invalid theme ID", () => {
      localStorageMock.setItem("theme-id-current", "non-existent-theme");

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.currentTheme.id).toBe("sambee-light");
    });
  });

  describe("setThemeById", () => {
    it("should switch to dark theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      act(() => {
        result.current.setThemeById("sambee-dark");
      });

      expect(result.current.currentTheme.id).toBe("sambee-dark");
      expect(result.current.currentTheme.mode).toBe("dark");
    });

    it("should switch to light theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      // First switch to dark
      act(() => {
        result.current.setThemeById("sambee-dark");
      });

      // Then switch back to light
      act(() => {
        result.current.setThemeById("sambee-light");
      });

      expect(result.current.currentTheme.id).toBe("sambee-light");
      expect(result.current.currentTheme.mode).toBe("light");
    });

    it("should not persist a previewed theme change", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      act(() => {
        result.current.setThemeById("sambee-dark");
      });

      expect(localStorageMock.getItem("theme-id-current")).toBeNull();
    });

    it("should not change theme if ID is invalid", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const initialTheme = result.current.currentTheme.id;

      act(() => {
        result.current.setThemeById("non-existent-theme");
      });

      expect(result.current.currentTheme.id).toBe(initialTheme);
    });

    it("should update MUI theme when switching themes", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const lightPalette = result.current.muiTheme.palette.mode;

      act(() => {
        result.current.setThemeById("sambee-dark");
      });

      const darkPalette = result.current.muiTheme.palette.mode;

      expect(lightPalette).toBe("light");
      expect(darkPalette).toBe("dark");
      expect(result.current.muiTheme.palette.primary.main).toBe("#D4A020");
      expect(result.current.muiTheme.palette.primary.light).toBe("#F4C430");
      expect(result.current.muiTheme.palette.action.focus).toBe("#D4A020");
      expect(result.current.muiTheme.palette.text.primary).toBe("#F6F1E8");
      expect(result.current.muiTheme.palette.text.secondary).toBe("#F6F1E8B3");
      expect(result.current.muiTheme.palette.background.paper).toBe(result.current.muiTheme.palette.background.default);
      expect(result.current.muiTheme.palette.appBar?.background).toBe("#382c0a");
      expect(result.current.muiTheme.palette.statusBar?.background).toBe("#382c0a");
      expect(result.current.muiTheme.components?.MuiMenu?.styleOverrides?.paper).toMatchObject({
        backgroundColor: "#382c0a",
      });
      expect(result.current.muiTheme.components?.MuiDialog?.styleOverrides?.paper).toMatchObject({
        backgroundColor: "#382c0a",
        boxShadow: "none",
        ["--sambee-dialog-surface"]: "#382c0a",
        ["--sambee-dialog-form-surface"]: "color-mix(in srgb, black 12%, #382c0a)",
      });
      expect(result.current.muiTheme.components?.MuiDialog?.styleOverrides?.root).toMatchObject({
        "& .MuiBackdrop-root": {
          backgroundColor: "rgba(31, 38, 43, 0.92)",
        },
      });
      expect(result.current.muiTheme.palette.action.selected).toBe("#D4A02038");
    });

    it("keeps a saved theme when a stale settings sync resolves", async () => {
      let resolveSettings: ((settings: CurrentUserSettings) => void) | undefined;
      loadCurrentUserSettingsMock.mockImplementation(
        () =>
          new Promise<CurrentUserSettings>((resolve) => {
            resolveSettings = resolve;
          })
      );

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      await waitFor(() => {
        expect(loadCurrentUserSettingsMock).toHaveBeenCalled();
      });

      act(() => {
        result.current.setThemeById("sambee-dark");
        result.current.saveThemeById("sambee-dark");
      });

      await act(async () => {
        resolveSettings?.({
          appearance: {
            theme_id: "sambee-light",
            custom_themes: [],
          },
          localization: {
            language: "browser",
            regional_locale: "browser",
          },
          browser: {
            quick_nav_include_dot_directories: false,
            file_browser_view_mode: "list",
            pane_mode: "single",
            selected_connection_id: null,
            viewer_associations: {},
          },
        });
      });

      expect(result.current.currentTheme.id).toBe("sambee-dark");
      expect(localStorageMock.getItem("theme-id-current")).toBe("sambee-dark");
    });
  });

  describe("addCustomTheme", () => {
    it("should add a new custom theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
        secondary: { main: "#00ff00" },
      };

      act(() => {
        result.current.addCustomTheme(customTheme);
      });

      expect(result.current.availableThemes.some((t) => t.id === "custom-test")).toBe(true);
    });

    it("should not persist a custom theme draft", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
        secondary: { main: "#00ff00" },
      };

      act(() => {
        result.current.addCustomTheme(customTheme);
      });

      expect(localStorageMock.getItem("themes-custom")).toBeNull();
    });

    it("should allow switching to custom theme", async () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
        secondary: { main: "#00ff00" },
      };

      await act(async () => {
        result.current.addCustomTheme(customTheme);
      });

      await act(async () => {
        result.current.setThemeById("custom-test");
      });

      expect(result.current.currentTheme.id).toBe("custom-test");
      expect(result.current.currentTheme.name).toBe("Test Theme");
      expect(result.current.muiTheme.palette.background.paper).toBe(result.current.muiTheme.palette.background.default);
      expect(result.current.muiTheme.palette.action.focus).toBe("#ff0000");
    });
  });

  describe("removeCustomTheme", () => {
    it("should remove a custom theme", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
        secondary: { main: "#00ff00" },
      };

      act(() => {
        result.current.addCustomTheme(customTheme);
      });

      expect(result.current.availableThemes.some((t) => t.id === "custom-test")).toBe(true);

      act(() => {
        result.current.removeCustomTheme("custom-test");
      });

      expect(result.current.availableThemes.some((t) => t.id === "custom-test")).toBe(false);
    });

    it("should not remove built-in themes", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      act(() => {
        result.current.removeCustomTheme("sambee-light");
      });

      expect(result.current.availableThemes.some((t) => t.id === "sambee-light")).toBe(true);
    });

    it("should switch to default theme if removing current theme", async () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
        secondary: { main: "#00ff00" },
      };

      await act(async () => {
        result.current.addCustomTheme(customTheme);
      });

      await act(async () => {
        result.current.setThemeById("custom-test");
      });

      expect(result.current.currentTheme.id).toBe("custom-test");

      await act(async () => {
        result.current.removeCustomTheme("custom-test");
      });

      expect(result.current.currentTheme.id).toBe("sambee-light");
    });
  });

  describe("LocalStorage persistence", () => {
    it("should use shipped built-in themes without persisting a built-in cache", () => {
      renderHook(() => useSambeeTheme(), { wrapper });

      expect(localStorageMock.getItem("themes-builtin")).toBeNull();
      expect(localStorageMock.getItem("theme-id-current")).toBeNull();
    });

    it("should restore custom themes from localStorage", () => {
      const customThemes = [
        {
          id: "custom-1",
          name: "Custom 1",
          mode: "light",
          primary: { main: "#ff0000" },
          secondary: { main: "#00ff00" },
        },
      ];

      localStorageMock.setItem("themes-custom", JSON.stringify(customThemes));

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      expect(result.current.availableThemes.some((t) => t.id === "custom-1")).toBe(true);
    });

    it("should sync custom themes from backend settings", async () => {
      loadCurrentUserSettingsMock.mockResolvedValue({
        appearance: {
          theme_id: "custom-1",
          custom_themes: [
            {
              id: "custom-1",
              name: "Custom 1",
              mode: "light",
              primary: { main: "#ff0000" },
            },
          ],
        },
        localization: {
          language: "browser",
          regional_locale: "browser",
        },
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: "list",
          pane_mode: "single",
          selected_connection_id: null,
          viewer_associations: {},
        },
      });

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.availableThemes.some((t) => t.id === "custom-1")).toBe(true);
      });

      expect(result.current.currentTheme.id).toBe("custom-1");
      expect(localStorageMock.getItem("themes-custom")).toBeNull();
    });

    it("should patch backend only after custom themes are explicitly saved", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      const customTheme = {
        id: "custom-test",
        name: "Test Theme",
        mode: "light" as const,
        primary: { main: "#ff0000" },
      };

      act(() => {
        result.current.addCustomTheme(customTheme);
      });

      expect(patchCurrentUserSettingsMock).not.toHaveBeenCalled();

      act(() => {
        result.current.saveCustomThemes();
      });

      expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({
        appearance: {
          theme_id: "sambee-light",
          custom_themes: [customTheme],
        },
      });
    });

    it("should apply appearance updates from user settings change events", async () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      act(() => {
        window.dispatchEvent(
          new CustomEvent(userSettingsChangedEvent, {
            detail: {
              appearance: {
                theme_id: "custom-2",
                custom_themes: [
                  {
                    id: "custom-2",
                    name: "Custom 2",
                    mode: "light",
                    primary: { main: "#123456" },
                  },
                ],
              },
              localization: {
                language: "browser",
                regional_locale: "browser",
              },
              browser: {
                quick_nav_include_dot_directories: false,
                file_browser_view_mode: "list",
                pane_mode: "single",
                selected_connection_id: null,
                viewer_associations: {},
              },
            },
          })
        );
      });

      await waitFor(() => {
        expect(result.current.currentTheme.id).toBe("custom-2");
      });
      expect(result.current.availableThemes.some((theme) => theme.id === "custom-2")).toBe(true);
    });
  });
});
