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
