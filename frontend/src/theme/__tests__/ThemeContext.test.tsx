import { readFileSync } from "node:fs";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCurrentUserSettingMock, getThemesMock } = vi.hoisted(() => ({ useCurrentUserSettingMock: vi.fn(), getThemesMock: vi.fn() }));

vi.mock("../../services/api", () => ({
  default: { getThemes: getThemesMock, getCurrentUser: () => Promise.resolve({ role: "editor" }) },
}));

vi.mock("../../services/userSettingsStore", () => ({
  useCurrentUserSetting: useCurrentUserSettingMock,
  refreshCurrentUserSettings: () => Promise.resolve(),
}));

import { SambeeThemeProvider, useSambeeTheme } from "../ThemeContext";

function createWrapper() {
  return ({ children }: { children: ReactNode }) => <SambeeThemeProvider>{children}</SambeeThemeProvider>;
}

describe("ThemeContext", () => {
  beforeEach(() => {
    getThemesMock.mockResolvedValue({ themes: [], site_default_id: "sambee-light" });
    document.head.innerHTML = '<meta name="theme-color" content="#F4C430" />';
    useCurrentUserSettingMock.mockImplementation(() => ({
      confirmedValue: undefined,
      pending: false,
      error: null,
      commit: vi.fn(),
      clearError: vi.fn(),
    }));
  });

  it("uses the built-in default while appearance settings are unavailable", () => {
    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });

    expect(result.current.currentTheme.id).toBe("sambee-light");
    expect(result.current.availableThemes.map((theme) => theme.id)).toEqual(["sambee-light", "sambee-dark"]);
  });

  it("uses the default theme color for PWA and document metadata", () => {
    const documentHtml = readFileSync("index.html", "utf8");
    const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as { theme_color: string };

    expect(documentHtml).toContain('<meta name="theme-color" content="#F4C430" />');
    expect(manifest.theme_color).toBe("#F4C430");
  });

  it("projects the confirmed selection and stored themes", async () => {
    const customTheme = {
      id: "custom",
      name: "Custom",
      mode: "dark" as const,
      primary: { main: "#123456" },
      secondary: { main: "#abcdef" },
    };
    getThemesMock.mockResolvedValue({
      themes: [{ id: "custom", scope: "user", version: 1, definition: customTheme }],
      site_default_id: "sambee-light",
    });
    useCurrentUserSettingMock.mockImplementation(() => ({
      confirmedValue: "custom",
      pending: false,
      error: null,
      commit: vi.fn(),
      clearError: vi.fn(),
    }));

    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.currentTheme).toMatchObject(customTheme));
    expect(result.current.muiTheme.palette.mode).toBe("dark");
    expect(result.current.availableThemes).toContainEqual(customTheme);
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#123456");
  });

  it("falls back safely when a confirmed theme ID is absent from the registry", () => {
    useCurrentUserSettingMock.mockImplementation((field: string) => ({
      confirmedValue: field === "appearance.theme_id" ? "missing" : [],
      pending: false,
      error: null,
      commit: vi.fn(),
      clearError: vi.fn(),
    }));

    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });

    expect(result.current.currentTheme.id).toBe("sambee-light");
  });

  it("refreshes the site default on focus and after a local write", async () => {
    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });
    await waitFor(() => expect(getThemesMock).toHaveBeenCalledTimes(1));
    getThemesMock.mockResolvedValue({ themes: [], site_default_id: "sambee-dark" });

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.currentTheme.id).toBe("sambee-dark"));

    getThemesMock.mockResolvedValue({ themes: [], site_default_id: "sambee-light" });
    await act(async () => result.current.refreshThemes());
    expect(result.current.currentTheme.id).toBe("sambee-light");
  });

  it("applies a saved selected theme when another tab regains focus", async () => {
    const customTheme = {
      id: "custom",
      name: "Custom",
      mode: "light" as const,
      primary: { main: "#123456" },
      secondary: { main: "#abcdef" },
    };
    useCurrentUserSettingMock.mockImplementation(() => ({ confirmedValue: "custom" }));
    getThemesMock.mockResolvedValue({
      themes: [{ id: "custom", scope: "user", version: 1, definition: customTheme }],
      site_default_id: "sambee-light",
    });
    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.currentTheme.primary.main).toBe("#123456"));

    getThemesMock.mockResolvedValue({
      themes: [{ id: "custom", scope: "user", version: 2, definition: { ...customTheme, primary: { main: "#654321" } } }],
      site_default_id: "sambee-light",
    });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.currentTheme.primary.main).toBe("#654321"));
    expect(result.current.muiTheme.palette.primary.main).toBe("#654321");
  });
});
