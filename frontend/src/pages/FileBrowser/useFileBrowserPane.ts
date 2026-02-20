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
import { logger } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import type { FileEntry } from "../../types";
import { FileType, isApiError } from "../../types";
import { hasViewerSupport, isImageFile } from "../../utils/FileTypeRegistry";
import type { SortField, UseFileBrowserPaneConfig, UseFileBrowserPaneReturn, ViewMode } from "./types";

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
  const { rowHeight, disabled = false, isActive = true, onCompanionHint } = config;

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
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("file-browser-view-mode");
    return saved === "list" || saved === "details" ? saved : "list";
  });
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

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

  // ──────────────────────────────────────────────────────────────────────────
  // Search Provider
  // ──────────────────────────────────────────────────────────────────────────

  const directorySearchProvider = useDirectorySearchProvider(connectionId, (path) => setCurrentPath(path));

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
  const loadFilesRef = React.useRef<(path: string, forceRefresh?: boolean) => Promise<void>>();

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

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem("file-browser-view-mode", viewMode);
  }, [viewMode]);

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
    async (path: string, forceRefresh = false) => {
      if (!connectionId) return;

      const cacheKey = `${connectionId}:${path}`;
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

      setLoading(true);
      setError(null);

      try {
        const listing = await api.listDirectory(connectionId, path);
        const items = listing.items ?? [];
        directoryCache.current.set(cacheKey, { items, timestamp: now });
        setFiles(items);
      } catch (err) {
        logger.error("Error loading directory", { error: err, connectionId, path }, "browser");

        let errorMessage = "Failed to load directory contents. Please try again.";

        if (err && typeof err === "object" && "message" in err && !isApiError(err)) {
          const error = err as Error & { code?: string };
          const message = error.message;
          if (message.includes("Network Error") || message.includes("ECONNREFUSED") || error.code === "ECONNREFUSED") {
            errorMessage = "Failed to load files. Please check your connection settings.";
          }
        } else if (isApiError(err)) {
          if (err.response?.status === 404) {
            const detail = err.response?.data?.detail;
            errorMessage = detail || "Directory not found. It may have been removed or renamed.";
          } else if (err.response?.data?.detail) {
            errorMessage = err.response.data.detail;
          }
        }

        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  // Load files when connection or path changes
  useEffect(() => {
    if (connectionId) {
      loadFilesRef.current?.(currentPath);
    }
  }, [currentPath, connectionId]);

  // ──────────────────────────────────────────────────────────────────────────
  // Sort & Filter (computed)
  // ──────────────────────────────────────────────────────────────────────────

  const sortedAndFilteredFiles = useMemo(() => {
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
          comparison = a.name.localeCompare(b.name);
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
          comparison = extA.localeCompare(extB);
          if (comparison === 0) {
            comparison = a.name.localeCompare(b.name);
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
  const prevFocusedIndexRef = React.useRef<number>(0);
  const skipNextLayoutScrollRef = React.useRef<boolean>(false);
  const lastRestoredPathRef = React.useRef<string | null>(null);

  // Keep filesRef updated and restore or reset focused index when files change
  useEffect(() => {
    filesRef.current = sortedAndFilteredFiles;

    if (currentPath !== prevPathForFocusRef.current) {
      prevPathForFocusRef.current = currentPath;
      pendingFocusNameRef.current = null;
    }

    const savedState = navigationHistory.current.get(currentPath);
    if (savedState?.selectedFileName) {
      const restoredIndex = sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === savedState.selectedFileName);
      if (restoredIndex >= 0) {
        lastRestoredPathRef.current = currentPath;
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

    const pendingName = pendingFocusNameRef.current;
    if (pendingName !== null) {
      const idx = sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === pendingName);
      if (idx >= 0) {
        updateFocus(idx, { immediate: true });
        rowVirtualizer.scrollToIndex(idx, { align: "auto" });
      }
      return;
    }

    if (lastRestoredPathRef.current !== currentPath) {
      updateFocus(0, { immediate: true });
      rowVirtualizer.scrollToIndex(0, { align: "start" });
    }
  }, [sortedAndFilteredFiles, currentPath, updateFocus, rowVirtualizer]);

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
  // In dual-pane mode, only the active pane auto-focuses to avoid stealing focus.
  const isActiveRef = React.useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: files.length is a deliberate trigger dependency; isActiveRef is a stable ref
  useEffect(() => {
    if (isActiveRef.current && listContainerEl && !viewInfo) {
      listContainerEl.focus();
    }
  }, [listContainerEl, files.length, viewInfo]);

  // ──────────────────────────────────────────────────────────────────────────
  // Connection Change
  // ──────────────────────────────────────────────────────────────────────────

  const handleConnectionChange = useCallback(
    (newConnectionId: string) => {
      if (newConnectionId === connectionId) return;
      setConnectionId(newConnectionId);
      setCurrentPath("");
      setViewInfo(null);
      setFiles([]);
      directoryCache.current.clear();
      navigationHistory.current.clear();
      localStorage.setItem("selectedConnectionId", newConnectionId);
    },
    [connectionId]
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

        setCurrentPath(newPath);
        setViewInfo(null);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
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
    [currentPath, updateFocus, imageFiles, focusedIndex]
  );

  const handleViewIndexChange = useCallback((index: number) => {
    currentViewIndexRef.current = index;
    setViewInfo((prev) => {
      if (!prev || !prev.images || prev.images.length === 0) return prev;
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
    if (currentPathRef.current) {
      const pathParts = currentPathRef.current.split("/");
      const newPath = pathParts.slice(0, -1).join("/");
      setCurrentPath(newPath);
      setViewInfo(null);
    }
  }, []);

  /**
   * handleNavigateUp — Called by toolbar / breadcrumb "up" button.
   * Unlike handleNavigateUpDirectory (used by keyboard shortcut),
   * this also checks whether navigation is possible.
   */
  const handleNavigateUp = useCallback(() => {
    if (!currentPath) return;
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, -1).join("/");
    setCurrentPath(newPath);
    setViewInfo(null);
  }, [currentPath]);

  const handleClose = useCallback(() => {
    setViewInfo(null);
  }, []);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleRefresh = useCallback(() => {
    loadFilesRef.current?.(currentPathRef.current, true);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────────────────────────────────────

  const handleDeleteRequest = useCallback(() => {
    if (!listContainerEl) return;
    const activeElement = document.activeElement;
    if (activeElement !== listContainerEl && !listContainerEl.contains(activeElement)) return;

    const file = filesRef.current[focusedIndex];
    if (!file) return;

    setDeleteTarget(file);
    setDeleteDialogOpen(true);
  }, [focusedIndex, listContainerEl]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || !connectionId) return;

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
  }, [deleteTarget, connectionId, focusedIndex]);

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

    setRenameError(null);
    setRenameTarget(file);
    setRenameDialogOpen(true);
  }, [focusedIndex, listContainerEl]);

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget || !connectionId) return;

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
    [renameTarget, connectionId, listContainerEl]
  );

  const handleRenameForFile = useCallback((file: FileEntry, _index: number) => {
    setRenameError(null);
    setRenameTarget(file);
    setRenameDialogOpen(true);
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogOpen(false);
    setRenameTarget(null);
    setRenameError(null);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Create Item
  // ──────────────────────────────────────────────────────────────────────────

  const handleNewDirectoryRequest = useCallback(() => {
    setCreateError(null);
    setCreateItemType(FileType.DIRECTORY);
    setCreateDialogOpen(true);
  }, []);

  const handleNewFileRequest = useCallback(() => {
    setCreateError(null);
    setCreateItemType(FileType.FILE);
    setCreateDialogOpen(true);
  }, []);

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!connectionId) return;

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
    [connectionId, createItemType, listContainerEl]
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

    const filePath = currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name;

    setOpenInAppLoading(true);
    try {
      const themeJson = JSON.stringify({
        id: currentTheme.id,
        mode: currentTheme.mode,
        primary: currentTheme.primary.main,
      });
      const uri = await api.getCompanionUri(connectionId, filePath, themeJson);
      logger.info("Opening file in companion app", { path: filePath }, "companion");
      window.location.href = uri;
      onCompanionHint?.();
    } catch (err: unknown) {
      let detail = "Failed to generate companion URI.";
      if (isApiError(err) && err.response?.data?.detail) {
        detail = err.response.data.detail;
      }
      setError(detail);
      logger.error(`Open in app failed: ${filePath}`, { error: err }, "companion");
    } finally {
      setOpenInAppLoading(false);
    }
  }, [connectionId, focusedIndex, currentTheme, onCompanionHint]);

  const handleOpenInAppForFile = useCallback(
    async (file: FileEntry, _index: number) => {
      if (!connectionId || file.type === "directory") return;
      const filePath = currentPathRef.current ? `${currentPathRef.current}/${file.name}` : file.name;

      setOpenInAppLoading(true);
      try {
        const themeJson = JSON.stringify({
          id: currentTheme.id,
          mode: currentTheme.mode,
          primary: currentTheme.primary.main,
        });
        const uri = await api.getCompanionUri(connectionId, filePath, themeJson);
        logger.info("Opening file in companion app (context menu)", { path: filePath }, "companion");
        window.location.href = uri;
        onCompanionHint?.();
      } catch (err: unknown) {
        let detail = "Failed to generate companion URI.";
        if (isApiError(err) && err.response?.data?.detail) {
          detail = err.response.data.detail;
        }
        setError(detail);
        logger.error(`Open in app failed: ${filePath}`, { error: err }, "companion");
      } finally {
        setOpenInAppLoading(false);
      }
    },
    [connectionId, currentTheme, onCompanionHint]
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
            const pathParts = currentPathRef.current.split("/");
            const newPath = pathParts.slice(0, -1).join("/");
            setCurrentPath(newPath);
            setViewInfo(null);
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
    handleNavigateUpDirectory,
    handleNavigateUp,
    handleClose,
    handleFocusSearch,
    handleRefresh,

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
  };
}
