import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserSettingsMock, updateCurrentUserSettingsMock } = vi.hoisted(() => ({
  getCurrentUserSettingsMock: vi.fn(),
  updateCurrentUserSettingsMock: vi.fn(),
}));

const { getUserSettingsChannel, getUserSettingsMessageHandler } = vi.hoisted(() => {
  let userSettingsMessageHandler: ((event: MessageEvent<{ type?: unknown }>) => void) | null = null;
  let userSettingsChannel: MockBroadcastChannel | null = null;

  class MockBroadcastChannel {
    addEventListener = vi.fn((eventName: string, listener: (event: MessageEvent<{ type?: unknown }>) => void) => {
      if (eventName === "message") userSettingsMessageHandler = listener;
    });
    postMessage = vi.fn();

    constructor(name: string) {
      if (name === "sambee-user-settings") userSettingsChannel = this;
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

import { authSession } from "../authSession";
import { refreshCurrentUserSettings, userSettingsStore } from "../userSettingsStore";

const settings = {
  appearance: { theme_id: "sambee-light", custom_themes: [] },
  localization: { language: "browser" as const, regional_locale: "browser" as const },
  browser: {
    quick_nav_include_dot_directories: false,
    quick_bar_shortcut_hint_visibility: "auto" as const,
    file_browser_view_mode: "list" as const,
    pane_mode: "single" as const,
    selected_connection_id: null,
    viewer_associations: {},
  },
  text_editor: { max_file_size_bytes: 52_428_800, word_wrap_enabled: null },
};

async function authenticateAndLoad() {
  getCurrentUserSettingsMock.mockResolvedValue(settings);
  authSession.setAuthenticated({ access_token: "token", token_type: "bearer", user_id: "user-1" }, false);
  await refreshCurrentUserSettings();
}

describe("userSettingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authSession.clear();
  });

  it("commits a canonical field response and broadcasts an invalidation", async () => {
    await authenticateAndLoad();
    const result = { field: "appearance.theme_id", value: "sambee-dark" } as const;
    updateCurrentUserSettingsMock.mockResolvedValue(result);

    await userSettingsStore.getValue("appearance.theme_id").commit("sambee-dark");

    expect(updateCurrentUserSettingsMock).toHaveBeenCalledWith(result);
    expect(userSettingsStore.getValue("appearance.theme_id").confirmedValue).toBe("sambee-dark");
    expect(getUserSettingsChannel()?.postMessage).toHaveBeenCalledWith({ type: "invalidate" });
  });

  it("rejects a second write to the same field while the first is in flight", async () => {
    await authenticateAndLoad();
    let resolveUpdate: ((value: { field: "appearance.theme_id"; value: string }) => void) | undefined;
    updateCurrentUserSettingsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    const firstCommit = userSettingsStore.getValue("appearance.theme_id").commit("sambee-dark");
    await vi.waitFor(() => expect(updateCurrentUserSettingsMock).toHaveBeenCalledTimes(1));
    await expect(userSettingsStore.getValue("appearance.theme_id").commit("sambee-light")).rejects.toThrow(
      "A write for this setting is already in progress."
    );
    resolveUpdate?.({ field: "appearance.theme_id", value: "sambee-dark" });
    await firstCommit;
  });

  it("discards an outstanding write after the authenticated identity changes", async () => {
    await authenticateAndLoad();
    let resolveUpdate: ((value: { field: "appearance.theme_id"; value: string }) => void) | undefined;
    updateCurrentUserSettingsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    const commit = userSettingsStore.getValue("appearance.theme_id").commit("sambee-dark");
    await vi.waitFor(() => expect(updateCurrentUserSettingsMock).toHaveBeenCalledTimes(1));
    authSession.clear();
    resolveUpdate?.({ field: "appearance.theme_id", value: "sambee-dark" });
    await commit;

    expect(userSettingsStore.getValue("appearance.theme_id")).toMatchObject({ confirmedValue: undefined, pending: false, error: null });
  });

  it("refreshes in response to an invalidation broadcast", async () => {
    await authenticateAndLoad();
    getCurrentUserSettingsMock.mockClear();
    getCurrentUserSettingsMock.mockResolvedValue({ ...settings, appearance: { ...settings.appearance, theme_id: "sambee-dark" } });

    getUserSettingsMessageHandler()?.(new MessageEvent("message", { data: { type: "invalidate" } }));

    await vi.waitFor(() => expect(getCurrentUserSettingsMock).toHaveBeenCalledTimes(1));
    expect(userSettingsStore.getValue("appearance.theme_id").confirmedValue).toBe("sambee-dark");
  });
});
