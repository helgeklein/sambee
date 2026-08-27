import type { LocalLinkTargetListing } from "../types";
import api from "./api";

export interface BrowserLinkTargetService {
  listLocalLinkTargets(connectionId: string, path: string, options?: { signal?: AbortSignal }): Promise<LocalLinkTargetListing>;
}

export const browserLinkTargetService: BrowserLinkTargetService = {
  listLocalLinkTargets: (connectionId, path, options) => api.listLocalLinkTargets(connectionId, path, options),
};
