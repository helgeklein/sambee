import type { CurrentUserSettings, CurrentUserSettingsUpdate } from "../types";
import { isAuthRequired } from "./authConfig";

export const USER_SETTINGS_CHANGED_EVENT = "sambee:user-settings-changed";

let cachedSettings: CurrentUserSettings | null = null;
let pendingLoad: Promise<CurrentUserSettings | null> | null = null;

function mergeViewerAssociations(settings: CurrentUserSettings | null, payload: CurrentUserSettingsUpdate): CurrentUserSettings | null {
  if (!settings || !payload.browser || !("viewer_associations" in payload.browser) || !payload.browser.viewer_associations) {
    return settings;
  }

  return {
    ...settings,
    browser: {
      ...settings.browser,
      viewer_associations: {
        ...settings.browser.viewer_associations,
        ...payload.browser.viewer_associations,
      },
    },
  };
}

function hasAccessToken(): boolean {
  return Boolean(localStorage.getItem("access_token"));
}

async function canAccessCurrentUserSettings(): Promise<boolean> {
  if (hasAccessToken()) {
    return true;
  }

  return !(await isAuthRequired());
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
  if (!(await canAccessCurrentUserSettings())) {
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
  if (!(await canAccessCurrentUserSettings())) {
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

    const settings = mergeViewerAssociations(await request, payload);
    cachedSettings = settings;
    if (settings) {
      publish(settings);
    }
    return settings;
  } catch {
    return null;
  }
}
