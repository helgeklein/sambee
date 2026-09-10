import { useEffect, useSyncExternalStore } from "react";
import type { CurrentUserSettings, CurrentUserSettingsUpdate } from "../types";
import api from "./api";
import { isAuthRequired } from "./authConfig";
import { authSession } from "./authSession";

export type CurrentUserSettingsField = CurrentUserSettingsUpdate["field"];

type ValueForField<Field extends CurrentUserSettingsField> = Extract<CurrentUserSettingsUpdate, { field: Field }>["value"];

export interface CurrentUserSetting<Field extends CurrentUserSettingsField> {
  confirmedValue: ValueForField<Field> | undefined;
  pending: boolean;
  error: string | null;
  commit: (value: ValueForField<Field>) => Promise<void>;
  clearError: () => void;
}

const CHANNEL_NAME = "sambee-user-settings";
const INVALIDATE_MESSAGE = "invalidate";

function getFieldValue<Field extends CurrentUserSettingsField>(
  settings: CurrentUserSettings | null,
  field: Field
): ValueForField<Field> | undefined {
  if (!settings) {
    return undefined;
  }
  switch (field) {
    case "appearance.theme_id":
      return settings.appearance.theme_id as ValueForField<Field>;
    case "appearance.custom_themes":
      return settings.appearance.custom_themes as ValueForField<Field>;
    case "localization.language":
      return settings.localization.language as ValueForField<Field>;
    case "localization.regional_locale":
      return settings.localization.regional_locale as ValueForField<Field>;
    case "browser.quick_nav_include_dot_directories":
      return settings.browser.quick_nav_include_dot_directories as ValueForField<Field>;
    case "browser.quick_bar_shortcut_hint_visibility":
      return settings.browser.quick_bar_shortcut_hint_visibility as ValueForField<Field>;
    case "browser.file_browser_view_mode":
      return settings.browser.file_browser_view_mode as ValueForField<Field>;
    case "browser.pane_mode":
      return settings.browser.pane_mode as ValueForField<Field>;
    case "browser.selected_connection_id":
      return settings.browser.selected_connection_id as ValueForField<Field>;
    case "browser.viewer_associations":
      return settings.browser.viewer_associations as ValueForField<Field>;
    case "text_editor.max_file_size_bytes":
      return settings.text_editor.max_file_size_bytes as ValueForField<Field>;
    case "text_editor.word_wrap_enabled":
      return settings.text_editor.word_wrap_enabled as ValueForField<Field>;
  }
}

function setFieldValue(settings: CurrentUserSettings, update: CurrentUserSettingsUpdate): CurrentUserSettings {
  switch (update.field) {
    case "appearance.theme_id":
      return { ...settings, appearance: { ...settings.appearance, theme_id: update.value } };
    case "appearance.custom_themes":
      return { ...settings, appearance: { ...settings.appearance, custom_themes: update.value } };
    case "localization.language":
      return { ...settings, localization: { ...settings.localization, language: update.value } };
    case "localization.regional_locale":
      return { ...settings, localization: { ...settings.localization, regional_locale: update.value } };
    case "browser.quick_nav_include_dot_directories":
      return { ...settings, browser: { ...settings.browser, quick_nav_include_dot_directories: update.value } };
    case "browser.quick_bar_shortcut_hint_visibility":
      return { ...settings, browser: { ...settings.browser, quick_bar_shortcut_hint_visibility: update.value } };
    case "browser.file_browser_view_mode":
      return { ...settings, browser: { ...settings.browser, file_browser_view_mode: update.value } };
    case "browser.pane_mode":
      return { ...settings, browser: { ...settings.browser, pane_mode: update.value } };
    case "browser.selected_connection_id":
      return { ...settings, browser: { ...settings.browser, selected_connection_id: update.value } };
    case "browser.viewer_associations":
      return { ...settings, browser: { ...settings.browser, viewer_associations: update.value } };
    case "text_editor.max_file_size_bytes":
      return { ...settings, text_editor: { ...settings.text_editor, max_file_size_bytes: update.value } };
    case "text_editor.word_wrap_enabled":
      return { ...settings, text_editor: { ...settings.text_editor, word_wrap_enabled: update.value } };
  }
}

class UserSettingsStore {
  private snapshot: CurrentUserSettings | null = null;
  private snapshotVersion = 0;
  private refreshPromise: Promise<void> | null = null;
  private queuedRefresh = false;
  private pendingFields = new Set<CurrentUserSettingsField>();
  private errors = new Map<CurrentUserSettingsField, string>();
  private requestTokens = new Map<CurrentUserSettingsField, number>();
  private listeners = new Set<() => void>();
  private readonly channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);

  constructor() {
    this.channel?.addEventListener("message", (event: MessageEvent<{ type?: unknown }>) => {
      if (event.data?.type === INVALIDATE_MESSAGE) {
        void this.refresh();
      }
    });
    authSession.subscribeToIdentity(() => this.clearForIdentityChange());
    window.addEventListener("focus", () => void this.refresh());
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.refresh();
      }
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.snapshotVersion;

  getValue<Field extends CurrentUserSettingsField>(field: Field): CurrentUserSetting<Field> {
    return {
      confirmedValue: getFieldValue(this.snapshot, field),
      pending: this.pendingFields.has(field),
      error: this.errors.get(field) ?? null,
      commit: async (value) => this.commit({ field, value } as Extract<CurrentUserSettingsUpdate, { field: Field }>),
      clearError: () => this.clearError(field),
    };
  }

  async refresh(force = false): Promise<void> {
    if (this.refreshPromise) {
      if (force) this.queuedRefresh = true;
      return this.refreshPromise;
    }
    const identity = authSession.getIdentity();
    const requestVersion = this.snapshotVersion;
    this.refreshPromise = this.canAccessCurrentUserSettings()
      .then((canAccess) => (canAccess ? api.getCurrentUserSettings() : null))
      .then((settings) => {
        if (!settings) {
          if (identity.epoch !== authSession.getIdentity().epoch) this.queuedRefresh = true;
          return;
        }
        if (identity.epoch !== authSession.getIdentity().epoch || requestVersion !== this.snapshotVersion) {
          this.queuedRefresh = true;
          return;
        }
        this.snapshot = settings;
        this.snapshotVersion += 1;
        this.notify();
      })
      .finally(() => {
        this.refreshPromise = null;
        if (this.queuedRefresh) {
          this.queuedRefresh = false;
          void this.refresh();
        }
      });
    return this.refreshPromise;
  }

  async commit(update: CurrentUserSettingsUpdate): Promise<void> {
    if (this.pendingFields.has(update.field)) {
      throw new Error("A write for this setting is already in progress.");
    }
    if (!(await this.canAccessCurrentUserSettings())) {
      throw new Error("Current-user settings require an authenticated user.");
    }
    if (this.pendingFields.has(update.field)) {
      throw new Error("A write for this setting is already in progress.");
    }
    const identity = authSession.getIdentity();
    const requestVersion = ++this.snapshotVersion;
    const token = (this.requestTokens.get(update.field) ?? 0) + 1;
    this.requestTokens.set(update.field, token);
    this.pendingFields.add(update.field);
    this.errors.delete(update.field);
    this.notify();

    try {
      const result = await api.updateCurrentUserSettings(update);
      if (identity.epoch !== authSession.getIdentity().epoch || this.requestTokens.get(update.field) !== token) {
        return;
      }
      if (result.field !== update.field) {
        throw new Error("The server returned a different setting field.");
      }
      if (this.snapshot) {
        this.snapshot = setFieldValue(this.snapshot, result);
      }
      this.pendingFields.delete(update.field);
      this.errors.delete(update.field);
      this.notify();
      this.channel?.postMessage({ type: INVALIDATE_MESSAGE });
    } catch (error) {
      if (identity.epoch !== authSession.getIdentity().epoch || this.requestTokens.get(update.field) !== token) {
        return;
      }
      this.pendingFields.delete(update.field);
      this.errors.set(update.field, error instanceof Error ? error.message : "Unable to save this setting.");
      this.notify();
      if (requestVersion === this.snapshotVersion) {
        void this.refresh(true);
      }
      throw error;
    }
  }

  clearError(field: CurrentUserSettingsField): void {
    if (this.errors.delete(field)) this.notify();
  }

  resetForTests(): void {
    this.snapshot = null;
    this.snapshotVersion += 1;
    this.refreshPromise = null;
    this.queuedRefresh = false;
    this.pendingFields.clear();
    this.errors.clear();
    this.requestTokens.clear();
    this.notify();
  }

  private clearForIdentityChange(): void {
    this.snapshot = null;
    this.pendingFields.clear();
    this.errors.clear();
    this.requestTokens.clear();
    this.snapshotVersion += 1;
    this.queuedRefresh = false;
    this.notify();
    void this.refresh();
  }

  private async canAccessCurrentUserSettings(): Promise<boolean> {
    if (authSession.hasUsableAccessToken()) return true;
    try {
      return !(await isAuthRequired());
    } catch {
      return false;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const userSettingsStore = new UserSettingsStore();

export function getConfirmedCurrentUserSetting<Field extends CurrentUserSettingsField>(field: Field): ValueForField<Field> | undefined {
  return userSettingsStore.getValue(field).confirmedValue;
}

export function commitCurrentUserSetting(update: CurrentUserSettingsUpdate): Promise<void> {
  return userSettingsStore.commit(update);
}

export function resetCurrentUserSettingsStoreForTests(): void {
  userSettingsStore.resetForTests();
}

export function useCurrentUserSetting<Field extends CurrentUserSettingsField>(field: Field): CurrentUserSetting<Field> {
  useSyncExternalStore(userSettingsStore.subscribe, userSettingsStore.getSnapshot, userSettingsStore.getSnapshot);
  useEffect(() => {
    void userSettingsStore.refresh();
  }, []);
  return userSettingsStore.getValue(field);
}

export function refreshCurrentUserSettings(): Promise<void> {
  return userSettingsStore.refresh();
}
