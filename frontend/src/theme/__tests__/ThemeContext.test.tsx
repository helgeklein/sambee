import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider, useSambeeTheme } from "../ThemeContext";

const { loadCurrentUserSettingsMock, patchCurrentUserSettingsMock } = vi.hoisted(() => ({
  loadCurrentUserSettingsMock: vi.fn(),
  patchCurrentUserSettingsMock: vi.fn(),
}));

vi.mock("../../services/userSettingsSync", () => ({
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: patchCurrentUserSettingsMock,
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

    it("should persist theme change to localStorage", () => {
      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      act(() => {
        result.current.setThemeById("sambee-dark");
      });

      expect(localStorageMock.getItem("theme-id-current")).toBe("sambee-dark");
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

    it("should persist custom theme to localStorage", () => {
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

      const stored = localStorageMock.getItem("themes-custom");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.some((t: { id: string }) => t.id === "custom-test")).toBe(true);
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
      expect(localStorageMock.getItem("theme-id-current")).toBe("sambee-light");
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
        browser: {
          quick_nav_include_dot_directories: false,
          file_browser_view_mode: "list",
          pane_mode: "single",
          selected_connection_id: null,
        },
      });

      const { result } = renderHook(() => useSambeeTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.availableThemes.some((t) => t.id === "custom-1")).toBe(true);
      });

      expect(result.current.currentTheme.id).toBe("custom-1");
      expect(JSON.parse(localStorageMock.getItem("themes-custom") || "[]")).toEqual([
        {
          id: "custom-1",
          name: "Custom 1",
          mode: "light",
          primary: { main: "#ff0000" },
        },
      ]);
    });

    it("should patch backend when custom themes change", () => {
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

      expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({
        appearance: {
          custom_themes: [customTheme],
        },
      });
    });
  });
});
