import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCurrentUserSettingMock } = vi.hoisted(() => ({ useCurrentUserSettingMock: vi.fn() }));

vi.mock("../../services/userSettingsStore", () => ({
  useCurrentUserSetting: useCurrentUserSettingMock,
}));

import { SambeeThemeProvider, useSambeeTheme } from "../ThemeContext";

function createWrapper() {
  return ({ children }: { children: ReactNode }) => <SambeeThemeProvider>{children}</SambeeThemeProvider>;
}

describe("ThemeContext", () => {
  beforeEach(() => {
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

  it("projects the confirmed selected and custom themes", () => {
    const customTheme = {
      id: "custom",
      name: "Custom",
      mode: "dark" as const,
      primary: { main: "#123456" },
      secondary: { main: "#abcdef" },
    };
    useCurrentUserSettingMock.mockImplementation((field: string) => ({
      confirmedValue: field === "appearance.theme_id" ? "custom" : [customTheme],
      pending: false,
      error: null,
      commit: vi.fn(),
      clearError: vi.fn(),
    }));

    const { result } = renderHook(() => useSambeeTheme(), { wrapper: createWrapper() });

    expect(result.current.currentTheme).toMatchObject(customTheme);
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
});
