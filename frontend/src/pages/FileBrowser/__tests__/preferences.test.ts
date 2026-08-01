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

import { useTextEditorMaxFileSizeBytesPreference } from "../preferences";

const initialSettings: CurrentUserSettings = {
  appearance: { theme_id: "sambee-light", custom_themes: [] },
  localization: { language: "browser", regional_locale: "browser" },
  browser: {
    quick_nav_include_dot_directories: false,
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
});
