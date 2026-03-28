import { primeCachedAsyncData } from "../../hooks/useCachedAsyncData";
import api from "../../services/api";
import companionService, { type PairStatusResponse } from "../../services/companion";
import { logger } from "../../services/logger";
import type { AdminUser, AdvancedSystemSettings, CompanionDownloadMetadata, Connection } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { LOCAL_DRIVES_PAGE_COPY } from "./localDrivesCopy";
import type { SettingsNavItem } from "./settingsNavigation";

export const SETTINGS_DATA_CACHE_KEYS = {
  connections: "settings-data/connections",
  localDrives: "settings-data/local-drives",
  adminUsers: "settings-data/admin-users",
  adminSystem: "settings-data/admin-system",
} as const;

export interface LocalDrivesSettingsData {
  companionAvailable: boolean;
  currentPairStatus: PairStatusResponse | null;
  downloadMetadata: CompanionDownloadMetadata | null;
  downloadError: string | null;
}

export interface UserManagementSettingsData {
  users: AdminUser[];
  currentUserId: string | null;
}

export async function loadConnectionsSettingsData(): Promise<Connection[]> {
  return api.getConnections();
}

export async function loadUserManagementSettingsData(): Promise<UserManagementSettingsData> {
  const [users, currentUser] = await Promise.all([api.getUsers(), api.getCurrentUser()]);

  return {
    users,
    currentUserId: currentUser.id ?? null,
  };
}

export async function loadAdvancedSettingsData(): Promise<AdvancedSystemSettings> {
  return api.getAdvancedSettings();
}

export async function loadLocalDrivesSettingsData(): Promise<LocalDrivesSettingsData> {
  let companionAvailable = false;
  let currentPairStatus: PairStatusResponse | null = null;
  let downloadMetadata: CompanionDownloadMetadata | null = null;
  let downloadError: string | null = null;

  try {
    const health = await companionService.checkHealth();

    companionAvailable = health !== null;
    if (companionAvailable) {
      currentPairStatus = await companionService.getPairStatus();
    }
  } catch (error) {
    logger.warn("Failed to refresh local drives companion status", { error }, "companion");
  }

  try {
    downloadMetadata = await api.getCompanionDownloads();
  } catch (error) {
    logger.warn("Failed to load companion download metadata", { error }, "companion");
    downloadError = getApiErrorMessage(error, LOCAL_DRIVES_PAGE_COPY.downloadLoadFailed, { includeOriginalMessage: true });
  }

  return {
    companionAvailable,
    currentPairStatus,
    downloadMetadata,
    downloadError,
  };
}

export function prefetchSettingsDataForItem(item: SettingsNavItem) {
  switch (item) {
    case "connections":
      return primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.connections, loadConnectionsSettingsData);
    case "local-drives":
      return primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.localDrives, loadLocalDrivesSettingsData);
    case "admin-users":
      return primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminUsers, loadUserManagementSettingsData);
    case "admin-system":
      return primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminSystem, loadAdvancedSettingsData);
    default:
      return null;
  }
}

export function prefetchSettingsDataForItems(items: SettingsNavItem[]) {
  for (const item of items) {
    const prefetchPromise = prefetchSettingsDataForItem(item);
    if (prefetchPromise) {
      void prefetchPromise.catch(() => undefined);
    }
  }
}
