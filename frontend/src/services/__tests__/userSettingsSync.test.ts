import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserSettingsMock, updateCurrentUserSettingsMock } = vi.hoisted(() => ({
  getCurrentUserSettingsMock: vi.fn(),
  updateCurrentUserSettingsMock: vi.fn(),
}));

const { isAuthRequiredMock } = vi.hoisted(() => ({
  isAuthRequiredMock: vi.fn(),
}));

vi.mock("../api", () => ({
  default: {
    getCurrentUserSettings: getCurrentUserSettingsMock,
    updateCurrentUserSettings: updateCurrentUserSettingsMock,
  },
}));

vi.mock("../authConfig", () => ({
  isAuthRequired: isAuthRequiredMock,
}));

import { clearCurrentUserSettingsCache, loadCurrentUserSettings, patchCurrentUserSettings } from "../userSettingsSync";

describe("userSettingsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserSettingsCache();
    localStorage.setItem("access_token", "fake-token");
    isAuthRequiredMock.mockResolvedValue(true);
  });

  it("preserves viewer associations when the settings update response is stale", async () => {
    const initialSettings = {
      appearance: { theme_id: "sambee-light", custom_themes: [] },
      localization: {
        language: "browser" as const,
        regional_locale: "browser",
      },
      browser: {
        quick_nav_include_dot_directories: false,
        file_browser_view_mode: "list" as const,
        pane_mode: "single" as const,
        selected_connection_id: null,
        viewer_associations: {},
      },
    };

    getCurrentUserSettingsMock.mockResolvedValue(initialSettings);
    updateCurrentUserSettingsMock.mockResolvedValue(initialSettings);

    await loadCurrentUserSettings();

    const updatedSettings = await patchCurrentUserSettings({
      browser: {
        viewer_associations: {
          "mime:text/plain": "pdf",
          "ext:.md": "pdf",
        },
      },
    });

    expect(updatedSettings?.browser.viewer_associations).toEqual({
      "mime:text/plain": "pdf",
      "ext:.md": "pdf",
    });

    await expect(loadCurrentUserSettings()).resolves.toMatchObject({
      browser: {
        viewer_associations: {
          "mime:text/plain": "pdf",
          "ext:.md": "pdf",
        },
      },
    });
  });

  it("still updates user settings when auth is disabled and no access token exists", async () => {
    localStorage.removeItem("access_token");
    isAuthRequiredMock.mockResolvedValue(false);

    const initialSettings = {
      appearance: { theme_id: "sambee-light", custom_themes: [] },
      localization: {
        language: "browser" as const,
        regional_locale: "browser",
      },
      browser: {
        quick_nav_include_dot_directories: false,
        file_browser_view_mode: "list" as const,
        pane_mode: "single" as const,
        selected_connection_id: null,
        viewer_associations: {},
      },
    };

    getCurrentUserSettingsMock.mockResolvedValue(initialSettings);
    updateCurrentUserSettingsMock.mockResolvedValue({
      ...initialSettings,
      browser: {
        ...initialSettings.browser,
        viewer_associations: {
          "ext:.md": "pdf",
        },
      },
    });

    await expect(loadCurrentUserSettings()).resolves.toEqual(initialSettings);

    await patchCurrentUserSettings({
      browser: {
        viewer_associations: {
          "ext:.md": "pdf",
        },
      },
    });

    expect(updateCurrentUserSettingsMock).toHaveBeenCalledWith({
      browser: {
        viewer_associations: {
          "ext:.md": "pdf",
        },
      },
    });
  });
});
