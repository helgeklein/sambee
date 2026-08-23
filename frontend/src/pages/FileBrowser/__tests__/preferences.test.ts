import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUserSettings } from "../../../types";

const { loadCurrentUserSettingsMock, patchCurrentUserSettingsMock } = vi.hoisted(() => ({
  loadCurrentUserSettingsMock: vi.fn(),
  patchCurrentUserSettingsMock: vi.fn(),
}));

vi.mock("../../../services/userSettingsSync", () => ({
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: patchCurrentUserSettingsMock,
  USER_SETTINGS_CHANGED_EVENT: "sambee:user-settings-changed",
}));

import { authSession } from "../../../services/authSession";
import {
  isQuickBarKeyboardEvidenceEvent,
  useQuickBarKeyboardHints,
  useTextEditorMaxFileSizeBytesPreference,
  useTextEditorWordWrapPreference,
} from "../preferences";

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
  text_editor: { max_file_size_bytes: 52428800, word_wrap_enabled: null },
};

describe("File Browser preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    authSession.clear();
    loadCurrentUserSettingsMock.mockResolvedValue(initialSettings);
    patchCurrentUserSettingsMock.mockResolvedValue(initialSettings);
  });

  afterEach(() => {
    vi.useRealTimers();
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
            text_editor: { max_file_size_bytes: 104857600, word_wrap_enabled: null },
          },
        })
      );
    });

    expect(result.current[0]).toBe(104857600);
    expect(localStorage.getItem("text-editor-max-file-size-bytes")).toBe("104857600");
  });

  it("keeps the established text and Markdown defaults until a word-wrap override is saved", async () => {
    const textPreference = renderHook(() => useTextEditorWordWrapPreference(false));
    const markdownPreference = renderHook(() => useTextEditorWordWrapPreference(true));

    await waitFor(() => {
      expect(textPreference.result.current[0]).toBe(false);
      expect(markdownPreference.result.current[0]).toBe(true);
    });

    act(() => {
      markdownPreference.result.current[1](false);
    });

    expect(textPreference.result.current[0]).toBe(false);
    expect(markdownPreference.result.current[0]).toBe(false);
  });

  it("applies word-wrap changes immediately and coalesces rapid persistence updates", async () => {
    vi.useFakeTimers();
    patchCurrentUserSettingsMock.mockResolvedValue({
      ...initialSettings,
      text_editor: { max_file_size_bytes: 52428800, word_wrap_enabled: false },
    });
    const { result } = renderHook(() => useTextEditorWordWrapPreference(false));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current[1](true);
      result.current[1](false);
    });

    expect(result.current[0]).toBe(false);
    expect(patchCurrentUserSettingsMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(patchCurrentUserSettingsMock).toHaveBeenCalledTimes(1);
    expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({ text_editor: { word_wrap_enabled: false } });
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
