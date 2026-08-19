import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUserSettings } from "../../../types";

const { loadCurrentUserSettingsMock } = vi.hoisted(() => ({
  loadCurrentUserSettingsMock: vi.fn(),
}));

vi.mock("../../../services/userSettingsSync", () => ({
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: vi.fn(),
  USER_SETTINGS_CHANGED_EVENT: "sambee:user-settings-changed",
}));

import { isQuickBarKeyboardEvidenceEvent, useQuickBarKeyboardHints, useTextEditorMaxFileSizeBytesPreference } from "../preferences";

const initialSettings: CurrentUserSettings = {
  appearance: { theme_id: "sambee-light", custom_themes: [] },
  localization: { language: "browser", regional_locale: "browser" },
  browser: {
    quick_nav_include_dot_directories: false,
    quick_bar_shortcut_hint_visibility: "auto",
    file_browser_view_mode: "list",
    pane_mode: "single",
    selected_connection_id: null,
    viewer_associations: {},
  },
  text_editor: { max_file_size_bytes: 52428800 },
};

describe("File Browser preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    loadCurrentUserSettingsMock.mockResolvedValue(initialSettings);
  });

  it("applies text editor settings refreshed from another app instance", async () => {
    const { result } = renderHook(() => useTextEditorMaxFileSizeBytesPreference());

    await waitFor(() => {
      expect(result.current[0]).toBe(52428800);
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sambee:user-settings-changed", {
          detail: {
            ...initialSettings,
            text_editor: { max_file_size_bytes: 104857600 },
          },
        })
      );
    });

    expect(result.current[0]).toBe(104857600);
    expect(localStorage.getItem("text-editor-max-file-size-bytes")).toBe("104857600");
  });

  it("shows Quick Bar hints according to compact layout, saved evidence, and visibility mode", () => {
    const { result, rerender } = renderHook(({ visibility, compact }) => useQuickBarKeyboardHints(visibility, compact), {
      initialProps: { visibility: "auto" as const, compact: true },
    });

    expect(result.current).toBe(false);

    rerender({ visibility: "always", compact: true });
    expect(result.current).toBe(true);

    rerender({ visibility: "never", compact: false });
    expect(result.current).toBe(false);

    rerender({ visibility: "auto", compact: false });
    expect(result.current).toBe(true);

    sessionStorage.setItem("quick-bar-keyboard-evidence", "true");
    const restored = renderHook(() => useQuickBarKeyboardHints("auto", true));
    expect(restored.result.current).toBe(true);
  });

  it("records only trusted non-composing non-modifier keyboard events as evidence", () => {
    expect(isQuickBarKeyboardEvidenceEvent({ isTrusted: true, isComposing: false, key: "k" })).toBe(true);
    expect(isQuickBarKeyboardEvidenceEvent({ isTrusted: false, isComposing: false, key: "k" })).toBe(false);
    expect(isQuickBarKeyboardEvidenceEvent({ isTrusted: true, isComposing: true, key: "k" })).toBe(false);
    expect(isQuickBarKeyboardEvidenceEvent({ isTrusted: true, isComposing: false, key: "Control" })).toBe(false);
  });

  it("cleans up the compact auto-mode keyboard listener", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useQuickBarKeyboardHints("auto", true));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });
});
