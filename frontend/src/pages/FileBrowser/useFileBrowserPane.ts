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
import { useSambeeTheme } from "../../theme";
import type { FileEntry } from "../../types";
import { FileType, isApiError } from "../../types";
import { hasViewerSupport, isImageFile } from "../../utils/FileTypeRegistry";
import { compareLocalizedStrings } from "../../utils/localeFormatting";
import { getConnectionById, isConnectionReadOnly } from "./access";
import {
  useFileBrowserViewModePreference,
  useQuickNavIncludeDotDirectoriesPreference,
  writeSelectedConnectionIdPreference,
} from "./preferences";
import type { FileBrowserPaneRecoverySnapshot, SortField, UseFileBrowserPaneConfig, UseFileBrowserPaneReturn } from "./types";

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

// ============================================================================
// Helpers
// ============================================================================

/** Generate a unique viewer session id for logging. */
const createViewerSessionId = (): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart}`;
};

// ============================================================================
// Hook
// ============================================================================

export function useFileBrowserPane(config: UseFileBrowserPaneConfig): UseFileBrowserPaneReturn {
  const { rowHeight, connections = [], disabled = false, isActive = true, onCompanionHint, onNavigatePath, onNavigateConnection } = config;

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
  const [currentDirectoryFilter, setCurrentDirectoryFilter] = useState("");
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

  // ──────────────────────────────────────────────────────────────────────────
  // CRUD Dialog State
  // ──────────────────────────────────────────────────────────────────────────

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
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
    (nextPath: string, options?: { blurActiveElement?: boolean }) => {
      const nextConnectionId = connectionIdRef.current;
      if (!nextConnectionId) {
        return;
      }

      const normalizedPath = normalizeLocalDrivePath(nextConnectionId, nextPath);

      pendingLocationRef.current = {
        connectionId: nextConnectionId,
        path: normalizedPath,
      };

      prepareDirectoryTransition(nextConnectionId, normalizedPath);
      setCurrentPath(normalizedPath);
      setViewInfo(null);
      onNavigatePath?.(normalizedPath);

      if (options?.blurActiveElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [onNavigatePath, prepareDirectoryTransition]
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

  const [visibleRowCount, setVisibleRowCount] = useState(10);
  const visibleRowCountRef = React.useRef<number>(10);

  const searchBufferRef = React.useRef<string>("");
  const searchTimeoutRef = React.useRef<number | null>(null);

  const navigationHistory = React.useRef<Map<string, { focusedIndex: number; scrollOffset: number; selectedFileName: string | null }>>(
    new Map()
  );

  const directoryCache = React.useRef<Map<string, { items: FileEntry[]; timestamp: number }>>(new Map());

  const pendingFocusNameRef = React.useRef<string | null>(null);
  const pendingParentDirectoryRestoreNameRef = React.useRef<string | null>(null);
  const pendingFilterRestoreRef = React.useRef<{ scope: string; value: string } | null>(null);
  const pendingSelectedFilesRestoreRef = React.useRef<Set<string> | null>(null);
  const lastAppliedRouteSyncTokenRef = React.useRef<number>(0);
  const lastForceReloadRef = React.useRef<number>(0);
  const previousFilterScopeRef = React.useRef<string | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Ref Sync Effects
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const nextFilterScope = `${connectionId}:${currentPath}`;

    if (previousFilterScopeRef.current === null) {
      previousFilterScopeRef.current = nextFilterScope;
      return;
    }

    if (previousFilterScopeRef.current !== nextFilterScope) {
      previousFilterScopeRef.current = nextFilterScope;

      if (pendingFilterRestoreRef.current?.scope === nextFilterScope) {
        setCurrentDirectoryFilter(pendingFilterRestoreRef.current.value);
        pendingFilterRestoreRef.current = null;
        return;
      }

      setCurrentDirectoryFilter("");
    }
  }, [connectionId, currentPath]);

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
      } catch (err) {
        if (abortController.signal.aborted || isLocalAbortError(err)) {
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
    [connectionId]
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
  // Sort & Filter (computed)
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

  const sortedAndFilteredFiles = useMemo(() => {
    const normalizedFilter = currentDirectoryFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return sortedFiles;
    }

    return sortedFiles.filter((file) => file.name.toLowerCase().includes(normalizedFilter));
  }, [currentDirectoryFilter, sortedFiles]);

  /** Image files in display order — used for gallery mode. */
  const imageFiles = useMemo(() => {
    return sortedAndFilteredFiles
      .filter((f: FileEntry) => f.type === "file" && isImageFile(f.name))
      .map((f: FileEntry) => (currentPath ? `${currentPath}/${f.name}` : f.name));
  }, [sortedAndFilteredFiles, currentPath]);

  // ──────────────────────────────────────────────────────────────────────────
  // Virtualizer
  // ──────────────────────────────────────────────────────────────────────────

  const measureElement = React.useMemo(
    () =>
      typeof window !== "undefined" && navigator.userAgent.includes("Firefox")
        ? undefined
        : (element: Element) => element.getBoundingClientRect().height,
    []
  );

  const rowVirtualizer = useVirtualizer({
    count: sortedAndFilteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    measureElement,
    getItemKey: (index: number) => sortedAndFilteredFiles[index]?.name ?? index,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
    enabled: true,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Focus-Restore / Scroll Effects
  // ──────────────────────────────────────────────────────────────────────────

  const prevPathForFocusRef = React.useRef<string>(currentPath);
  const pendingPathFocusResetRef = React.useRef<boolean>(true);
  const prevFocusedIndexRef = React.useRef<number>(0);
  const skipNextLayoutScrollRef = React.useRef<boolean>(false);
  const skipNextFilterFocusAdjustmentRef = React.useRef<boolean>(false);
  const lastRestoredPathRef = React.useRef<string | null>(null);
  const previousVisibleFilesRef = React.useRef<FileEntry[]>(sortedAndFilteredFiles);
  const previousFilterRef = React.useRef<string>(currentDirectoryFilter);
  const previousFilterScopeForFocusRef = React.useRef<string>(`${connectionId}:${currentPath}`);

  // Keep filesRef updated and restore or reset focused index when files change
  useEffect(() => {
    filesRef.current = sortedAndFilteredFiles;

    if (currentPath !== prevPathForFocusRef.current) {
      prevPathForFocusRef.current = currentPath;
      pendingFocusNameRef.current = null;
      pendingPathFocusResetRef.current = true;
    }

    const savedState = navigationHistory.current.get(currentPath);
    if (savedState) {
      const restoredIndex = savedState.selectedFileName
        ? sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === savedState.selectedFileName)
        : Math.min(savedState.focusedIndex, Math.max(sortedAndFilteredFiles.length - 1, 0));

      if (restoredIndex >= 0) {
        lastRestoredPathRef.current = currentPath;
        pendingPathFocusResetRef.current = false;
        skipNextFilterFocusAdjustmentRef.current = true;
        updateFocus(restoredIndex, { immediate: true });
        requestAnimationFrame(() => {
          if (parentRef.current) {
            parentRef.current.scrollTop = savedState.scrollOffset;
          }
        });
        navigationHistory.current.delete(currentPath);
        return;
      }
      return;
    }

    const pendingParentDirectoryRestoreName = pendingParentDirectoryRestoreNameRef.current;
    if (pendingParentDirectoryRestoreName !== null) {
      const restoreIndex = sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === pendingParentDirectoryRestoreName);
      if (restoreIndex >= 0) {
        pendingPathFocusResetRef.current = false;
        pendingParentDirectoryRestoreNameRef.current = null;
        skipNextFilterFocusAdjustmentRef.current = true;
        updateFocus(restoreIndex, { immediate: true });
        rowVirtualizer.scrollToIndex(restoreIndex, { align: "auto" });
      }
      return;
    }

    const pendingName = pendingFocusNameRef.current;
    if (pendingName !== null) {
      const idx = sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === pendingName);
      if (idx >= 0) {
        pendingPathFocusResetRef.current = false;
        updateFocus(idx, { immediate: true });
        rowVirtualizer.scrollToIndex(idx, { align: "auto" });
      }
      return;
    }

    if (pendingPathFocusResetRef.current) {
      pendingPathFocusResetRef.current = false;
      updateFocus(0, { immediate: true });
      rowVirtualizer.scrollToIndex(0, { align: "start" });
    }
  }, [sortedAndFilteredFiles, currentPath, updateFocus, rowVirtualizer]);

  useEffect(() => {
    const filterScope = `${connectionId}:${currentPath}`;
    const previousFilterScope = previousFilterScopeForFocusRef.current;
    previousFilterScopeForFocusRef.current = filterScope;

    const previousFilter = previousFilterRef.current;
    previousFilterRef.current = currentDirectoryFilter;

    const previousVisibleFiles = previousVisibleFilesRef.current;
    previousVisibleFilesRef.current = sortedAndFilteredFiles;

    if (previousFilterScope !== filterScope) {
      return;
    }

    if (previousFilter === currentDirectoryFilter) {
      return;
    }

    if (skipNextFilterFocusAdjustmentRef.current) {
      skipNextFilterFocusAdjustmentRef.current = false;
      return;
    }

    if (sortedAndFilteredFiles.length === 0) {
      return;
    }

    const previousFocusedFileName = previousVisibleFiles[focusedIndex]?.name;
    if (!previousFocusedFileName) {
      const clampedIndex = Math.min(focusedIndex, sortedAndFilteredFiles.length - 1);
      updateFocus(Math.max(clampedIndex, 0), { immediate: true });
      return;
    }

    const retainedIndex = sortedAndFilteredFiles.findIndex((file) => file.name === previousFocusedFileName);
    if (retainedIndex >= 0) {
      updateFocus(retainedIndex, { immediate: true });
      return;
    }

    const clampedIndex = Math.min(focusedIndex, sortedAndFilteredFiles.length - 1);
    updateFocus(Math.max(clampedIndex, 0), { immediate: true });
  }, [connectionId, currentDirectoryFilter, currentPath, focusedIndex, sortedAndFilteredFiles, updateFocus]);

  // Scroll focused item into view
  useLayoutEffect(() => {
    if (focusedIndex >= 0) {
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
  }, [focusedIndex, visibleRowCount, rowVirtualizer]);

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

  // Focus the list container when it first mounts or directory contents change.
  // In dual-pane mode, only the currently active pane may auto-focus.
  useEffect(() => {
    const fileCount = files.length;

    if (isActive && listContainerEl && !viewInfo && fileCount >= 0) {
      listContainerEl.focus();
    }
  }, [files.length, isActive, listContainerEl, viewInfo]);

  // ──────────────────────────────────────────────────────────────────────────
  // Connection Change
  // ──────────────────────────────────────────────────────────────────────────

  const handleConnectionChange = useCallback(
    (newConnectionId: string) => {
      if (newConnectionId === connectionId) return;
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
    [connectionId, onNavigateConnection, prepareDirectoryTransition]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // File Click / Viewer
  // ──────────────────────────────────────────────────────────────────────────

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
        logger.info("Navigating to directory", { from: currentPath, to: newPath, directory: file.name }, "browser");

        navigateToPath(newPath, { blurActiveElement: true });
      } else {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        const viewerSessionId = createViewerSessionId();
        const mimeType = file.mime_type || "application/octet-stream";
        const isImage = isImageFile(file.name);

        logger.info(
          "File selected for viewing",
          { path: filePath, fileName: file.name, size: file.size, mimeType, isImage, imageFilesCount: imageFiles.length },
          "viewer"
        );

        if (isImage && imageFiles.length > 0) {
          const imageIndex = imageFiles.indexOf(filePath);
          const effectiveIndex = imageIndex >= 0 ? imageIndex : 0;
          currentViewIndexRef.current = effectiveIndex;
          currentViewImagesRef.current = imageFiles;
          setViewInfo({ path: filePath, mimeType, images: imageFiles, currentIndex: effectiveIndex, sessionId: viewerSessionId });
        } else {
          currentViewIndexRef.current = null;
          currentViewImagesRef.current = undefined;
          const canView = hasViewerSupport(mimeType);

          if (canView) {
            setViewInfo({ path: filePath, mimeType, sessionId: viewerSessionId });
          } else {
            logger.info("No viewer component available, file will not open", { mimeType }, "viewer");
          }
        }
      }
    },
    [currentPath, updateFocus, imageFiles, focusedIndex, navigateToPath]
  );

  const handleViewIndexChange = useCallback((index: number) => {
    currentViewIndexRef.current = index;
    setViewInfo((prev) => {
      if (!prev?.images || prev.images.length === 0) return prev;
      const nextPath = prev.images[index] ?? prev.path;
      if (prev.currentIndex === index && prev.path === nextPath) return prev;
      return { ...prev, currentIndex: index, path: nextPath };
    });
  }, []);

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

    if (!finalPath) return;

    const targetIndex = sortedAndFilteredFiles.findIndex((file: FileEntry) => {
      if (file.type !== "file") return false;
      const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      return fullPath === finalPath;
    });

    if (targetIndex >= 0) {
      updateFocus(targetIndex, { immediate: true });
    }
  }, [currentPath, viewInfo, sortedAndFilteredFiles, updateFocus]);

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

  const handleOpenFile = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

    const file = filesRef.current[focusedIndex];
    if (file) {
      handleFileClick(file, focusedIndex);
    }
  }, [focusedIndex, handleFileClick, listContainerEl]);

  const handleNavigateUpDirectory = useCallback(() => {
    if (!currentPathRef.current) return;
    const pathParts = currentPathRef.current.split("/");
    const childDirectoryName = pathParts[pathParts.length - 1] || null;
    const parentPath = pathParts.slice(0, -1).join("/");

    pendingParentDirectoryRestoreNameRef.current = childDirectoryName;

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
    setSelectedFiles(new Set());
  }, []);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const clearCurrentDirectoryFilter = useCallback(() => {
    setCurrentDirectoryFilter("");
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

  const handleDeleteRequest = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

    const file = filesRef.current[focusedIndex];
    if (!file) return;
    if (connectionIsReadOnly) return;

    setDeleteTarget(file);
    setDeleteDialogOpen(true);
  }, [connectionIsReadOnly, focusedIndex, listContainerEl]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || !connectionId) return;
    if (connectionIsReadOnly) return;

    setIsDeleting(true);
    try {
      await api.deleteItem(connectionId, deleteTarget.path);

      setDeleteDialogOpen(false);
      setDeleteTarget(null);

      lastForceReloadRef.current = Date.now();
      loadFilesRef.current?.(currentPathRef.current, true);

      const newLength = filesRef.current.length - 1;
      if (focusedIndex >= newLength && newLength > 0) {
        setFocusedIndex(newLength - 1);
      }

      logger.info(`Deleted: ${deleteTarget.path}`, undefined, "file-browser");
    } catch (err: unknown) {
      let detail = "Failed to delete item.";
      if (isApiError(err) && err.response?.data?.detail) {
        detail = err.response.data.detail;
      }
      setError(detail);
      logger.error(`Delete failed: ${deleteTarget.path}`, { error: err }, "file-browser");
    } finally {
      setIsDeleting(false);
    }
  }, [connectionIsReadOnly, deleteTarget, connectionId, focusedIndex]);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Rename
  // ──────────────────────────────────────────────────────────────────────────

  const handleRenameRequest = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

    const file = filesRef.current[focusedIndex];
    if (!file) return;
    if (connectionIsReadOnly) return;

    setRenameError(null);
    setRenameTarget(file);
    setRenameDialogOpen(true);
  }, [connectionIsReadOnly, focusedIndex, listContainerEl]);

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

  const handleOpenInApp = useCallback(async () => {
    if (!connectionId) return;
    const file = filesRef.current[focusedIndex];
    if (!file || file.type === "directory") return;
    if (connectionIsReadOnly && !isLocalDrive(connectionId)) return;

    const filePath = currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name;

    setOpenInAppLoading(true);
    try {
      if (isLocalDrive(connectionId)) {
        // Direct local open — no download/lock/upload cycle
        await api.openLocalFile(connectionId, filePath);
        logger.info("Opened local file directly", { path: filePath }, "companion");
      } else {
        const themeJson = JSON.stringify({
          id: currentTheme.id,
          mode: currentTheme.mode,
          primary: currentTheme.primary.main,
        });
        const uri = await api.getCompanionUri(connectionId, filePath, themeJson);
        logger.info("Opening file in companion app", { path: filePath }, "companion");
        window.location.href = uri;
        onCompanionHint?.();
      }
    } catch (err: unknown) {
      let detail = "Failed to open file.";
      if (isApiError(err) && err.response?.data?.detail) {
        detail = err.response.data.detail;
      }
      setError(detail);
      logger.error(`Open in app failed: ${filePath}`, { error: err }, "companion");
    } finally {
      setOpenInAppLoading(false);
    }
  }, [connectionId, connectionIsReadOnly, focusedIndex, currentTheme, onCompanionHint]);

  const handleOpenInAppForFile = useCallback(
    async (file: FileEntry, _index: number) => {
      if (!connectionId || file.type === "directory") return;
      if (connectionIsReadOnly && !isLocalDrive(connectionId)) return;
      const filePath = currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name;

      setOpenInAppLoading(true);
      try {
        if (isLocalDrive(connectionId)) {
          // Direct local open — no download/lock/upload cycle
          await api.openLocalFile(connectionId, filePath);
          logger.info("Opened local file directly (context menu)", { path: filePath }, "companion");
        } else {
          const themeJson = JSON.stringify({
            id: currentTheme.id,
            mode: currentTheme.mode,
            primary: currentTheme.primary.main,
          });
          const uri = await api.getCompanionUri(connectionId, filePath, themeJson);
          logger.info("Opening file in companion app (context menu)", { path: filePath }, "companion");
          window.location.href = uri;
          onCompanionHint?.();
        }
      } catch (err: unknown) {
        let detail = "Failed to open file.";
        if (isApiError(err) && err.response?.data?.detail) {
          detail = err.response.data.detail;
        }
        setError(detail);
        logger.error(`Open in app failed: ${filePath}`, { error: err }, "companion");
      } finally {
        setOpenInAppLoading(false);
      }
    },
    [connectionId, connectionIsReadOnly, currentTheme, onCompanionHint]
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
      currentDirectoryFilter,
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
  }, [currentDirectoryFilter, files, focusedIndex, selectedFiles, sortBy, sortDirection, viewInfo, viewMode]);

  const restoreRecoverySnapshot = useCallback(
    (snapshot: FileBrowserPaneRecoverySnapshot | null) => {
      if (!snapshot?.connectionId) {
        return;
      }

      const nextCacheKey = `${snapshot.connectionId}:${snapshot.path}`;
      const nextItems = [...snapshot.items];
      const nextFocusedIndex = Math.max(snapshot.focusedIndex, 0);
      const nextSelectedFiles = new Set(snapshot.selectedFileNames);
      const nextFilterScope = `${snapshot.connectionId}:${snapshot.path}`;

      pendingLocationRef.current = null;
      pendingFocusNameRef.current = snapshot.focusedFileName;
      pendingParentDirectoryRestoreNameRef.current = null;
      pendingFilterRestoreRef.current = {
        scope: nextFilterScope,
        value: snapshot.currentDirectoryFilter,
      };
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
      setCurrentDirectoryFilter(snapshot.currentDirectoryFilter);
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
      const normalizedPath = normalizeLocalDrivePath(snapshot.connectionId, snapshot.path);
      setConnectionId(snapshot.connectionId);
      setCurrentPath(normalizedPath);
      setFiles(nextItems);
      setLoading(false);
      setError(null);
    },
    [setViewMode]
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
      if (pendingLocation) {
        if (pendingLocation.connectionId === nextConnectionId && pendingLocation.path === normalizedPath) {
          pendingLocationRef.current = null;
        } else {
          return;
        }
      }

      const connectionChanged = connectionIdRef.current !== nextConnectionId;

      if (connectionChanged) {
        const nextCacheKey = `${nextConnectionId}:${normalizedPath}`;
        const seededSnapshot = directoryCache.current.get(nextCacheKey);
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
        prepareDirectoryTransition(nextConnectionId, normalizedPath);
        setCurrentPath(normalizedPath);
        setViewInfo(null);
        setSelectedFiles(new Set());
      }
    },
    [prepareDirectoryTransition]
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
        // Backspace on empty search input → navigate up
        if (e.key === "Backspace" && (target as HTMLInputElement).value === "" && currentPathRef.current) {
          const input = target as HTMLInputElement;
          if (input.selectionStart === 0 && input.selectionEnd === 0) {
            e.preventDefault();
            handleNavigateUpDirectory();
            return;
          }
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
  }, [disabled, handleNavigateUpDirectory, viewInfo, updateFocus, listContainerEl]);

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
    currentDirectoryFilter,
    setCurrentDirectoryFilter,
    clearCurrentDirectoryFilter,
    isCurrentDirectoryFilterActive: currentDirectoryFilter.trim().length > 0,
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
    sortedAndFilteredFiles,
    imageFiles,
    directorySearchProvider,

    // Viewer
    viewInfo,
    setViewInfo,

    // Dialog state
    deleteDialogOpen,
    deleteTarget,
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
