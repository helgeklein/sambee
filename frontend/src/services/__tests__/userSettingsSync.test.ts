import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserSettingsMock, updateCurrentUserSettingsMock } = vi.hoisted(() => ({
  getCurrentUserSettingsMock: vi.fn(),
  updateCurrentUserSettingsMock: vi.fn(),
}));

const { isAuthRequiredMock } = vi.hoisted(() => ({
  isAuthRequiredMock: vi.fn(),
}));

const { getUserSettingsChannel, getUserSettingsMessageHandler } = vi.hoisted(() => {
  let userSettingsMessageHandler: ((event: MessageEvent<{ type?: unknown }>) => void) | null = null;
  let userSettingsChannel: MockBroadcastChannel | null = null;

  class MockBroadcastChannel {
    addEventListener = vi.fn((eventName: string, listener: (event: MessageEvent<{ type?: unknown }>) => void) => {
      if (eventName === "message") {
        userSettingsMessageHandler = listener;
      }
    });
    postMessage = vi.fn();

    constructor(name: string) {
      if (name === "sambee-user-settings") {
        userSettingsChannel = this;
      }
    }
  }

  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  return {
    getUserSettingsChannel: () => userSettingsChannel,
    getUserSettingsMessageHandler: () => userSettingsMessageHandler,
  };
});

vi.mock("../api", () => ({
  default: {
    getCurrentUserSettings: getCurrentUserSettingsMock,
    updateCurrentUserSettings: updateCurrentUserSettingsMock,
  },
}));

vi.mock("../authConfig", () => ({
  isAuthRequired: isAuthRequiredMock,
}));

import { authSession } from "../authSession";
import { clearCurrentUserSettingsCache, loadCurrentUserSettings, patchCurrentUserSettings } from "../userSettingsSync";

describe("userSettingsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserSettingsCache();
    authSession.setAuthenticated({ access_token: "fake-token", token_type: "bearer" }, false);
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
    authSession.clear();
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
    const userSettingsChannel = getUserSettingsChannel();
    expect(userSettingsChannel).not.toBeNull();
    expect(userSettingsChannel?.postMessage).toHaveBeenCalledWith({ type: "settings-updated" });
  });

  it("refreshes cached settings when another app instance broadcasts an update", async () => {
    const updatedSettings = {
      appearance: { theme_id: "sambee-dark", custom_themes: [] },
      localization: {
        language: "browser" as const,
        regional_locale: "browser",
      },
      browser: {
        quick_nav_include_dot_directories: true,
        file_browser_view_mode: "details" as const,
        pane_mode: "dual" as const,
        selected_connection_id: null,
        viewer_associations: {},
      },
      text_editor: {
        max_file_size_bytes: 104857600,
      },
    };
    getCurrentUserSettingsMock.mockResolvedValue(updatedSettings);

    getUserSettingsMessageHandler()?.(new MessageEvent("message", { data: { type: "settings-updated" } }));

    await vi.waitFor(() => {
      expect(getCurrentUserSettingsMock).toHaveBeenCalledTimes(1);
    });
    await expect(loadCurrentUserSettings()).resolves.toEqual(updatedSettings);
  });

  it("refreshes settings from the backend when an app instance regains focus", async () => {
    const updatedSettings = {
      appearance: { theme_id: "sambee-dark", custom_themes: [] },
      localization: {
        language: "browser" as const,
        regional_locale: "browser",
      },
      browser: {
        quick_nav_include_dot_directories: true,
        file_browser_view_mode: "details" as const,
        pane_mode: "dual" as const,
        selected_connection_id: null,
        viewer_associations: {},
      },
      text_editor: {
        max_file_size_bytes: 104857600,
      },
    };
    getCurrentUserSettingsMock.mockResolvedValue(updatedSettings);

    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => {
      expect(getCurrentUserSettingsMock).toHaveBeenCalledTimes(1);
    });
    await expect(loadCurrentUserSettings()).resolves.toEqual(updatedSettings);
  });

  it("coalesces concurrent forced and non-forced settings loads into a single request", async () => {
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

    let resolveSettings: ((value: typeof initialSettings) => void) | null = null;
    getCurrentUserSettingsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        })
    );

    const forcedLoadPromise = loadCurrentUserSettings(true);
    const regularLoadPromise = loadCurrentUserSettings();

    await vi.waitFor(() => {
      expect(getCurrentUserSettingsMock).toHaveBeenCalledTimes(1);
    });

    resolveSettings?.(initialSettings);

    await expect(forcedLoadPromise).resolves.toEqual(initialSettings);
    await expect(regularLoadPromise).resolves.toEqual(initialSettings);
    expect(getCurrentUserSettingsMock).toHaveBeenCalledTimes(1);
  });
});
