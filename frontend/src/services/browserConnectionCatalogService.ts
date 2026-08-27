import type { Connection } from "../types";
import api from "./api";
import companionService, { buildCompanionWsUrl, type DriveInfo, hasStoredSecret } from "./companion";

export interface BrowserConnectionCatalogService {
  getConnections(): Promise<Connection[]>;
  getStoredCompanionDrives(): Promise<DriveInfo[]>;
  getCompanionWebSocketUrl(): Promise<string | null>;
}

export const browserConnectionCatalogService: BrowserConnectionCatalogService = {
  getConnections: () => api.getConnections(),
  getStoredCompanionDrives: () => (hasStoredSecret() ? companionService.getDrives() : Promise.resolve([])),
  getCompanionWebSocketUrl: () => buildCompanionWsUrl(),
};
