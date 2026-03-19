import type { CurrentUserSettings, CurrentUserSettingsUpdate } from "../types";

export const USER_SETTINGS_CHANGED_EVENT = "sambee:user-settings-changed";

let cachedSettings: CurrentUserSettings | null = null;
let pendingLoad: Promise<CurrentUserSettings | null> | null = null;

function hasAccessToken(): boolean {
  return Boolean(localStorage.getItem("access_token"));
}

function publish(settings: CurrentUserSettings): void {
  window.dispatchEvent(new CustomEvent<CurrentUserSettings>(USER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}

async function getApiService() {
  const module = await import("./api");
  return module.default;
}

export function clearCurrentUserSettingsCache(): void {
  cachedSettings = null;
  pendingLoad = null;
}

export async function loadCurrentUserSettings(forceRefresh: boolean = false): Promise<CurrentUserSettings | null> {
  if (!hasAccessToken()) {
    clearCurrentUserSettingsCache();
    return null;
  }

  if (!forceRefresh && cachedSettings) {
    return cachedSettings;
  }

  if (!forceRefresh && pendingLoad) {
    return pendingLoad;
  }

  pendingLoad = getApiService()
    .then((api) => {
      if (typeof api.getCurrentUserSettings !== "function") {
        return null;
      }

      const request = api.getCurrentUserSettings();
      if (!request || typeof request.then !== "function") {
        return null;
      }

      return request;
    })
    .then((settings) => {
      if (!settings) {
        return null;
      }

      cachedSettings = settings;
      publish(settings);
      return settings;
    })
    .catch(() => null)
    .finally(() => {
      pendingLoad = null;
    });

  return pendingLoad;
}

export async function patchCurrentUserSettings(payload: CurrentUserSettingsUpdate): Promise<CurrentUserSettings | null> {
  if (!hasAccessToken()) {
    return null;
  }

  try {
    const api = await getApiService();
    if (typeof api.updateCurrentUserSettings !== "function") {
      return null;
    }

    const request = api.updateCurrentUserSettings(payload);
    if (!request || typeof request.then !== "function") {
      return null;
    }

    const settings = await request;
    cachedSettings = settings;
    publish(settings);
    return settings;
  } catch {
    return null;
  }
}
