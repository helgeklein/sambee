import {
  type ContentLocation,
  type ContentProvider,
  type ContentProviderRegistry,
  createStorageBackedContentProviderRegistry,
  type VirtualContentProvider,
} from "../../pages/FileBrowser/contentProviders";
import { extractDriveId, isLocalDrive } from "../../services/backendRouter";
import { CompanionLocalBackend, SambeeSmbBackend } from "../../services/storageBackends";
import type {
  ResolvedStorageTarget,
  StorageBackend,
  StorageBackendRegistry,
  StorageDirectoryReference,
  StorageItemReference,
} from "../../services/storageContracts";
import type { Connection } from "../../types";

function isVirtualProvider(provider: ContentProvider): provider is VirtualContentProvider {
  return "sourceExtensions" in provider && Array.isArray(provider.sourceExtensions);
}

function createResolvedTarget(connectionId: string, connections: readonly Connection[]): ResolvedStorageTarget {
  if (isLocalDrive(connectionId)) {
    const driveId = extractDriveId(connectionId);
    return {
      target: { kind: "local", driveId },
      connection: null,
      capabilitySnapshot: {
        capabilityRevision: 1,
        connections,
        companion: {
          status: "paired",
          revision: 1,
          drives: [{ driveId, name: driveId, path: driveId }],
          error: null,
        },
      },
    };
  }

  return {
    target: { kind: "smb", connectionId },
    connection: connections.find((connection) => connection.id === connectionId) ?? ({ access_mode: "read_write" } as Connection),
    capabilitySnapshot: {
      capabilityRevision: 1,
      connections,
      companion: { status: "unavailable", revision: 1, drives: [], error: null },
    },
  };
}

/** Creates a storage-routed registry while keeping backend calls controllable through API mocks. */
export function createStorageBackedTestContentProviderRegistry(connections: readonly Connection[] = []): ContentProviderRegistry {
  const smbBackend = new SambeeSmbBackend();
  const localBackend = new CompanionLocalBackend();
  const resolve = (reference: StorageDirectoryReference | StorageItemReference) => {
    const resolvedTarget = createResolvedTarget(reference.connectionId, connections);
    return { target: resolvedTarget.target, path: reference.path, resolvedTarget };
  };
  const getBackend = (target: ResolvedStorageTarget["target"]): StorageBackend => (target.kind === "local" ? localBackend : smbBackend);
  const registry: StorageBackendRegistry = {
    resolveDirectory: (reference) => resolve(reference),
    resolveItem: (reference) => resolve(reference),
    getBackend,
    getCapabilities: (target) => getBackend(target.target).getCapabilities(target),
  };

  return createStorageBackedContentProviderRegistry(registry);
}

/** Builds a minimal registry for tests that need complete control of provider behavior. */
export function createFakeContentProviderRegistry(providerEntries: Iterable<ContentProvider>): ContentProviderRegistry {
  const providers = new Map(Array.from(providerEntries, (provider) => [provider.id, provider]));
  const get = (location: ContentLocation): ContentProvider => {
    const provider = providers.get(location.kind === "physical" ? "physical" : location.providerId);
    if (!provider)
      throw new Error(`No test content provider registered for ${location.kind === "physical" ? "physical" : location.providerId}`);
    return provider;
  };

  return {
    get,
    getCapabilities: (location) => get(location).getCapabilities(location),
    getVirtualProviderIdForFilename: (filename) => {
      const normalizedFilename = filename.toLowerCase();
      for (const provider of providers.values()) {
        if (isVirtualProvider(provider) && provider.sourceExtensions.some((extension) => normalizedFilename.endsWith(extension))) {
          return provider.id;
        }
      }
      return null;
    },
  };
}
