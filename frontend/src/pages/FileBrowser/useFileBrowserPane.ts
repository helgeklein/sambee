/**
 * useFileBrowserPane
 * ==================
 *
 * Encapsulates **all** per-pane state and logic for a single file-browser
 * panel: directory loading, caching, sorting, focus management, keyboard
 * navigation, file viewer state, CRUD dialogs, and the TanStack Virtual
 * virtualizer.
 *
 * The parent (Browser) component is responsible for:
 *  - Routing / URL synchronisation
 *  - WebSocket connection (delegates to handleDirectoryChanged)
 *  - Global UI (settings dialog, mobile drawer, help overlay)
 *  - Keyboard shortcut registration (reads handlers from this hook)
 *
 * Multiple instances of this hook can coexist for a dual-pane layout.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useDirectorySearchProvider } from "../../components/FileBrowser/search";
import api from "../../services/api";
import { isClientTimeoutError, isLocalAbortError } from "../../services/backendAvailability";
import { isLocalDrive, normalizeLocalDrivePath } from "../../services/backendRouter";
import { logger } from "../../services/logger";
import { publishRecentDirectoriesChanged } from "../../services/recentDirectoriesSync";
import { publishRecentFilesChanged } from "../../services/recentFilesSync";
import { useSambeeTheme } from "../../theme";
import type { FileEntry, RecentFileValidationError } from "../../types";
import { FileType, isApiError } from "../../types";
import { getAllViewerIds, getCompatibleViewerIds, isImageFile } from "../../utils/FileTypeRegistry";
import { compareLocalizedStrings } from "../../utils/localeFormatting";
import { getConnectionById, isConnectionReadOnly } from "./access";
import {
  useFileBrowserViewModePreference,
  useQuickNavIncludeDotDirectoriesPreference,
  writeSelectedConnectionIdPreference,
} from "./preferences";
import type {
  BrowserOpenMode,
  FileBrowserPaneRecoverySnapshot,
  SortField,
  UseFileBrowserPaneConfig,
  UseFileBrowserPaneReturn,
} from "./types";
import { getPreferredViewerId, setPreferredViewerId } from "./viewerPreferences";

// ============================================================================
// Constants
// ============================================================================

/** How long a cached directory listing is considered fresh. */
const DIRECTORY_CACHE_TTL_MS = 30_000;

/**
 * After an explicit forced reload (e.g. delete / rename), WebSocket-triggered
 * reloads within this window are suppressed to avoid double-fetches.
 */
const RELOAD_DEDUP_WINDOW_MS = 2_000;
const DIRECTORY_LOAD_GENERIC_ERROR = "Failed to load directory contents. Please try again.";
const DIRECTORY_LOAD_NETWORK_ERROR = "Failed to load files. Please check your connection settings.";
const DIRECTORY_LOAD_TIMEOUT_ERROR = "Directory listing timed out. The remote share took too long to respond.";
const RECENT_FILE_DEFAULT_ERROR = "The recent file could not be opened.";
const RECENT_FILE_MISSING_ERROR = "The recent file no longer exists.";
const RECENT_FILE_NOT_FILE_ERROR = "The recent target is no longer a regular file.";
const PERMANENT_LOCAL_RECENT_OPEN_FAILURE_CODES = [
  "recent_file_target_missing",
  "recent_file_target_not_file",
  "recent_file_native_launch_failed",
] as const satisfies readonly RecentFileValidationError["code"][];
const STALE_RECENT_FILE_CODES = new Set<RecentFileValidationError["code"]>([
  "recent_file_target_missing",
  "recent_file_target_not_file",
  "recent_file_native_launch_failed",
  "recent_file_invalid_path",
  "recent_file_connection_removed",
  "recent_file_access_denied",
]);

type DirectoryEntryIntent = { kind: "fresh" } | { kind: "restore-history" } | { kind: "parent-return"; childName: string };

// ============================================================================
// Helpers
// ============================================================================

/** Generate a unique viewer session id for logging. */
const createViewerSessionId = (): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart}`;
};

function getRecentFileValidationError(error: unknown): RecentFileValidationError | null {
  if (!isApiError(error)) return null;
  const detail = error.response?.data?.detail;
  if (
    typeof detail === "object" &&
    detail !== null &&
    "code" in detail &&
    "message" in detail &&
    typeof detail.code === "string" &&
    typeof detail.message === "string"
  ) {
    return detail as RecentFileValidationError;
  }
  return null;
}

function getApiErrorCode(error: unknown): string | null {
  if (!isApiError(error)) return null;
  const code = error.response?.data?.code;
  return typeof code === "string" ? code : null;
}

function isPermanentLocalRecentOpenFailure(code: string | null): boolean {
  return code !== null && PERMANENT_LOCAL_RECENT_OPEN_FAILURE_CODES.some((failureCode) => failureCode === code);
}

function recordRecentHistoryEntry({
  connectionId,
  path,
  expectedType,
  record,
  publish,
  itemName,
}: {
  connectionId: string;
  path: string;
  expectedType: FileType;
  record: (connectionId: string, path: string) => Promise<unknown>;
  publish: () => void;
  itemName: "directory" | "file";
}): void {
  if (isLocalDrive(connectionId)) {
    void api
      .getFileInfo(connectionId, path)
      .then((item) => {
        if (item.type !== expectedType) {
          return false;
        }
        return record(connectionId, path).then(() => true);
      })
      .then((recorded) => {
        if (recorded) {
          publish();
        }
      })
      .catch((error: unknown) => logger.warn(`Failed to qualify local recent ${itemName}`, { connectionId, path, error }, "browser"));
    return;
  }

  void Promise.resolve()
    .then(() => record(connectionId, path))
    .then(() => publish())
    .catch((error: unknown) => logger.warn(`Failed to record recent ${itemName}`, { connectionId, path, error }, "browser"));
}

// ============================================================================
// Hook
// ============================================================================

export function useFileBrowserPane(config: UseFileBrowserPaneConfig): UseFileBrowserPaneReturn {
  const {
    rowHeight,
    connections = [],
    disabled = false,
    isActive = true,
    onCompanionHint,
    onNavigatePath,
    onNavigateConnection,
    onNavigateDirectory,
  } = config;

  const { currentTheme } = useSambeeTheme();

  // ──────────────────────────────────────────────────────────────────────────
  // Core State
  // ──────────────────────────────────────────────────────────────────────────

  const [connectionId, setConnectionId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // UI Preferences
  // ──────────────────────────────────────────────────────────────────────────

  const [sortBy, setSortBy] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useFileBrowserViewModePreference();
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [includeDotDirectoriesInQuickNav] = useQuickNavIncludeDotDirectoriesPreference();

  // ──────────────────────────────────────────────────────────────────────────
  // Selection State (multi-select)
  // ──────────────────────────────────────────────────────────────────────────

  /** Set of currently selected file names. */
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // ──────────────────────────────────────────────────────────────────────────
  // Viewer State
  // ──────────────────────────────────────────────────────────────────────────

  const [viewInfo, setViewInfo] = useState<UseFileBrowserPaneReturn["viewInfo"]>(null);
  const [browserViewerPickerState, setBrowserViewerPickerState] = useState<UseFileBrowserPaneReturn["browserViewerPickerState"]>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // CRUD Dialog State
  // ──────────────────────────────────────────────────────────────────────────

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<FileEntry[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createItemType, setCreateItemType] = useState<FileType>(FileType.DIRECTORY);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Companion App State
  // ──────────────────────────────────────────────────────────────────────────

  const [openInAppLoading, setOpenInAppLoading] = useState(false);

  const selectedConnection = useMemo(() => getConnectionById(connections, connectionId), [connections, connectionId]);
  const connectionIsReadOnly = isConnectionReadOnly(selectedConnection);
  const pendingRecentDirectoryVisitRef = React.useRef<{ connectionId: string; path: string } | null>(null);
  const searchBufferRef = React.useRef<string>("");
  const searchTimeoutRef = React.useRef<number | null>(null);

  const clearIncrementalSearch = useCallback(() => {
    searchBufferRef.current = "";
    if (searchTimeoutRef.current !== null) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
  }, []);

  const recordRecentDirectoryVisit = useCallback((targetConnectionId: string, path: string) => {
    if (!path) {
      return;
    }

    recordRecentHistoryEntry({
      connectionId: targetConnectionId,
      path,
      expectedType: FileType.DIRECTORY,
      record: api.recordRecentDirectory.bind(api),
      publish: publishRecentDirectoriesChanged,
      itemName: "directory",
    });
  }, []);

  const clearPendingRecentDirectoryVisit = useCallback((targetConnectionId: string, path: string) => {
    const pendingVisit = pendingRecentDirectoryVisitRef.current;
    if (pendingVisit?.connectionId === targetConnectionId && pendingVisit.path === path) {
      pendingRecentDirectoryVisitRef.current = null;
    }
  }, []);

  const recordRecentFileAttempt = useCallback((targetConnectionId: string, path: string) => {
    recordRecentHistoryEntry({
      connectionId: targetConnectionId,
      path,
      expectedType: FileType.FILE,
      record: api.recordRecentFile.bind(api),
      publish: publishRecentFilesChanged,
      itemName: "file",
    });
  }, []);

  const removeRecentFileRecord = useCallback(async (recordId: string) => {
    try {
      await api.removeRecentFile(recordId);
      publishRecentFilesChanged();
    } catch (error: unknown) {
      logger.warn("Failed to remove stale recent file", { recordId, error }, "browser");
    }
  }, []);

  const prepareDirectoryTransition = useCallback((nextConnectionId: string, nextPath: string): void => {
    directoryLoadAbortRef.current?.abort();
    directoryLoadAbortRef.current = null;

    if (!nextConnectionId) {
      setFiles([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cacheKey = `${nextConnectionId}:${nextPath}`;
    const cached = directoryCache.current.get(cacheKey);
    const now = Date.now();

    setError(null);

    if (cached && now - cached.timestamp < DIRECTORY_CACHE_TTL_MS) {
      setFiles(cached.items);
      setLoading(false);
      return;
    }

    setLoading(true);
  }, []);

  const navigateToPath = useCallback(
    (nextPath: string) => {
      const nextConnectionId = connectionIdRef.current;
      if (!nextConnectionId) {
        return;
      }

      const normalizedPath = normalizeLocalDrivePath(nextConnectionId, nextPath);
      if (currentPathRef.current === normalizedPath) {
        return;
      }

      clearIncrementalSearch();

      pendingRecentDirectoryVisitRef.current = normalizedPath ? { connectionId: nextConnectionId, path: normalizedPath } : null;

      pendingLocationRef.current = {
        connectionId: nextConnectionId,
        path: normalizedPath,
      };

      prepareDirectoryTransition(nextConnectionId, normalizedPath);
      setCurrentPath(normalizedPath);
      setViewInfo(null);
      onNavigatePath?.(normalizedPath);
    },
    [clearIncrementalSearch, onNavigatePath, prepareDirectoryTransition]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Search Provider
  // ──────────────────────────────────────────────────────────────────────────

  const directorySearchProvider = useDirectorySearchProvider(
    connectionId,
    (path) => {
      navigateToPath(path);
    },
    {
      includeDotDirectories: includeDotDirectoriesInQuickNav,
      getConnectionName: (targetConnectionId) => getConnectionById(connections, targetConnectionId)?.name ?? targetConnectionId,
      onNavigateDirectory: (targetConnectionId, path) => {
        if (targetConnectionId === connectionIdRef.current) {
          navigateToPath(path);
          return;
        }
        pendingRecentDirectoryVisitRef.current = { connectionId: targetConnectionId, path };
        onNavigateDirectory?.(targetConnectionId, path);
      },
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Refs — DOM
  // ──────────────────────────────────────────────────────────────────────────

  const parentRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const [listContainerEl, setListContainerEl] = useState<HTMLDivElement | null>(null);
  const listContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== listContainerEl) {
        setListContainerEl(node);
      }
    },
    [listContainerEl]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Refs — Performance / Async
  // ──────────────────────────────────────────────────────────────────────────

  const filesRef = React.useRef<FileEntry[]>([]);
  const connectionIdRef = React.useRef<string>("");
  const currentPathRef = React.useRef<string>("");
  const pendingLocationRef = React.useRef<{ connectionId: string; path: string } | null>(null);
  const loadFilesRef = React.useRef<(path: string, forceRefresh?: boolean) => Promise<void>>();
  const latestLoadRequestIdRef = React.useRef(0);
  const directoryLoadAbortRef = React.useRef<AbortController | null>(null);

  const pendingFocusedIndexRef = React.useRef<number | null>(null);
  const focusCommitRafRef = React.useRef<number | null>(null);

  const currentViewIndexRef = React.useRef<number | null>(null);
  const currentViewImagesRef = React.useRef<string[] | undefined>(undefined);
  const lastDisplayedImagePathRef = React.useRef<string | null>(null);

  const [visibleRowCount, setVisibleRowCount] = useState(10);
  const visibleRowCountRef = React.useRef<number>(10);

  const navigationHistory = React.useRef<Map<string, { focusedIndex: number; scrollOffset: number; selectedFileName: string | null }>>(
    new Map()
  );

  const directoryCache = React.useRef<Map<string, { items: FileEntry[]; timestamp: number }>>(new Map());
  const pendingDirectoryEntryIntentRef = React.useRef<DirectoryEntryIntent | null>({ kind: "fresh" });

  const pendingFocusNameRef = React.useRef<string | null>(null);
  const pendingSelectedFilesRestoreRef = React.useRef<Set<string> | null>(null);
  const lastAppliedRouteSyncTokenRef = React.useRef<number>(0);
  const lastForceReloadRef = React.useRef<number>(0);

  // ──────────────────────────────────────────────────────────────────────────
  // Ref Sync Effects
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  // ──────────────────────────────────────────────────────────────────────────
  // Focus Management
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * updateFocus — sets the focused file index, with optional RAF batching
   * to avoid layout thrashing during rapid keyboard navigation (key repeat).
   */
  const updateFocus = React.useCallback((next: number, options?: { immediate?: boolean }) => {
    const immediate = options?.immediate ?? false;

    const commit = () => {
      setFocusedIndex((prev: number) => (prev === next ? prev : next));
    };

    if (immediate) {
      if (focusCommitRafRef.current !== null) {
        cancelAnimationFrame(focusCommitRafRef.current);
        focusCommitRafRef.current = null;
      }
      pendingFocusedIndexRef.current = null;
      commit();
      return;
    }

    pendingFocusedIndexRef.current = next;
    if (focusCommitRafRef.current !== null) return;

    focusCommitRafRef.current = requestAnimationFrame(() => {
      focusCommitRafRef.current = null;
      const target = pendingFocusedIndexRef.current;
      pendingFocusedIndexRef.current = null;
      if (target === null) return;
      setFocusedIndex((prev: number) => (prev === target ? prev : target));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (focusCommitRafRef.current !== null) {
        cancelAnimationFrame(focusCommitRafRef.current);
      }
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Data Loading
  // ──────────────────────────────────────────────────────────────────────────

  const loadFiles = useCallback(
    async (path: string, forceRefresh = false, preserveVisibleContent = false) => {
      if (!connectionId) return;

      directoryLoadAbortRef.current?.abort();

      const abortController = new AbortController();
      directoryLoadAbortRef.current = abortController;

      const targetConnectionId = connectionId;
      const targetPath = path;
      const cacheKey = `${targetConnectionId}:${targetPath}`;
      const requestId = latestLoadRequestIdRef.current + 1;
      latestLoadRequestIdRef.current = requestId;
      const now = Date.now();

      if (!forceRefresh) {
        const cached = directoryCache.current.get(cacheKey);
        if (cached && now - cached.timestamp < DIRECTORY_CACHE_TTL_MS) {
          setFiles(cached.items);
          setLoading(false);
          setError(null);
          const pendingVisit = pendingRecentDirectoryVisitRef.current;
          if (pendingVisit?.connectionId === targetConnectionId && pendingVisit.path === targetPath) {
            pendingRecentDirectoryVisitRef.current = null;
            recordRecentDirectoryVisit(targetConnectionId, targetPath);
          }
          return;
        }
      } else {
        directoryCache.current.delete(cacheKey);
      }

      const shouldKeepVisibleContent = preserveVisibleContent && filesRef.current.length > 0;

      setLoading(!shouldKeepVisibleContent);
      setError(null);

      try {
        const listing = await api.listDirectory(targetConnectionId, targetPath, { signal: abortController.signal });
        const items = listing.items ?? [];
        directoryCache.current.set(cacheKey, { items, timestamp: now });

        const isStaleRequest =
          latestLoadRequestIdRef.current !== requestId ||
          connectionIdRef.current !== targetConnectionId ||
          currentPathRef.current !== targetPath;

        if (isStaleRequest) {
          logger.debug(
            "Ignoring stale directory response",
            {
              requestConnectionId: targetConnectionId,
              requestPath: targetPath,
              currentConnectionId: connectionIdRef.current,
              currentPath: currentPathRef.current,
            },
            "browser"
          );
          return;
        }

        setFiles(items);
        const pendingVisit = pendingRecentDirectoryVisitRef.current;
        if (pendingVisit?.connectionId === targetConnectionId && pendingVisit.path === targetPath) {
          pendingRecentDirectoryVisitRef.current = null;
          recordRecentDirectoryVisit(targetConnectionId, targetPath);
        }
      } catch (err) {
        if (abortController.signal.aborted || isLocalAbortError(err)) {
          const isLatestRequest =
            latestLoadRequestIdRef.current === requestId &&
            connectionIdRef.current === targetConnectionId &&
            currentPathRef.current === targetPath;
          if (isLatestRequest) {
            clearPendingRecentDirectoryVisit(targetConnectionId, targetPath);
          }
          return;
        }

        const isStaleRequest =
          latestLoadRequestIdRef.current !== requestId ||
          connectionIdRef.current !== targetConnectionId ||
          currentPathRef.current !== targetPath;

        if (isStaleRequest) {
          logger.debug(
            "Ignoring stale directory error",
            {
              requestConnectionId: targetConnectionId,
              requestPath: targetPath,
              currentConnectionId: connectionIdRef.current,
              currentPath: currentPathRef.current,
            },
            "browser"
          );
          return;
        }

        clearPendingRecentDirectoryVisit(targetConnectionId, targetPath);

        logger.error("Error loading directory", { error: err, connectionId: targetConnectionId, path: targetPath }, "browser");

        let errorMessage = DIRECTORY_LOAD_GENERIC_ERROR;

        if (isClientTimeoutError(err)) {
          errorMessage = DIRECTORY_LOAD_TIMEOUT_ERROR;
        } else if (err && typeof err === "object" && "message" in err) {
          const error = err as Error & { code?: string };
          const message = error.message;
          if (message.includes("Network Error") || message.includes("ECONNREFUSED") || error.code === "ECONNREFUSED") {
            errorMessage = DIRECTORY_LOAD_NETWORK_ERROR;
          } else if (isApiError(err)) {
            if (err.response?.status === 404) {
              const detail = err.response?.data?.detail;
              errorMessage = detail || "Directory not found. It may have been removed or renamed.";
            } else if (err.response?.status === 504) {
              errorMessage = err.response?.data?.detail || DIRECTORY_LOAD_TIMEOUT_ERROR;
            } else if (err.response?.data?.detail) {
              errorMessage = err.response.data.detail;
            }
          }
        } else if (isApiError(err)) {
          if (err.response?.status === 404) {
            const detail = err.response?.data?.detail;
            errorMessage = detail || "Directory not found. It may have been removed or renamed.";
          } else if (err.response?.status === 504) {
            errorMessage = err.response?.data?.detail || DIRECTORY_LOAD_TIMEOUT_ERROR;
          } else if (err.response?.data?.detail) {
            errorMessage = err.response.data.detail;
          }
        }

        setError(errorMessage);
      } finally {
        if (directoryLoadAbortRef.current === abortController) {
          directoryLoadAbortRef.current = null;
        }

        const isLatestRequest =
          latestLoadRequestIdRef.current === requestId &&
          connectionIdRef.current === targetConnectionId &&
          currentPathRef.current === targetPath;

        if (isLatestRequest) {
          setLoading(false);
        }
      }
    },
    [clearPendingRecentDirectoryVisit, connectionId, recordRecentDirectoryVisit]
  );

  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  const seedDirectorySnapshot = useCallback((targetConnectionId: string, targetPath: string, items: FileEntry[]) => {
    if (!targetConnectionId) {
      return;
    }

    const snapshot = [...items];
    directoryCache.current.set(`${targetConnectionId}:${targetPath}`, {
      items: snapshot,
      timestamp: Date.now(),
    });

    if (connectionIdRef.current === targetConnectionId && currentPathRef.current === targetPath) {
      setFiles(snapshot);
      setLoading(false);
      setError(null);
    }
  }, []);

  // Load files when connection or path changes
  useEffect(() => {
    if (connectionId) {
      loadFilesRef.current?.(currentPath);
    }
  }, [currentPath, connectionId]);

  useEffect(() => {
    return () => {
      directoryLoadAbortRef.current?.abort();
      directoryLoadAbortRef.current = null;
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Sort (computed)
  // ──────────────────────────────────────────────────────────────────────────

  const sortedFiles = useMemo(() => {
    const directories: FileEntry[] = [];
    const regularFiles: FileEntry[] = [];

    for (const file of files) {
      if (file.type === "directory") {
        directories.push(file);
      } else {
        regularFiles.push(file);
      }
    }

    const sortFunction = (a: FileEntry, b: FileEntry) => {
      let comparison = 0;
      switch (sortBy) {
        case "name":
          comparison = compareLocalizedStrings(a.name, b.name);
          break;
        case "size":
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case "modified": {
          const dateA = a.modified_at ? new Date(a.modified_at).getTime() : 0;
          const dateB = b.modified_at ? new Date(b.modified_at).getTime() : 0;
          comparison = dateA - dateB;
          break;
        }
        case "type": {
          const extA = a.name.includes(".") ? a.name.split(".").pop()?.toLowerCase() || "" : "";
          const extB = b.name.includes(".") ? b.name.split(".").pop()?.toLowerCase() || "" : "";
          comparison = compareLocalizedStrings(extA, extB);
          if (comparison === 0) {
            comparison = compareLocalizedStrings(a.name, b.name);
          }
          break;
        }
        default:
          comparison = 0;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    };

    directories.sort(sortFunction);
    regularFiles.sort(sortFunction);

    return [...directories, ...regularFiles];
  }, [files, sortBy, sortDirection]);

  /** Image files in display order — used for gallery mode. */
  const imageFiles = useMemo(() => {
    return sortedFiles
      .filter((f: FileEntry) => f.type === "file" && isImageFile(f.name))
      .map((f: FileEntry) => (currentPath ? `${currentPath}/${f.name}` : f.name));
  }, [sortedFiles, currentPath]);

  const getVirtualizerItemKey = useCallback(
    (index: number) => {
      const file = sortedFiles[index];
      return file ? `${connectionId}:${currentPath}:${file.name}` : `${connectionId}:${currentPath}:${index}`;
    },
    [connectionId, currentPath, sortedFiles]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Virtualizer
  // ──────────────────────────────────────────────────────────────────────────

  const rowVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    getItemKey: getVirtualizerItemKey,
    enabled: !loading,
    useFlushSync: false,
  });

  const lastMeasuredRowHeightRef = React.useRef<number | null>(null);

  useLayoutEffect(() => {
    if (lastMeasuredRowHeightRef.current === rowHeight) {
      return;
    }

    lastMeasuredRowHeightRef.current = rowHeight;
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // ──────────────────────────────────────────────────────────────────────────
  // Focus-Restore / Scroll Effects
  // ──────────────────────────────────────────────────────────────────────────

  const resetListScrollToTop = React.useCallback(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, []);

  const prevPathForFocusRef = React.useRef<string>(currentPath);
  const prevFocusedIndexRef = React.useRef<number>(0);
  const skipNextLayoutScrollRef = React.useRef<boolean>(false);
  const lastRestoredPathRef = React.useRef<string | null>(null);

  // Keep filesRef updated and restore or reset focused index when files change.
  // This must run before paint so a newly entered directory cannot briefly render
  // with the previous directory's focused index or virtualizer window.
  useLayoutEffect(() => {
    filesRef.current = sortedFiles;

    if (loading) {
      return;
    }

    if (currentPath !== prevPathForFocusRef.current) {
      prevPathForFocusRef.current = currentPath;
      pendingFocusNameRef.current = null;

      if (pendingDirectoryEntryIntentRef.current === null) {
        pendingDirectoryEntryIntentRef.current = { kind: "fresh" };
      }
    }

    const applyFreshDirectoryEntry = () => {
      pendingDirectoryEntryIntentRef.current = null;
      updateFocus(0, { immediate: true });
      resetListScrollToTop();
      if (sortedFiles.length > 0) {
        rowVirtualizer.scrollToIndex(0, { align: "start" });
      }
    };

    const entryIntent = pendingDirectoryEntryIntentRef.current;
    if (entryIntent?.kind === "restore-history") {
      const savedState = navigationHistory.current.get(currentPath);
      if (savedState) {
        const restoredIndex = savedState.selectedFileName
          ? sortedFiles.findIndex((f: FileEntry) => f.name === savedState.selectedFileName)
          : Math.min(savedState.focusedIndex, Math.max(sortedFiles.length - 1, 0));

        if (restoredIndex >= 0) {
          pendingDirectoryEntryIntentRef.current = null;
          lastRestoredPathRef.current = currentPath;
          updateFocus(restoredIndex, { immediate: true });
          const restorePath = currentPath;
          requestAnimationFrame(() => {
            if (parentRef.current && currentPathRef.current === restorePath) {
              parentRef.current.scrollTop = savedState.scrollOffset;
            }
          });
          navigationHistory.current.delete(currentPath);
          return;
        }

        navigationHistory.current.delete(currentPath);
      }

      applyFreshDirectoryEntry();
      return;
    }

    if (entryIntent?.kind === "parent-return") {
      const restoreIndex = sortedFiles.findIndex((f: FileEntry) => f.name === entryIntent.childName);
      if (restoreIndex >= 0) {
        pendingDirectoryEntryIntentRef.current = null;
        updateFocus(restoreIndex, { immediate: true });
        rowVirtualizer.scrollToIndex(restoreIndex, { align: "auto" });
        return;
      }

      applyFreshDirectoryEntry();
      return;
    }

    if (entryIntent?.kind === "fresh") {
      applyFreshDirectoryEntry();
      return;
    }

    const pendingName = pendingFocusNameRef.current;
    if (pendingName !== null) {
      const idx = sortedFiles.findIndex((f: FileEntry) => f.name === pendingName);
      if (idx >= 0) {
        pendingFocusNameRef.current = null;
        updateFocus(idx, { immediate: true });
        rowVirtualizer.scrollToIndex(idx, { align: "auto" });
        return;
      }

      pendingFocusNameRef.current = null;
    }
  }, [sortedFiles, currentPath, loading, updateFocus, rowVirtualizer, resetListScrollToTop]);

  // Scroll focused item into view
  useLayoutEffect(() => {
    if (focusedIndex >= 0) {
      if (focusedIndex >= sortedFiles.length) {
        prevFocusedIndexRef.current = Math.max(sortedFiles.length - 1, 0);
        return;
      }

      const prev = prevFocusedIndexRef.current;
      const diff = focusedIndex - prev;

      if (skipNextLayoutScrollRef.current || lastRestoredPathRef.current === currentPathRef.current) {
        skipNextLayoutScrollRef.current = false;
        lastRestoredPathRef.current = null;
        prevFocusedIndexRef.current = focusedIndex;
        return;
      }

      let align: "auto" | "center" | "end" | "start" = "auto";
      if (diff >= visibleRowCount) {
        align = "end";
      } else if (diff <= -visibleRowCount) {
        align = "start";
      } else if (Math.abs(diff) === 1) {
        align = "auto";
      } else {
        align = diff > 0 ? "end" : "start";
      }

      rowVirtualizer.scrollToIndex(focusedIndex, { align });
      prevFocusedIndexRef.current = focusedIndex;
    }
  }, [focusedIndex, sortedFiles.length, visibleRowCount, rowVirtualizer]);

  // Resize observer for visible-row-count (used by PageUp/PageDown)
  useLayoutEffect(() => {
    const element = listContainerEl;
    if (!element) return;

    const updateVisibleRows = () => {
      const rect = element.getBoundingClientRect();
      const visibleRows = Math.floor(rect.height / rowHeight);
      const newCount = visibleRows >= 5 ? visibleRows : 10;
      if (newCount !== visibleRowCountRef.current) {
        setVisibleRowCount(newCount);
        visibleRowCountRef.current = newCount;
      }
    };

    updateVisibleRows();
    const observer = new ResizeObserver(updateVisibleRows);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [listContainerEl, rowHeight]);

  const currentLocationKey = `${connectionId}:${currentPath}`;

  // Restore the active pane's list focus before a new directory listing is painted.
  useLayoutEffect(() => {
    if (currentLocationKey && isActive && listContainerEl?.isConnected && !viewInfo) {
      listContainerEl.focus();
    }
  }, [currentLocationKey, isActive, listContainerEl, viewInfo]);

  // ──────────────────────────────────────────────────────────────────────────
  // Connection Change
  // ──────────────────────────────────────────────────────────────────────────

  const handleConnectionChange = useCallback(
    (newConnectionId: string) => {
      if (newConnectionId === connectionId) return;
      clearIncrementalSearch();
      pendingLocationRef.current = {
        connectionId: newConnectionId,
        path: "",
      };
      prepareDirectoryTransition(newConnectionId, "");
      setConnectionId(newConnectionId);
      setCurrentPath("");
      setViewInfo(null);
      setSelectedFiles(new Set());
      directoryCache.current.clear();
      navigationHistory.current.clear();
      writeSelectedConnectionIdPreference(newConnectionId);
      onNavigateConnection?.(newConnectionId);
    },
    [clearIncrementalSearch, connectionId, onNavigateConnection, prepareDirectoryTransition]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // File Click / Viewer
  // ──────────────────────────────────────────────────────────────────────────

  const handleViewIndexChange = useCallback(
    (index: number) => {
      currentViewIndexRef.current = index;
      setViewInfo((prev) => {
        if (!prev?.images || prev.images.length === 0) return prev;
        const nextPath = prev.images[index] ?? prev.path;
        if (lastDisplayedImagePathRef.current !== nextPath) {
          recordRecentFileAttempt(prev.connectionId ?? connectionIdRef.current, nextPath);
          lastDisplayedImagePathRef.current = nextPath;
        }
        if (prev.currentIndex === index && prev.path === nextPath) return prev;
        return { ...prev, currentIndex: index, path: nextPath };
      });
    },
    [recordRecentFileAttempt]
  );

  const handleViewClose = useCallback(() => {
    const images = currentViewImagesRef.current ?? viewInfo?.images;
    const indexFromRef = currentViewIndexRef.current ?? viewInfo?.currentIndex ?? null;

    let finalPath: string | undefined;
    if (images && images.length > 0) {
      const clampedIndex = indexFromRef !== null ? Math.min(Math.max(indexFromRef, 0), images.length - 1) : 0;
      finalPath = images[clampedIndex];
    } else if (viewInfo?.path) {
      finalPath = viewInfo.path;
    }

    setViewInfo(null);
    currentViewIndexRef.current = null;
    currentViewImagesRef.current = undefined;
    lastDisplayedImagePathRef.current = null;

    if (!finalPath) return;

    const targetIndex = sortedFiles.findIndex((file: FileEntry) => {
      if (file.type !== "file") return false;
      const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      return fullPath === finalPath;
    });

    if (targetIndex >= 0) {
      updateFocus(targetIndex, { immediate: true });
    }
  }, [currentPath, viewInfo, sortedFiles, updateFocus]);

  // ──────────────────────────────────────────────────────────────────────────
  // Keyboard Navigation Handlers
  // ──────────────────────────────────────────────────────────────────────────

  const handleNavigateDown = useCallback(
    (e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;
      if (focusedIndex < 0) return;

      const fileCount = filesRef.current.length;
      const next = Math.min(focusedIndex + 1, fileCount - 1);
      if (next === focusedIndex) return;
      if (e?.repeat) {
        updateFocus(next, { immediate: false });
      } else {
        updateFocus(next);
      }
    },
    [focusedIndex, updateFocus, listContainerEl]
  );

  const handleArrowUp = useCallback(
    (e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;
      if (focusedIndex < 0) return;

      const next = Math.max(focusedIndex - 1, 0);
      if (next === focusedIndex) return;
      if (e?.repeat) {
        updateFocus(next, { immediate: false });
      } else {
        updateFocus(next);
      }
    },
    [focusedIndex, updateFocus, listContainerEl]
  );

  const handleHome = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;
    updateFocus(0);
  }, [updateFocus, listContainerEl]);

  const handleEnd = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;
    const fileCount = filesRef.current.length;
    updateFocus(fileCount - 1);
  }, [updateFocus, listContainerEl]);

  const handlePageDown = useCallback(
    (e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const fileCount = filesRef.current.length;
      const pageSize = visibleRowCount;
      const newIndex = Math.min(focusedIndex + pageSize, fileCount - 1);

      if (e?.repeat) {
        updateFocus(newIndex, { immediate: false });
      } else {
        rowVirtualizer.scrollToIndex(newIndex, { align: "end" });
        skipNextLayoutScrollRef.current = true;
        updateFocus(newIndex, { immediate: true });
      }
    },
    [focusedIndex, visibleRowCount, updateFocus, rowVirtualizer, listContainerEl]
  );

  const handlePageUp = useCallback(
    (e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const pageSize = visibleRowCount;
      const newIndex = Math.max(focusedIndex - pageSize, 0);

      if (e?.repeat) {
        updateFocus(newIndex, { immediate: false });
      } else {
        rowVirtualizer.scrollToIndex(newIndex, { align: "start" });
        skipNextLayoutScrollRef.current = true;
        updateFocus(newIndex, { immediate: true });
      }
    },
    [focusedIndex, visibleRowCount, updateFocus, rowVirtualizer, listContainerEl]
  );

  const getFocusedFileForAction = useCallback(
    (options?: { requireListFocus?: boolean }) => {
      if (!listContainerEl) return null;

      const requireListFocus = options?.requireListFocus ?? true;
      if (requireListFocus) {
        const activeElement = document.activeElement;
        if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) {
          return null;
        }
      }

      return filesRef.current[focusedIndex] ?? null;
    },
    [focusedIndex, listContainerEl]
  );

  const openFileInViewer = useCallback(
    (
      file: FileEntry,
      filePath: string,
      mimeType: string,
      viewerId?: "image" | "markdown" | "pdf",
      targetConnectionId = connectionIdRef.current
    ) => {
      const viewerSessionId = createViewerSessionId();
      const useImageGallery =
        viewerId === "image" && isImageFile(file.name) && targetConnectionId === connectionIdRef.current && imageFiles.includes(filePath);

      logger.info(
        "File selected for viewing",
        {
          path: filePath,
          fileName: file.name,
          size: file.size,
          mimeType,
          viewerId,
          isImage: useImageGallery,
          imageFilesCount: imageFiles.length,
        },
        "viewer"
      );

      if (useImageGallery) {
        const imageIndex = imageFiles.indexOf(filePath);
        const effectiveIndex = imageIndex >= 0 ? imageIndex : 0;
        currentViewIndexRef.current = effectiveIndex;
        currentViewImagesRef.current = imageFiles;
        lastDisplayedImagePathRef.current = null;
        setViewInfo({
          connectionId: targetConnectionId,
          path: filePath,
          mimeType,
          viewerId,
          images: imageFiles,
          currentIndex: effectiveIndex,
          sessionId: viewerSessionId,
        });
        return;
      }

      currentViewIndexRef.current = null;
      currentViewImagesRef.current = undefined;
      recordRecentFileAttempt(targetConnectionId, filePath);
      setViewInfo({ connectionId: targetConnectionId, path: filePath, mimeType, viewerId, sessionId: viewerSessionId });
    },
    [imageFiles, recordRecentFileAttempt]
  );

  const openNativeFile = useCallback(
    async (
      file: FileEntry,
      options?: { forcePicker?: boolean },
      target?: { connectionId: string; path: string; recentRecordId?: string }
    ) => {
      const targetConnectionId = target?.connectionId ?? connectionIdRef.current;
      if (!targetConnectionId || file.type === "directory") return;
      if (isConnectionReadOnly(getConnectionById(connections, targetConnectionId)) && !isLocalDrive(targetConnectionId)) return;

      const filePath = target?.path ?? (currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name);
      recordRecentFileAttempt(targetConnectionId, filePath);

      setOpenInAppLoading(true);
      try {
        if (isLocalDrive(targetConnectionId)) {
          await api.openLocalFile(targetConnectionId, filePath, { forcePicker: options?.forcePicker ?? false });
          logger.info("Opened local file directly", { path: filePath, forcePicker: options?.forcePicker ?? false }, "companion");
        } else {
          const themeJson = JSON.stringify({
            id: currentTheme.id,
            mode: currentTheme.mode,
            primary: {
              main: currentTheme.primary.main,
            },
          });
          const uri = await api.getCompanionUri(targetConnectionId, filePath, themeJson, {
            forcePicker: options?.forcePicker ?? false,
          });
          logger.info("Opening file in companion app", { path: filePath, forcePicker: options?.forcePicker ?? false }, "companion");
          window.location.href = uri;
          onCompanionHint?.();
        }
      } catch (err: unknown) {
        let detail = "Failed to open file.";
        const errorDetail = isApiError(err) ? err.response?.data?.detail : undefined;
        if (typeof errorDetail === "string") {
          detail = errorDetail;
        }
        if (target?.recentRecordId && isPermanentLocalRecentOpenFailure(getApiErrorCode(err))) {
          await removeRecentFileRecord(target.recentRecordId);
        }
        setError(detail);
        logger.error(`Open in app failed: ${filePath}`, { error: err }, "companion");
      } finally {
        setOpenInAppLoading(false);
      }
    },
    [connections, currentTheme, onCompanionHint, recordRecentFileAttempt, removeRecentFileRecord]
  );

  const openBrowserViewerPicker = useCallback(
    async (file: FileEntry, filePath: string, mimeType: string, options?: { includeAllViewers?: boolean; connectionId?: string }) => {
      const compatibleViewerIds = getCompatibleViewerIds(file.name, mimeType);
      const preferredViewerId = await getPreferredViewerId(file.name, mimeType);
      const defaultViewerId = compatibleViewerIds[0] ?? null;
      const viewerIds =
        options?.includeAllViewers ||
        compatibleViewerIds.length === 0 ||
        (preferredViewerId !== null && !compatibleViewerIds.includes(preferredViewerId))
          ? getAllViewerIds()
          : compatibleViewerIds;

      setBrowserViewerPickerState({
        connectionId: options?.connectionId,
        fileName: file.name,
        filePath,
        mimeType,
        viewerIds,
        compatibleViewerIds,
        defaultViewerId,
        preferredViewerId,
        showNativeOption: compatibleViewerIds.length === 0,
      });
    },
    []
  );

  const openFileWithAssociatedViewer = useCallback(
    (file: FileEntry, filePath: string, mimeType: string, targetConnectionId = connectionIdRef.current) => {
      const compatibleViewerIds = getCompatibleViewerIds(file.name, mimeType);
      void getPreferredViewerId(file.name, mimeType).then((preferredViewerId) => {
        if (preferredViewerId) {
          openFileInViewer(file, filePath, mimeType, preferredViewerId, targetConnectionId);
          return;
        }

        if (compatibleViewerIds.length === 0) {
          void openBrowserViewerPicker(file, filePath, mimeType, { connectionId: targetConnectionId });
          return;
        }

        if (compatibleViewerIds.length === 1) {
          openFileInViewer(file, filePath, mimeType, compatibleViewerIds[0], targetConnectionId);
          return;
        }

        void openBrowserViewerPicker(file, filePath, mimeType, { connectionId: targetConnectionId });
      });
    },
    [openBrowserViewerPicker, openFileInViewer]
  );

  const handleFileClick = useCallback(
    (file: FileEntry, index?: number) => {
      if (index !== undefined) {
        updateFocus(index, { immediate: true });
      }

      if (file.type === "directory") {
        const currentScrollOffset = parentRef.current?.scrollTop || 0;
        const currentFocusedIndex = focusedIndex;
        navigationHistory.current.set(currentPath, {
          focusedIndex: currentFocusedIndex,
          scrollOffset: currentScrollOffset,
          selectedFileName: file.name,
        });

        const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
        pendingDirectoryEntryIntentRef.current = { kind: "fresh" };
        logger.info("Navigating to directory", { from: currentPath, to: newPath, directory: file.name }, "browser");

        navigateToPath(newPath);
        return;
      }

      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      const mimeType = file.mime_type || "application/octet-stream";

      openFileWithAssociatedViewer(file, filePath, mimeType);
    },
    [currentPath, updateFocus, focusedIndex, navigateToPath, openFileWithAssociatedViewer]
  );

  const handleOpenFileForFile = useCallback(
    (file: FileEntry, index: number, mode: BrowserOpenMode = "associated-viewer") => {
      if (file.type === "directory") {
        handleFileClick(file, index);
        return;
      }

      const filePath = currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name;
      const mimeType = file.mime_type || "application/octet-stream";

      if (mode === "associated-native-app") {
        void openNativeFile(file);
        return;
      }

      if (mode === "force-native-picker") {
        void openNativeFile(file, { forcePicker: true });
        return;
      }

      if (mode === "force-viewer-picker") {
        void openBrowserViewerPicker(file, filePath, mimeType, { includeAllViewers: true });
        return;
      }

      openFileWithAssociatedViewer(file, filePath, mimeType);
    },
    [handleFileClick, openNativeFile, openBrowserViewerPicker, openFileWithAssociatedViewer]
  );

  const handleOpenFileAtPath = useCallback(
    async (targetConnectionId: string, path: string, mode: BrowserOpenMode = "associated-viewer", recentRecordId?: string) => {
      const name = path.split("/").pop();
      if (!name || !path) return;
      let file = { name, type: "file", mime_type: "application/octet-stream" } as FileEntry;

      if (recentRecordId) {
        if (isLocalDrive(targetConnectionId)) {
          try {
            file = await api.getFileInfo(targetConnectionId, path);
            if (file.type !== FileType.FILE) {
              await removeRecentFileRecord(recentRecordId);
              setError(RECENT_FILE_NOT_FILE_ERROR);
              return;
            }
          } catch (error: unknown) {
            if (getApiErrorCode(error) === "recent_file_target_missing") {
              await removeRecentFileRecord(recentRecordId);
              setError(RECENT_FILE_MISSING_ERROR);
            } else {
              setError(RECENT_FILE_DEFAULT_ERROR);
            }
            logger.warn("Recent local file could not be validated before opening", { targetConnectionId, path, error }, "browser");
            return;
          }
        } else {
          try {
            file = await api.validateRecentFileTarget(recentRecordId);
          } catch (error: unknown) {
            const validationError = getRecentFileValidationError(error);
            if (validationError && STALE_RECENT_FILE_CODES.has(validationError.code)) {
              publishRecentFilesChanged();
            }
            setError(validationError?.message ?? RECENT_FILE_DEFAULT_ERROR);
            logger.warn("Recent file could not be validated before opening", { targetConnectionId, path, error }, "browser");
            return;
          }
        }
      }
      const mimeType = file.mime_type || "application/octet-stream";

      if (mode === "associated-native-app") {
        void openNativeFile(file, undefined, { connectionId: targetConnectionId, path, recentRecordId });
        return;
      }
      if (mode === "force-native-picker") {
        void openNativeFile(file, { forcePicker: true }, { connectionId: targetConnectionId, path, recentRecordId });
        return;
      }
      if (mode === "force-viewer-picker") {
        void openBrowserViewerPicker(file, path, mimeType, { includeAllViewers: true, connectionId: targetConnectionId });
        return;
      }
      openFileWithAssociatedViewer(file, path, mimeType, targetConnectionId);
    },
    [openBrowserViewerPicker, openFileWithAssociatedViewer, openNativeFile, removeRecentFileRecord]
  );

  const handleOpenFile = useCallback(
    (options?: { requireListFocus?: boolean; mode?: BrowserOpenMode }) => {
      const file = getFocusedFileForAction(options);
      if (file) {
        handleOpenFileForFile(file, focusedIndex, options?.mode ?? "associated-viewer");
      }
    },
    [focusedIndex, getFocusedFileForAction, handleOpenFileForFile]
  );

  const handleNavigateUpDirectory = useCallback(() => {
    if (!currentPathRef.current) return;
    const pathParts = currentPathRef.current.split("/");
    const childDirectoryName = pathParts[pathParts.length - 1] || null;
    const parentPath = pathParts.slice(0, -1).join("/");

    pendingDirectoryEntryIntentRef.current = childDirectoryName
      ? { kind: "parent-return", childName: childDirectoryName }
      : { kind: "fresh" };

    if (childDirectoryName) {
      const existingParentHistory = navigationHistory.current.get(parentPath);
      navigationHistory.current.set(parentPath, {
        focusedIndex: existingParentHistory?.focusedIndex ?? 0,
        scrollOffset: existingParentHistory?.scrollOffset ?? 0,
        selectedFileName: childDirectoryName,
      });
    }

    const newPath = pathParts.slice(0, -1).join("/");
    navigateToPath(newPath);
  }, [navigateToPath]);

  /**
   * handleNavigateUp — Called by toolbar / breadcrumb "up" button.
   * Unlike handleNavigateUpDirectory (used by keyboard shortcut),
   * this also checks whether navigation is possible.
   */
  const handleNavigateUp = useCallback(() => {
    handleNavigateUpDirectory();
  }, [handleNavigateUpDirectory]);

  const handleClose = useCallback(() => {
    setViewInfo(null);
    setBrowserViewerPickerState(null);
    setSelectedFiles(new Set());
  }, []);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const forceReloadCurrentDirectory = useCallback((preserveVisibleContent = false) => {
    lastForceReloadRef.current = Date.now();
    loadFilesRef.current?.(currentPathRef.current, true, preserveVisibleContent);
  }, []);

  const handleRefresh = useCallback(() => {
    forceReloadCurrentDirectory();
  }, [forceReloadCurrentDirectory]);

  // ──────────────────────────────────────────────────────────────────────────
  // Selection (multi-select)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the focused file's selection and advance focus down (Norton Commander style).
   * Insert / Space both trigger this.
   */
  const handleToggleSelection = useCallback(
    (_e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const files = filesRef.current;
      if (files.length === 0) return;

      const currentFile = files[focusedIndex];
      if (!currentFile) return;

      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(currentFile.name)) {
          next.delete(currentFile.name);
        } else {
          next.add(currentFile.name);
        }
        return next;
      });

      // Move focus down (Norton Commander style)
      if (focusedIndex < files.length - 1) {
        updateFocus(focusedIndex + 1);
      }
    },
    [focusedIndex, updateFocus, listContainerEl]
  );

  /**
   * Select the focused file and move focus down (Alt+ArrowDown).
   * Always adds to the selection set (never deselects), like Shift+Down in most file managers.
   */
  const handleSelectDown = useCallback(
    (_e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const files = filesRef.current;
      if (files.length === 0) return;

      const currentFile = files[focusedIndex];
      if (!currentFile) return;

      // Select the current file
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        next.add(currentFile.name);
        return next;
      });

      // Move focus down
      if (focusedIndex < files.length - 1) {
        updateFocus(focusedIndex + 1);
      }
    },
    [focusedIndex, updateFocus, listContainerEl]
  );

  /**
   * Select the focused file and move focus up (Alt+ArrowUp).
   * Always adds to the selection set (never deselects), like Shift+Up in most file managers.
   */
  const handleSelectUp = useCallback(
    (_e?: KeyboardEvent) => {
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const files = filesRef.current;
      if (files.length === 0) return;

      const currentFile = files[focusedIndex];
      if (!currentFile) return;

      // Select the current file
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        next.add(currentFile.name);
        return next;
      });

      // Move focus up
      if (focusedIndex > 0) {
        updateFocus(focusedIndex - 1);
      }
    },
    [focusedIndex, updateFocus, listContainerEl]
  );

  /** Select all files in the current directory (Ctrl+A). */
  const handleSelectAll = useCallback(() => {
    const allNames = new Set(filesRef.current.map((f) => f.name));
    setSelectedFiles(allNames);
  }, []);

  /** Clear all selections. */
  const handleClearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  /**
   * Returns the effective selection for operations (copy, move, delete, etc.).
   * If files are explicitly selected, returns those in display order.
   * Otherwise returns the single focused file.
   */
  const getEffectiveSelection = useCallback(() => {
    if (selectedFiles.size > 0) {
      return filesRef.current.filter((f) => selectedFiles.has(f.name));
    }
    const focused = filesRef.current[focusedIndex];
    return focused ? [focused] : [];
  }, [selectedFiles, focusedIndex]);

  // Clear selection when the directory or connection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionId is needed as a trigger
  useEffect(() => {
    if (pendingSelectedFilesRestoreRef.current !== null) {
      setSelectedFiles(new Set(pendingSelectedFilesRestoreRef.current));
      pendingSelectedFilesRestoreRef.current = null;
      return;
    }

    setSelectedFiles(new Set());
  }, [currentPath, connectionId]);

  // ──────────────────────────────────────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────────────────────────────────────

  const handleDeleteRequest = useCallback(
    (options?: { requireListFocus?: boolean }) => {
      if (connectionIsReadOnly) return;

      const focusedFile = getFocusedFileForAction(options);
      if (!focusedFile) return;

      const targets = getEffectiveSelection();
      if (targets.length === 0) return;

      setDeleteTargets(targets);
      setDeleteDialogOpen(true);
    },
    [connectionIsReadOnly, getEffectiveSelection, getFocusedFileForAction]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTargets.length === 0 || !connectionId) return;
    if (connectionIsReadOnly) return;

    setIsDeleting(true);
    let deletedCount = 0;
    try {
      for (const target of deleteTargets) {
        await api.deleteItem(connectionId, target.path);
        deletedCount += 1;
      }

      setDeleteDialogOpen(false);
      setDeleteTargets([]);
      pendingFocusNameRef.current = null;

      lastForceReloadRef.current = Date.now();
      loadFilesRef.current?.(currentPathRef.current, true);
      listContainerEl?.focus();

      logger.info(`Deleted ${deleteTargets.length} item(s).`, { paths: deleteTargets.map((target) => target.path) }, "file-browser");
    } catch (err: unknown) {
      let detail = "Failed to delete item.";
      if (isApiError(err) && err.response?.data?.detail) {
        detail = err.response.data.detail;
      }
      setError(detail);
      setDeleteTargets((currentTargets) => currentTargets.slice(deletedCount));
      logger.error("Delete failed.", { error: err, paths: deleteTargets.map((target) => target.path) }, "file-browser");
    } finally {
      setIsDeleting(false);
    }
  }, [connectionIsReadOnly, deleteTargets, connectionId, listContainerEl]);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
    setDeleteTargets([]);
  }, []);

  // Rename
  // ──────────────────────────────────────────────────────────────────────────

  const handleRenameRequest = useCallback(
    (options?: { requireListFocus?: boolean }) => {
      const file = getFocusedFileForAction(options);
      if (!file) return;
      if (connectionIsReadOnly) return;

      setRenameError(null);
      setRenameTarget(file);
      setRenameDialogOpen(true);
    },
    [connectionIsReadOnly, getFocusedFileForAction]
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget || !connectionId) return;
      if (connectionIsReadOnly) return;

      setIsRenaming(true);
      setRenameError(null);
      try {
        await api.renameItem(connectionId, renameTarget.path, newName);

        setRenameDialogOpen(false);
        setRenameTarget(null);
        pendingFocusNameRef.current = newName;

        lastForceReloadRef.current = Date.now();
        loadFilesRef.current?.(currentPathRef.current, true);
        listContainerEl?.focus();

        logger.info(`Renamed: ${renameTarget.path} -> ${newName}`, undefined, "file-browser");
      } catch (err: unknown) {
        let detail = "Failed to rename item.";
        if (isApiError(err) && err.response?.data?.detail) {
          detail = err.response.data.detail;
        }
        setRenameError(detail);
        logger.error(`Rename failed: ${renameTarget.path}`, { error: err }, "file-browser");
      } finally {
        setIsRenaming(false);
      }
    },
    [connectionIsReadOnly, renameTarget, connectionId, listContainerEl]
  );

  const handleRenameForFile = useCallback(
    (file: FileEntry, _index: number) => {
      if (connectionIsReadOnly) return;
      setRenameError(null);
      setRenameTarget(file);
      setRenameDialogOpen(true);
    },
    [connectionIsReadOnly]
  );

  const closeRenameDialog = useCallback(() => {
    setRenameDialogOpen(false);
    setRenameTarget(null);
    setRenameError(null);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Create Item
  // ──────────────────────────────────────────────────────────────────────────

  const handleNewDirectoryRequest = useCallback(() => {
    if (connectionIsReadOnly) return;
    setCreateError(null);
    setCreateItemType(FileType.DIRECTORY);
    setCreateDialogOpen(true);
  }, [connectionIsReadOnly]);

  const handleNewFileRequest = useCallback(() => {
    if (connectionIsReadOnly) return;
    setCreateError(null);
    setCreateItemType(FileType.FILE);
    setCreateDialogOpen(true);
  }, [connectionIsReadOnly]);

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!connectionId) return;
      if (connectionIsReadOnly) return;

      setIsCreating(true);
      setCreateError(null);
      try {
        const parentPath = currentPathRef.current;
        await api.createItem(connectionId, parentPath, name, createItemType === FileType.DIRECTORY ? "directory" : "file");

        setCreateDialogOpen(false);
        pendingFocusNameRef.current = name;

        lastForceReloadRef.current = Date.now();
        loadFilesRef.current?.(currentPathRef.current, true);
        listContainerEl?.focus();

        logger.info(`Created ${createItemType}: ${name}`, undefined, "file-browser");
      } catch (err: unknown) {
        let detail = "Failed to create item.";
        if (isApiError(err) && err.response?.data?.detail) {
          detail = err.response.data.detail;
        }
        setCreateError(detail);
        logger.error(`Create failed: ${name}`, { error: err }, "file-browser");
      } finally {
        setIsCreating(false);
      }
    },
    [connectionIsReadOnly, connectionId, createItemType, listContainerEl]
  );

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setCreateError(null);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Companion App
  // ──────────────────────────────────────────────────────────────────────────

  const handleOpenInApp = useCallback(
    async (options?: { forcePicker?: boolean }) => {
      if (!connectionId) return;
      const file = filesRef.current[focusedIndex];
      if (!file || file.type === "directory") return;
      await openNativeFile(file, options);
    },
    [connectionId, focusedIndex, openNativeFile]
  );

  const handleOpenInAppForFile = useCallback(
    async (file: FileEntry, _index: number, options?: { forcePicker?: boolean }) => {
      if (!connectionId || file.type === "directory") return;
      await openNativeFile(file, options);
    },
    [connectionId, openNativeFile]
  );

  const closeBrowserViewerPicker = useCallback(() => {
    setBrowserViewerPickerState(null);
  }, []);

  const confirmBrowserViewerPicker = useCallback(
    async (selection: { viewerId: "image" | "markdown" | "pdf" | null; rememberSelection: boolean }) => {
      const pickerState = browserViewerPickerState;
      if (!pickerState) {
        return;
      }

      setBrowserViewerPickerState(null);

      const activeDirectoryFile = filesRef.current.find(
        (entry) => (currentPathRef.current ? `${currentPathRef.current}/${entry.name}` : entry.name) === pickerState.filePath
      );
      const file = activeDirectoryFile ?? ({ name: pickerState.fileName, type: "file", mime_type: pickerState.mimeType } as FileEntry);
      if (file.type === "directory") {
        return;
      }
      const targetConnectionId = pickerState.connectionId ?? connectionIdRef.current;

      if (selection.viewerId === null) {
        await openNativeFile(file, undefined, { connectionId: targetConnectionId, path: pickerState.filePath });
        return;
      }

      if (selection.rememberSelection) {
        await setPreferredViewerId(file.name, pickerState.mimeType, selection.viewerId);
      }

      openFileInViewer(file, pickerState.filePath, pickerState.mimeType, selection.viewerId, targetConnectionId);
    },
    [browserViewerPickerState, openFileInViewer, openNativeFile]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket Integration
  // ──────────────────────────────────────────────────────────────────────────

  const handleDirectoryChanged = useCallback((changedConnectionId: string, changedPath: string) => {
    // Invalidate cache for the changed directory
    const cacheKey = `${changedConnectionId}:${changedPath}`;
    directoryCache.current.delete(cacheKey);

    // Reload if this pane is currently viewing the affected directory
    if (changedConnectionId === connectionIdRef.current && changedPath === currentPathRef.current) {
      if (Date.now() - lastForceReloadRef.current < RELOAD_DEDUP_WINDOW_MS) {
        logger.info("Skipping redundant WebSocket reload (recent forced reload)", undefined, "websocket");
      } else {
        loadFilesRef.current?.(changedPath, true);
      }
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Cache Management
  // ──────────────────────────────────────────────────────────────────────────

  const clearCaches = useCallback(() => {
    directoryCache.current.clear();
    navigationHistory.current.clear();
  }, []);

  const invalidateConnectionCache = useCallback((targetConnectionId: string) => {
    for (const key of directoryCache.current.keys()) {
      if (key.startsWith(`${targetConnectionId}:`)) {
        directoryCache.current.delete(key);
      }
    }
  }, []);

  const captureRecoverySnapshot = useCallback((): FileBrowserPaneRecoverySnapshot | null => {
    if (!connectionIdRef.current) {
      return null;
    }

    const focusedFileName = filesRef.current[focusedIndex]?.name ?? null;
    const currentScrollOffset = parentRef.current?.scrollTop ?? 0;

    return {
      connectionId: connectionIdRef.current,
      path: currentPathRef.current,
      items: [...files],
      sortBy,
      sortDirection,
      viewMode,
      focusedIndex,
      focusedFileName,
      selectedFileNames: Array.from(selectedFiles),
      viewInfo: viewInfo
        ? {
            ...viewInfo,
            images: viewInfo.images ? [...viewInfo.images] : undefined,
          }
        : null,
      scrollOffset: currentScrollOffset,
    };
  }, [files, focusedIndex, selectedFiles, sortBy, sortDirection, viewInfo, viewMode]);

  const restoreRecoverySnapshot = useCallback(
    (snapshot: FileBrowserPaneRecoverySnapshot | null) => {
      if (!snapshot?.connectionId) {
        return;
      }

      const normalizedPath = normalizeLocalDrivePath(snapshot.connectionId, snapshot.path);
      if (connectionIdRef.current !== snapshot.connectionId || currentPathRef.current !== normalizedPath) {
        clearIncrementalSearch();
      }

      const nextCacheKey = `${snapshot.connectionId}:${snapshot.path}`;
      const nextItems = [...snapshot.items];
      const nextFocusedIndex = Math.max(snapshot.focusedIndex, 0);
      const nextSelectedFiles = new Set(snapshot.selectedFileNames);
      pendingLocationRef.current = null;
      pendingDirectoryEntryIntentRef.current = { kind: "restore-history" };
      pendingFocusNameRef.current = null;
      pendingSelectedFilesRestoreRef.current = nextSelectedFiles;

      directoryLoadAbortRef.current?.abort();
      directoryLoadAbortRef.current = null;
      latestLoadRequestIdRef.current += 1;

      directoryCache.current.clear();
      directoryCache.current.set(nextCacheKey, {
        items: nextItems,
        timestamp: Date.now(),
      });

      navigationHistory.current.clear();
      navigationHistory.current.set(snapshot.path, {
        focusedIndex: nextFocusedIndex,
        scrollOffset: Math.max(snapshot.scrollOffset, 0),
        selectedFileName: snapshot.focusedFileName,
      });

      currentViewIndexRef.current = snapshot.viewInfo?.currentIndex ?? null;
      currentViewImagesRef.current = snapshot.viewInfo?.images ? [...snapshot.viewInfo.images] : undefined;

      setSortBy(snapshot.sortBy);
      setSortDirection(snapshot.sortDirection);
      setViewMode(snapshot.viewMode);
      setFocusedIndex(nextFocusedIndex);
      setSelectedFiles(nextSelectedFiles);
      setViewInfo(
        snapshot.viewInfo
          ? {
              ...snapshot.viewInfo,
              images: snapshot.viewInfo.images ? [...snapshot.viewInfo.images] : undefined,
            }
          : null
      );
      setConnectionId(snapshot.connectionId);
      setCurrentPath(normalizedPath);
      setFiles(nextItems);
      setLoading(false);
      setError(null);
    },
    [clearIncrementalSearch, setViewMode]
  );

  const applyLocation = useCallback(
    (nextConnectionId: string, nextPath: string, routeSyncToken?: number) => {
      if (routeSyncToken !== undefined) {
        if (routeSyncToken < lastAppliedRouteSyncTokenRef.current) {
          return;
        }

        lastAppliedRouteSyncTokenRef.current = routeSyncToken;
      }

      const normalizedPath = normalizeLocalDrivePath(nextConnectionId, nextPath);

      const pendingLocation = pendingLocationRef.current;
      const matchedPendingLocation =
        pendingLocation !== null && pendingLocation.connectionId === nextConnectionId && pendingLocation.path === normalizedPath;
      if (pendingLocation) {
        if (matchedPendingLocation) {
          pendingLocationRef.current = null;
        } else {
          return;
        }
      }

      const connectionChanged = connectionIdRef.current !== nextConnectionId;

      if (connectionChanged) {
        clearIncrementalSearch();
        const nextCacheKey = `${nextConnectionId}:${normalizedPath}`;
        const seededSnapshot = directoryCache.current.get(nextCacheKey);
        pendingDirectoryEntryIntentRef.current = { kind: "fresh" };
        prepareDirectoryTransition(nextConnectionId, normalizedPath);
        setConnectionId(nextConnectionId);
        setCurrentPath(normalizedPath);
        setViewInfo(null);
        setSelectedFiles(new Set());
        directoryCache.current.clear();
        if (seededSnapshot) {
          directoryCache.current.set(nextCacheKey, seededSnapshot);
        }
        navigationHistory.current.clear();
        writeSelectedConnectionIdPreference(nextConnectionId || null);
        return;
      }

      if (currentPathRef.current !== normalizedPath) {
        clearIncrementalSearch();
        if (!matchedPendingLocation) {
          pendingDirectoryEntryIntentRef.current = { kind: "restore-history" };
        }
        prepareDirectoryTransition(nextConnectionId, normalizedPath);
        setCurrentPath(normalizedPath);
        setViewInfo(null);
        setSelectedFiles(new Set());
      }
    },
    [clearIncrementalSearch, prepareDirectoryTransition]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Incremental Search (keydown handler)
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e?: KeyboardEvent) => {
      if (!e) return;
      if (disabled || viewInfo) return;
      if (e.defaultPrevented) return;

      const target = e.target as HTMLElement;
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isInInput) {
        const input = target as HTMLInputElement;

        // Quick-bar inputs own their keyboard interaction. File-list handlers
        // must not react while focus remains inside the quick bar.
        if (input.dataset.quickBarInput === "true") {
          return;
        }

        const allowedKeysInInput = ["?", "Escape"];
        if (allowedKeysInInput.includes(e.key)) return;
        return;
      }

      if (viewInfo) return;

      // Incremental search — only when file list has focus
      if (!listContainerEl) return;
      const activeElement = document.activeElement;
      if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

      const currentFiles = filesRef.current;
      const fileCount = currentFiles.length;

      const shortcutKeys = ["?", "Escape"];
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " " && !shortcutKeys.includes(e.key) && fileCount > 0) {
        e.preventDefault();

        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }

        searchBufferRef.current += e.key.toLowerCase();

        const index = currentFiles.findIndex((f: FileEntry) => f.name.toLowerCase().startsWith(searchBufferRef.current));
        if (index !== -1) {
          updateFocus(index);
        }

        searchTimeoutRef.current = window.setTimeout(() => {
          searchBufferRef.current = "";
        }, 1000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [disabled, viewInfo, updateFocus, listContainerEl]);

  // ──────────────────────────────────────────────────────────────────────────
  // Return
  // ──────────────────────────────────────────────────────────────────────────

  return {
    // Core state
    connectionId,
    setConnectionId,
    currentPath,
    setCurrentPath,
    files,
    loading,
    error,
    setError,

    // UI preferences
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    viewMode,
    setViewMode,
    focusedIndex,

    // Selection (multi-select)
    selectedFiles,
    handleToggleSelection,
    handleSelectDown,
    handleSelectUp,
    handleSelectAll,
    handleClearSelection,
    getEffectiveSelection,

    // Computed
    sortedFiles,
    imageFiles,
    directorySearchProvider,

    // Viewer
    viewInfo,
    setViewInfo,
    browserViewerPickerState,

    // Dialog state
    deleteDialogOpen,
    deleteTargets,
    isDeleting,
    renameDialogOpen,
    renameTarget,
    isRenaming,
    renameError,
    createDialogOpen,
    createItemType,
    isCreating,
    createError,
    openInAppLoading,

    // Refs
    parentRef,
    searchInputRef,
    listContainerRef,
    listContainerEl,
    filesRef,
    connectionIdRef,
    currentPathRef,

    // Virtualizer
    rowVirtualizer,

    // Navigation
    handleFileClick,
    handleConnectionChange,
    handleNavigateDown,
    handleArrowUp,
    handleHome,
    handleEnd,
    handlePageDown,
    handlePageUp,
    handleOpenFile,
    handleOpenFileForFile,
    handleOpenFileAtPath,
    navigateToPath,
    prepareDirectoryTransition,
    handleNavigateUpDirectory,
    handleNavigateUp,
    handleClose,
    handleFocusSearch,
    handleRefresh,
    forceReloadCurrentDirectory,

    // Viewer
    handleViewIndexChange,
    handleViewClose,
    closeBrowserViewerPicker,
    confirmBrowserViewerPicker,

    // CRUD dialogs
    handleDeleteRequest,
    handleDeleteConfirm,
    closeDeleteDialog,
    handleRenameRequest,
    handleRenameConfirm,
    handleRenameForFile,
    closeRenameDialog,
    handleNewDirectoryRequest,
    handleNewFileRequest,
    handleCreateConfirm,
    closeCreateDialog,

    // Companion
    handleOpenInApp,
    handleOpenInAppForFile,

    // WebSocket
    handleDirectoryChanged,

    // Cache
    clearCaches,
    invalidateConnectionCache,
    loadFiles,
    seedDirectorySnapshot,
    applyLocation,
    captureRecoverySnapshot,
    restoreRecoverySnapshot,
  };
}
