import { type ContentProviderRegistry, createStorageBackedContentProviderRegistry } from "../pages/FileBrowser/contentProviders";
import type { Connection } from "../types";
import { type BrowserConnectionCatalogService, browserConnectionCatalogService } from "./browserConnectionCatalogService";
import { type BrowserHistoryService, browserHistoryService } from "./browserHistoryService";
import { type BrowserLinkTargetService, browserLinkTargetService } from "./browserLinkTargetService";
import { type CompanionSession, companionSession } from "./companionSession";
import { StorageArchiveOperationCoordinator } from "./storageArchiveOperations";
import { CompanionLocalBackend, SambeeSmbBackend } from "./storageBackends";
import type { CompanionSessionSnapshot, StorageBackendRegistry, StorageCapabilitySnapshot } from "./storageContracts";
import { BrowserStorageBackendRegistry } from "./storageRegistry";

type Listener = () => void;

export interface BrowserContentServices {
  providers: ContentProviderRegistry;
  registry: StorageBackendRegistry;
  archiveOperations: StorageArchiveOperationCoordinator;
  history: BrowserHistoryService;
  linkTargets: BrowserLinkTargetService;
  connections: BrowserConnectionCatalogService;
  getSnapshot(): StorageCapabilitySnapshot;
  subscribe(listener: Listener): () => void;
  updateConnections(connections: readonly Connection[]): void;
  updateCompanionSnapshot(snapshot: CompanionSessionSnapshot): void;
  dispose(): void;
}

export function createBrowserContentServices(
  initialConnections: readonly Connection[],
  session: CompanionSession = companionSession
): BrowserContentServices {
  let connections = initialConnections;
  let companion = session.getSnapshot();
  let revision = 0;
  let snapshot: StorageCapabilitySnapshot;
  const listeners = new Set<Listener>();
  const publish = () => {
    revision += 1;
    snapshot = { capabilityRevision: revision, connections, companion };
    registry.updateSnapshot(snapshot);
    for (const listener of listeners) listener();
  };
  snapshot = { capabilityRevision: revision, connections, companion };
  const registry = new BrowserStorageBackendRegistry(snapshot, { smb: new SambeeSmbBackend(), local: new CompanionLocalBackend() });
  const providers = createStorageBackedContentProviderRegistry(registry);
  const archiveOperations = new StorageArchiveOperationCoordinator(registry);
  const unsubscribeSession = session.subscribe(() => {
    companion = session.getSnapshot();
    publish();
  });
  return {
    providers,
    registry,
    archiveOperations,
    history: browserHistoryService,
    linkTargets: browserLinkTargetService,
    connections: browserConnectionCatalogService,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateConnections(nextConnections) {
      connections = nextConnections;
      publish();
    },
    updateCompanionSnapshot(nextSnapshot) {
      companion = nextSnapshot;
      publish();
    },
    dispose() {
      unsubscribeSession();
      listeners.clear();
    },
  };
}
