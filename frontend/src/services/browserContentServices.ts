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

function haveSameConnections(left: readonly Connection[], right: readonly Connection[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (connection, index) =>
        connection.id === right[index]?.id &&
        connection.name === right[index]?.name &&
        connection.slug === right[index]?.slug &&
        connection.type === right[index]?.type &&
        connection.host === right[index]?.host &&
        connection.port === right[index]?.port &&
        connection.share_name === right[index]?.share_name &&
        connection.username === right[index]?.username &&
        connection.path_prefix === right[index]?.path_prefix &&
        connection.scope === right[index]?.scope &&
        connection.access_mode === right[index]?.access_mode &&
        connection.can_manage === right[index]?.can_manage &&
        connection.created_at === right[index]?.created_at &&
        connection.updated_at === right[index]?.updated_at
    )
  );
}

function haveSameCompanionSnapshot(left: CompanionSessionSnapshot, right: CompanionSessionSnapshot): boolean {
  return (
    left.status === right.status &&
    left.revision === right.revision &&
    left.error?.code === right.error?.code &&
    left.error?.detail === right.error?.detail &&
    left.drives.length === right.drives.length &&
    left.drives.every(
      (drive, index) =>
        drive.driveId === right.drives[index]?.driveId &&
        drive.name === right.drives[index]?.name &&
        drive.path === right.drives[index]?.path
    )
  );
}

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
    const nextCompanion = session.getSnapshot();
    if (haveSameCompanionSnapshot(companion, nextCompanion)) {
      return;
    }
    companion = nextCompanion;
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
      if (haveSameConnections(connections, nextConnections)) {
        return;
      }
      connections = nextConnections;
      publish();
    },
    updateCompanionSnapshot(nextSnapshot) {
      if (haveSameCompanionSnapshot(companion, nextSnapshot)) {
        return;
      }
      companion = nextSnapshot;
      publish();
    },
    dispose() {
      unsubscribeSession();
      listeners.clear();
    },
  };
}
