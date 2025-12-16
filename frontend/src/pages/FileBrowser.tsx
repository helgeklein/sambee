/**
 * FileBrowser Component
 * =====================
 *
 * Main file browser interface providing SMB share navigation with:
 * - Multi-connection management and selection
 * - Directory navigation with breadcrumbs and back/forward support
 * - Virtualized file listing for optimal performance with large directories
 * - Real-time updates via WebSocket for directory change notifications
 * - Comprehensive keyboard navigation with shortcuts
 * - File preview with multiple viewer types (images, text, video, etc.)
 * - Responsive desktop/mobile layouts
 * - Search and sorting capabilities with caching
 *
 * Architecture:
 * - State management: React hooks with refs for WebSocket/async callbacks
 * - Virtualization: TanStack Virtual for rendering large file lists
 * - URL synchronization: Browser history integration for bookmarking
 * - Caching of directory listings to reduce API calls
 * - Accessibility: Keyboard-first design with proper focus management
 */

import { AppBar, Box, CircularProgress, Container, Toolbar, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { BreadcrumbsNavigation } from "../components/FileBrowser/BreadcrumbsNavigation";
import { BrowserAlerts } from "../components/FileBrowser/BrowserAlerts";
import { DesktopToolbar } from "../components/FileBrowser/DesktopToolbar";
import { DynamicViewer } from "../components/FileBrowser/DynamicViewer";
import { FileList } from "../components/FileBrowser/FileList";
import { MobileToolbar } from "../components/FileBrowser/MobileToolbar";
import { SearchBar } from "../components/FileBrowser/SearchBar";
import { SortControls } from "../components/FileBrowser/SortControls";
import { StatusBar } from "../components/FileBrowser/StatusBar";
import HamburgerMenu from "../components/Mobile/HamburgerMenu";
import SettingsDialog from "../components/Settings/SettingsDialog";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS } from "../config/keyboardShortcuts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import api from "../services/api";
import { logger } from "../services/logger";
import type { Connection, FileEntry } from "../types";
import { isApiError } from "../types";
import { hasViewerSupport, isImageFile } from "../utils/FileTypeRegistry";

// ============================================================================
// Type Definitions & Constants
// ============================================================================

type SortField = "name" | "size" | "modified";

const DIRECTORY_CACHE_TTL_MS = 30_000; // 30-second cache TTL to reduce API calls

/**
 * createViewerSessionId
 *
 * Generates unique session identifiers for file viewer instances.
 * Used for tracking and logging viewer lifecycle events in backend traces.
 *
 * @returns Session ID in format: timestamp-random (e.g., "l8x9k2-a3b4c5d6")
 */
const createViewerSessionId = (): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart}`;
};

// ============================================================================
// Main Component
// ============================================================================

const Browser: React.FC = () => {
  // Track renders for performance monitoring
  const renderCountRef = React.useRef(0);
  React.useEffect(() => {
    renderCountRef.current++;
    if (renderCountRef.current % 10 === 0) {
      logger.debug("Browser component render count", { renders: renderCountRef.current }, "browser-perf");
    }
  });

  const navigate = useNavigate();
  const params = useParams<{ connectionId: string; "*": string }>();
  const location = useLocation();
  const theme = useTheme();

  // ──────────────────────────────────────────────────────────────────────────
  // Responsive Design
  // ──────────────────────────────────────────────────────────────────────────

  // Detect screen size and input method for responsive behavior
  const useCompactLayout = useMediaQuery(theme.breakpoints.down("sm"));
  const hasTouchInput = useMediaQuery("(pointer: coarse)");

  // Set row height depending on input method (mouse vs. touch)
  // Touch: larger touch targets (44px+ per WCAG guidelines)
  const rowHeight = hasTouchInput ? 56 : 40;

  // Track if keyboard is being used for navigation (for proper focus styling)
  const [isUsingKeyboard, setIsUsingKeyboard] = useState(false);

  // ──────────────────────────────────────────────────────────────────────────
  // State Management
  // ──────────────────────────────────────────────────────────────────────────

  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [viewInfo, setViewInfo] = useState<{
    path: string;
    mimeType: string;
    images?: string[];
    currentIndex?: number;
    sessionId: string;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ──────────────────────────────────────────────────────────────────────────
  // Refs for DOM Elements & Performance Optimization
  // ──────────────────────────────────────────────────────────────────────────

  // Focus management with RAF (RequestAnimationFrame) batching
  const pendingFocusedIndexRef = React.useRef<number | null>(null);
  const focusCommitRafRef = React.useRef<number | null>(null);

  /**
   * updateFocus
   *
   * Updates focused file index with optional RAF batching for smooth performance.
   * RAF batching prevents layout thrashing during rapid keyboard navigation (key repeat).
   *
   * @param next - Target file index to focus
   * @param options.immediate - Skip RAF batching for instant updates (e.g., mouse clicks)
   */
  const updateFocus = React.useCallback((next: number, options?: { immediate?: boolean }) => {
    const immediate = options?.immediate ?? false;

    const commit = () => {
      setFocusedIndex((prev: number) => (prev === next ? prev : next));
    };

    if (immediate) {
      // Cancel pending RAF batching and commit immediately
      if (focusCommitRafRef.current !== null) {
        cancelAnimationFrame(focusCommitRafRef.current);
        focusCommitRafRef.current = null;
      }
      pendingFocusedIndexRef.current = null;
      commit(); // Regular setState - React will batch automatically
      return;
    }

    // RAF batching for smooth updates during key repeat
    pendingFocusedIndexRef.current = next;

    if (focusCommitRafRef.current !== null) {
      return; // Already scheduled
    }

    focusCommitRafRef.current = requestAnimationFrame(() => {
      focusCommitRafRef.current = null;
      const target = pendingFocusedIndexRef.current;
      pendingFocusedIndexRef.current = null;
      if (target === null) {
        return;
      }
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

  // DOM element refs
  const parentRef = React.useRef<HTMLDivElement>(null); // Scroll container for TanStack Virtual
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const filesRef = React.useRef<FileEntry[]>([]);
  const currentViewIndexRef = React.useRef<number | null>(null);
  const currentViewImagesRef = React.useRef<string[] | undefined>(undefined);
  const [listContainerEl, setListContainerEl] = useState<HTMLDivElement | null>(null);
  const listContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== listContainerEl) {
        setListContainerEl(node);
      }
    },
    [listContainerEl]
  );
  const [visibleRowCount, setVisibleRowCount] = React.useState(10);
  // Mirror of visibleRowCount to avoid capturing state in effects
  const visibleRowCountRef = React.useRef<number>(10);

  // State tracking refs (avoid stale closures in WebSocket/async callbacks)
  const selectedConnectionIdRef = React.useRef<string>("");
  const currentPathRef = React.useRef<string>("");
  const loadFilesRef = React.useRef<(path: string, forceRefresh?: boolean) => Promise<void>>();

  // Incremental search for quick navigation (type characters to jump to files)
  const searchBufferRef = React.useRef<string>("");
  const searchTimeoutRef = React.useRef<number | null>(null);

  // Navigation history to restore scroll position and selection when going back
  const navigationHistory = React.useRef<
    Map<
      string,
      {
        focusedIndex: number;
        scrollOffset: number;
        selectedFileName: string | null;
      }
    >
  >(new Map());

  // Directory listing cache for instant backward navigation
  const directoryCache = React.useRef<Map<string, { items: FileEntry[]; timestamp: number }>>(new Map());

  // WebSocket for real-time directory updates
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);

  // URL synchronization flags to prevent circular updates
  const isInitializing = React.useRef<boolean>(true); // Avoid URL updates during initial mount
  const isUpdatingFromUrl = React.useRef<boolean>(false); // Avoid navigate() during back/forward

  // ──────────────────────────────────────────────────────────────────────────
  // Helper Functions
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * slugifyConnectionName
   *
   * Converts connection name to URL-safe slug for routing.
   * Example: "My Server" -> "my-server"
   */
  const slugifyConnectionName = useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with dashes
      .replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
  }, []);

  const getConnectionByName = useCallback(
    (slug: string): Connection | undefined => {
      return connections.find((c: Connection) => slugifyConnectionName(c.name) === slug);
    },
    [connections, slugifyConnectionName]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // API & Data Loading
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * checkAdminStatus
   *
   * Verifies current user's admin privileges.
   * Admin users can manage connections and access system settings.
   */
  const checkAdminStatus = useCallback(async () => {
    try {
      const user = await api.getCurrentUser();
      setIsAdmin(user.is_admin);
    } catch (err) {
      logger.warn("Failed to verify admin status", { error: err }, "browser");
      setIsAdmin(false);
    }
  }, []);

  /**
   * loadConnections
   *
   * Loads available SMB connections and handles auto-selection.
   * Priority: URL param > localStorage > first connection
   * Initializes mobile logging and handles authentication requirements.
   */
  const loadConnections = useCallback(async () => {
    try {
      setLoadingConnections(true);
      const token = localStorage.getItem("access_token");
      if (!token) {
        // Check if auth is required before redirecting to login
        const { isAuthRequired } = await import("../services/authConfig");
        const authRequired = await isAuthRequired();
        if (authRequired) {
          navigate("/login");
          return;
        }
        // If auth is not required (auth_method="none"), continue without token
      }

      // Initialize mobile logging if not already done (handles page refresh with existing token)
      await logger.initializeBackendTracing();

      const data = await api.getConnections();
      setConnections(data);

      // Priority: URL param (name slug) > localStorage > first connection
      if (params.connectionId) {
        const urlConnection = data.find((c: Connection) => slugifyConnectionName(c.name) === params.connectionId);
        if (urlConnection) {
          // URL has valid connection, will be set in initialization useEffect
          // Don't override it here
          return;
        } else {
          // Invalid connection slug in URL - redirect to /browse
          navigate("/browse", { replace: true });
          return;
        }
      }

      // No URL param, use localStorage or first
      const savedConnectionId = localStorage.getItem("selectedConnectionId");
      let autoSelectedConnection: Connection | undefined;

      if (savedConnectionId && data.find((c: Connection) => c.id === savedConnectionId)) {
        autoSelectedConnection = data.find((c: Connection) => c.id === savedConnectionId);
        setSelectedConnectionId(savedConnectionId);
      } else if (data.length > 0 && data[0]) {
        autoSelectedConnection = data[0];
        setSelectedConnectionId(data[0].id);
      }

      // Update URL to include the auto-selected connection
      if (autoSelectedConnection) {
        const identifier = slugifyConnectionName(autoSelectedConnection.name);
        navigate(`/browse/${identifier}`, { replace: true });
      }
    } catch (err: unknown) {
      logger.error("Error loading connections", { error: err }, "browser");
      if (isApiError(err)) {
        if (err.response?.status === 401) {
          navigate("/login");
        } else if (err.response?.status === 403) {
          setError("Access denied. Please contact an administrator to configure connections.");
        } else {
          setError("Failed to load connections. Please try again.");
        }
      } else {
        setError("Failed to load connections. Please try again.");
      }
    } finally {
      setLoadingConnections(false);
    }
  }, [navigate, params.connectionId, slugifyConnectionName]);

  /**
   * loadFiles
   *
   * Loads directory contents with intelligent caching.
   * Implements cache invalidation for force refresh.
   *
   * @param path - Directory path to load
   * @param forceRefresh - Bypass cache and fetch fresh data
   */
  const loadFiles = useCallback(
    async (path: string, forceRefresh = false) => {
      if (!selectedConnectionId) {
        return;
      }

      const cacheKey = `${selectedConnectionId}:${path}`;
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
        const listing = await api.listDirectory(selectedConnectionId, path);
        const items = listing.items ?? [];
        directoryCache.current.set(cacheKey, { items, timestamp: now });
        setFiles(items);
      } catch (err) {
        logger.error(
          "Error loading directory",
          {
            error: err,
            connectionId: selectedConnectionId,
            path,
          },
          "browser"
        );

        // Extract error message from API response if available
        let errorMessage = "Failed to load directory contents. Please try again.";

        // Check for network errors first (before API errors)
        if (err && typeof err === "object" && "message" in err && !isApiError(err)) {
          const error = err as Error & { code?: string };
          const message = error.message;
          if (message.includes("Network Error") || message.includes("ECONNREFUSED") || error.code === "ECONNREFUSED") {
            errorMessage = "Failed to load files. Please check your connection settings.";
          }
        } else if (isApiError(err)) {
          // API errors with response
          if (err.response?.status === 404) {
            // Check if there's a specific detail message
            const detail = err.response?.data?.detail;
            errorMessage = detail || "Directory not found. It may have been removed or renamed.";
          } else if (err.response?.data?.detail) {
            // Use the detail message from the API
            errorMessage = err.response.data.detail;
          }
        }

        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [selectedConnectionId]
  );

  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  // Helper to update URL when navigation changes
  const updateUrl = useCallback(
    (connectionId: string, path: string) => {
      if (isInitializing.current) return; // Don't update URL during initialization
      if (isUpdatingFromUrl.current) return; // Don't update URL when state is being set from URL

      // Find connection and use its name as identifier
      const connection = connections.find((c: Connection) => c.id === connectionId);
      if (!connection) return;

      const identifier = slugifyConnectionName(connection.name);

      // Encode the path but keep slashes as slashes (not %2F)
      const encodedPath = path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");

      const newUrl = `/browse/${identifier}${encodedPath ? `/${encodedPath}` : ""}`;

      // Only navigate if URL actually changed to avoid duplicate history entries
      if (location.pathname !== newUrl) {
        navigate(newUrl, { replace: false });
      }
    },
    [connections, slugifyConnectionName, location.pathname, navigate]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Component Lifecycle Effects
  // ──────────────────────────────────────────────────────────────────────────

  // Keep refs in sync with state for WebSocket callbacks (avoids closure issues)
  useEffect(() => {
    selectedConnectionIdRef.current = selectedConnectionId;
  }, [selectedConnectionId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  // Initial load - run once on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only once on mount to avoid aborting requests
  useEffect(() => {
    loadConnections();
    checkAdminStatus();
  }, []);

  // Initialize state from URL after connections are loaded
  // biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName uses closure, including it causes re-initialization
  useEffect(() => {
    if (connections.length === 0) return; // Wait for connections to load

    if (params.connectionId) {
      const connection = getConnectionByName(params.connectionId);
      if (connection) {
        setSelectedConnectionId(connection.id);
        const urlPath = params["*"] || "";
        setCurrentPath(decodeURIComponent(urlPath));
      }
    }

    // Mark initialization complete after state updates have been flushed
    // Using flushSync would be too aggressive, so we let React batch the updates
    // and mark complete in the next microtask after this effect runs
    Promise.resolve().then(() => {
      isInitializing.current = false;
    });
  }, [connections.length, params.connectionId, params["*"]]);

  // Handle browser back/forward navigation
  // biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName intentionally excluded - we use closure value to avoid re-running when function reference changes
  useEffect(() => {
    if (isInitializing.current || connections.length === 0) return;

    isUpdatingFromUrl.current = true;

    if (params.connectionId) {
      const connection = getConnectionByName(params.connectionId);
      if (connection && connection.id !== selectedConnectionIdRef.current) {
        setSelectedConnectionId(connection.id);
      }
    }

    const urlPath = params["*"] || "";
    const decodedPath = decodeURIComponent(urlPath);

    // Only update if the path actually changed (using ref to avoid stale closure)
    if (currentPathRef.current !== decodedPath) {
      logger.debug(
        "[URL Navigation useEffect] Setting currentPath to:",
        {
          path: decodedPath,
        },
        "browser"
      );
      setCurrentPath(decodedPath);
    } else {
      logger.debug("[URL Navigation useEffect] Path unchanged, skipping update", {}, "browser");
    }

    // Reset flag after state updates have been flushed
    Promise.resolve().then(() => {
      isUpdatingFromUrl.current = false;
    });
  }, [connections.length, params.connectionId, params["*"]]);

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket Real-Time Updates
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * WebSocket connection for real-time directory change notifications.
   * Features:
   * - Automatic reconnection with 5-second delay on disconnect
   * - Cache invalidation when remote changes detected
   * - Selective directory subscription based on current path
   */
  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // In development, use port 8000; in production, use same port as current page
      const isDev = window.location.port === "3000" || window.location.hostname === "localhost";
      const port = isDev ? "8000" : window.location.port;
      const wsUrl = port ? `${protocol}//${window.location.hostname}:${port}/api/ws` : `${protocol}//${window.location.hostname}/api/ws`;

      logger.info("Connecting to WebSocket", { wsUrl }, "websocket");
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        logger.info("WebSocket connected", { wsUrl }, "websocket");
        wsRef.current = ws;

        // Subscribe to current directory if we have one
        const connId = selectedConnectionIdRef.current;
        const path = currentPathRef.current;
        if (connId && path !== undefined) {
          logger.debug(
            "Subscribing to directory changes",
            {
              connectionId: connId,
              path,
            },
            "websocket"
          );
          ws.send(
            JSON.stringify({
              action: "subscribe",
              connection_id: connId,
              path: path,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "directory_changed") {
          // Use refs to get current values (avoid closure issues)
          const currentConnId = selectedConnectionIdRef.current;
          const currentDir = currentPathRef.current;

          // Invalidate cache for this directory
          const cacheKey = `${data.connection_id}:${data.path}`;
          directoryCache.current.delete(cacheKey);

          logger.info(
            "Directory changed notification received",
            {
              connectionId: data.connection_id,
              path: data.path,
              isCurrentDirectory: data.connection_id === currentConnId && data.path === currentDir,
            },
            "websocket"
          );

          // If we're currently viewing this directory, reload it
          if (data.connection_id === currentConnId && data.path === currentDir) {
            loadFilesRef.current?.(currentDir, true); // Force reload
          }
        }
      };

      ws.onerror = (error) => {
        logger.error("WebSocket error", { wsUrl, error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        logger.warn("WebSocket disconnected, will reconnect in 5s", { wsUrl }, "websocket");
        wsRef.current = null;

        // Reconnect after 5 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, 5000);
      };
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []); // WebSocket connection is stable - created once on mount

  // Subscribe/unsubscribe when directory changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && selectedConnectionId) {
      // Unsubscribe from all and subscribe to current directory
      wsRef.current.send(
        JSON.stringify({
          action: "subscribe",
          connection_id: selectedConnectionId,
          path: currentPath,
        })
      );
    }
  }, [currentPath, selectedConnectionId]);

  // Sync URL with state changes
  useEffect(() => {
    if (selectedConnectionId) {
      updateUrl(selectedConnectionId, currentPath);
    }
  }, [currentPath, selectedConnectionId, updateUrl]);

  // Load files when connection or path changes
  useEffect(() => {
    if (selectedConnectionId) {
      // Clear search query when navigating to a different directory
      setSearchQuery("");
      // Use ref to avoid dependency on loadFiles function
      loadFilesRef.current?.(currentPath);
    }
  }, [currentPath, selectedConnectionId]);

  // Calculate visible row count for PageUp/PageDown navigation
  // Attach a resize observer whenever the list container mounts
  useLayoutEffect(() => {
    const element = listContainerEl;
    if (!element) {
      return;
    }

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

  // ──────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ──────────────────────────────────────────────────────────────────────────

  const handleConnectionChange = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setCurrentPath("");
    setViewInfo(null);
    setFiles([]);
    // Clear caches when switching connections
    directoryCache.current.clear();
    navigationHistory.current.clear();
    // Persist selection
    localStorage.setItem("selectedConnectionId", connectionId);
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    // Reload connections in case they were modified
    loadConnections();
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Data Processing (Sort & Filter)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * sortedAndFilteredFiles
   *
   * Applies search filter and sorting to file list.
   * Directories always shown first, then files.
   * Single-pass algorithm for optimal performance.
   */
  const sortedAndFilteredFiles = useMemo(() => {
    // Filter by search query first
    let filtered = files;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = files.filter((f: FileEntry) => f.name.toLowerCase().includes(query));
    }

    // Single-pass separation and sorting
    const directories: FileEntry[] = [];
    const regularFiles: FileEntry[] = [];

    for (const file of filtered) {
      if (file.type === "directory") {
        directories.push(file);
      } else {
        regularFiles.push(file);
      }
    }

    // Optimized sort function
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
        default:
          comparison = 0;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    };

    directories.sort(sortFunction);
    regularFiles.sort(sortFunction);

    return [...directories, ...regularFiles];
  }, [files, sortBy, sortDirection, searchQuery]);

  // Get all image files in current directory for gallery mode
  // Use sortedAndFilteredFiles to match the display order
  const imageFiles = useMemo(() => {
    return sortedAndFilteredFiles
      .filter((f: FileEntry) => f.type === "file" && isImageFile(f.name))
      .map((f: FileEntry) => (currentPath ? `${currentPath}/${f.name}` : f.name));
  }, [sortedAndFilteredFiles, currentPath]);

  const handleFileClick = useCallback(
    (file: FileEntry, index?: number) => {
      if (index !== undefined) {
        updateFocus(index, { immediate: true });
      }
      if (file.type === "directory") {
        // Save current state before navigating into directory
        const currentScrollOffset = parentRef.current?.scrollTop || 0;
        const currentFocusedIndex = focusedIndex;
        navigationHistory.current.set(currentPath, {
          focusedIndex: currentFocusedIndex,
          scrollOffset: currentScrollOffset,
          selectedFileName: file.name,
        });

        const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;

        logger.info(
          "Navigating to directory",
          {
            from: currentPath,
            to: newPath,
            directory: file.name,
          },
          "browser"
        );

        setCurrentPath(newPath);
        setViewInfo(null);
        // Blur any focused element when navigating so keyboard shortcuts work
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        const viewerSessionId = createViewerSessionId();

        // Get MIME type from backend (provided via get_file_info API call)
        const mimeType = file.mime_type || "application/octet-stream";

        // Check if it's an image for gallery mode
        const isImage = isImageFile(file.name);

        logger.info(
          "File selected for viewing",
          {
            path: filePath,
            fileName: file.name,
            size: file.size,
            mimeType,
            isImage,
            imageFilesCount: imageFiles.length,
          },
          "viewer"
        );

        if (isImage && imageFiles.length > 0) {
          // Gallery mode for images
          const imageIndex = imageFiles.indexOf(filePath);
          logger.info(
            "Opening image in gallery mode",
            {
              imageIndex,
              totalImages: imageFiles.length,
            },
            "viewer"
          );
          const effectiveIndex = imageIndex >= 0 ? imageIndex : 0;
          currentViewIndexRef.current = effectiveIndex;
          currentViewImagesRef.current = imageFiles;
          setViewInfo({
            path: filePath,
            mimeType,
            images: imageFiles,
            currentIndex: effectiveIndex,
            sessionId: viewerSessionId,
          });
        } else {
          currentViewIndexRef.current = null;
          currentViewImagesRef.current = undefined;

          // Check if viewer component is available for this MIME type
          const canView = hasViewerSupport(mimeType);

          logger.info(
            "Opening file in single viewer mode",
            {
              isImage,
              mimeType,
              hasViewerSupport: canView,
            },
            "viewer"
          );

          // Only open viewer if we have a component for it
          if (canView) {
            setViewInfo({
              path: filePath,
              mimeType,
              sessionId: viewerSessionId,
            });
          } else {
            logger.info(
              "No viewer component available, file will not open",
              {
                mimeType,
              },
              "viewer"
            );
          }
        }

        // Keep old behavior for markdown (backward compatibility)
        // Viewer component is managed exclusively through viewInfo state
      }
    },
    [currentPath, updateFocus, imageFiles, focusedIndex]
  );

  const handleViewIndexChange = useCallback((index: number) => {
    currentViewIndexRef.current = index;
    setViewInfo((prev: typeof viewInfo) => {
      if (!prev || !prev.images || prev.images.length === 0) {
        return prev;
      }

      const nextPath = prev.images[index] ?? prev.path;
      if (prev.currentIndex === index && prev.path === nextPath) {
        return prev;
      }

      return {
        ...prev,
        currentIndex: index,
        path: nextPath,
      };
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

    if (!finalPath) {
      return;
    }

    const targetIndex = sortedAndFilteredFiles.findIndex((file: FileEntry) => {
      if (file.type !== "file") {
        return false;
      }
      const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      return fullPath === finalPath;
    });

    if (targetIndex >= 0) {
      updateFocus(targetIndex, { immediate: true });
    }
  }, [currentPath, viewInfo, sortedAndFilteredFiles, updateFocus]);

  // Memoize measureElement to prevent rowVirtualizer from changing on every render
  const measureElement = React.useMemo(
    () =>
      typeof window !== "undefined" && navigator.userAgent.includes("Firefox")
        ? undefined
        : (element: Element) => element.getBoundingClientRect().height,
    []
  );

  // TanStack Virtual: Initialize the virtualizer for efficient rendering of large lists
  const rowVirtualizer = useVirtualizer({
    count: sortedAndFilteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10, // Increased overscan for smoother scrolling during rapid navigation
    measureElement,
    // Use stable file/directory name as key instead of index for proper React reconciliation
    // This ensures each FileRow is properly tracked across sorting/filtering changes
    getItemKey: (index: number) => sortedAndFilteredFiles[index]?.name ?? index,
    // Optimize scroll offset calculations by accounting for the container's offset
    // This ensures scrollToIndex calculations are pixel-perfect
    scrollMargin: parentRef.current?.offsetTop ?? 0,
    // Enable smooth scrolling behavior for better UX (TanStack Virtual will handle the animation)
    // This is particularly effective during programmatic scrolling operations
    enabled: true, // Explicitly enable the virtualizer (default, but being explicit)
  });

  // Keep ref updated and restore or reset focused index when files change
  useEffect(() => {
    filesRef.current = sortedAndFilteredFiles;

    // Check if we have saved state to restore for current path
    const savedState = navigationHistory.current.get(currentPath);
    if (savedState?.selectedFileName) {
      // Find the index of the previously selected item
      const restoredIndex = sortedAndFilteredFiles.findIndex((f: FileEntry) => f.name === savedState.selectedFileName);
      if (restoredIndex >= 0) {
        updateFocus(restoredIndex, { immediate: true });
        // Restore scroll position in next frame to ensure list is rendered
        requestAnimationFrame(() => {
          rowVirtualizer.scrollToIndex(restoredIndex, {
            align: "auto",
          });
        });
        // Clear the saved state after restoring
        navigationHistory.current.delete(currentPath);
        return;
      }
      // If we have saved state but file not found yet, don't reset to 0
      // This prevents flickering when files are still loading
      return;
    }
    // Default: reset to top (only if no saved state exists)
    updateFocus(0, { immediate: true });
  }, [sortedAndFilteredFiles, currentPath, updateFocus, rowVirtualizer]);

  // Scroll focused item into view using VirtualList API
  // Use useLayoutEffect to run synchronously BEFORE React renders components
  // This prevents the old viewport from rendering with the new focusedIndex
  const prevFocusedIndexRef = React.useRef<number>(0);

  // Skip the layout effect scroll if we already handled it synchronously in the keyboard handler
  const skipNextLayoutScrollRef = React.useRef<boolean>(false);

  // Update focused index when files change or search query changes
  useLayoutEffect(() => {
    if (focusedIndex >= 0) {
      const prev = prevFocusedIndexRef.current;
      const diff = focusedIndex - prev;

      if (skipNextLayoutScrollRef.current) {
        skipNextLayoutScrollRef.current = false;
        prevFocusedIndexRef.current = focusedIndex;
        return;
      }

      // Determine alignment based on jump size
      let align: "auto" | "center" | "end" | "start" = "auto";

      // Large forward jump (PageDown) - lock new focused item at bottom
      if (diff >= visibleRowCount) {
        align = "end";
      }
      // Large backward jump (PageUp) - lock new focused item at top
      else if (diff <= -visibleRowCount) {
        align = "start";
      } else if (Math.abs(diff) === 1) {
        // Single-step arrow navigation - use simple edge detection without forced reflow
        // Use "auto" alignment which lets TanStack Virtual decide based on its internal state
        // This avoids calling getVirtualItems() which causes layout thrashing
        align = "auto";
      } else {
        // Multi-step jump (Home/End or programmatic) - align to appropriate edge
        align = diff > 0 ? "end" : "start";
      }

      rowVirtualizer.scrollToIndex(focusedIndex, {
        align,
      });

      // Update previous value
      prevFocusedIndexRef.current = focusedIndex;
    }
  }, [focusedIndex, visibleRowCount, rowVirtualizer]);

  // ──────────────────────────────────────────────────────────────────────────
  // Keyboard Navigation & Shortcuts
  // ──────────────────────────────────────────────────────────────────────────

  // Arrow key and navigation handlers
  const handleNavigateDown = useCallback(
    (e?: KeyboardEvent) => {
      if (focusedIndex < 0) return;
      const fileCount = filesRef.current.length;
      const next = Math.min(focusedIndex + 1, fileCount - 1);
      if (next === focusedIndex) return;

      // For key repeat (holding down arrow), use async scrolling to avoid layout thrashing
      if (e?.repeat) {
        updateFocus(next, { immediate: false });
      } else {
        updateFocus(next);
      }
    },
    [focusedIndex, updateFocus]
  );

  const handleArrowUp = useCallback(
    (e?: KeyboardEvent) => {
      if (focusedIndex < 0) return;

      // If at first item (index 0), move focus to search box
      if (focusedIndex === 0 && searchInputRef.current) {
        searchInputRef.current.focus();
        return;
      }

      const next = Math.max(focusedIndex - 1, 0);
      if (next === focusedIndex) return;

      // For key repeat (holding down arrow), use async scrolling to avoid layout thrashing
      if (e?.repeat) {
        updateFocus(next, { immediate: false });
      } else {
        updateFocus(next);
      }
    },
    [focusedIndex, updateFocus]
  );

  const handleHome = useCallback(() => {
    updateFocus(0);
  }, [updateFocus]);

  const handleEnd = useCallback(() => {
    const fileCount = filesRef.current.length;
    updateFocus(fileCount - 1);
  }, [updateFocus]);

  const handlePageDown = useCallback(
    (e?: KeyboardEvent) => {
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
    [focusedIndex, visibleRowCount, updateFocus, rowVirtualizer]
  );

  const handlePageUp = useCallback(
    (e?: KeyboardEvent) => {
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
    [focusedIndex, visibleRowCount, updateFocus, rowVirtualizer]
  );

  const handleOpenFile = useCallback(() => {
    const files = filesRef.current;
    const file = files[focusedIndex];
    if (file) {
      handleFileClick(file, focusedIndex);
    }
  }, [focusedIndex, handleFileClick]);

  const handleNavigateUpDirectory = useCallback(() => {
    if (currentPathRef.current) {
      const pathParts = currentPathRef.current.split("/");
      const newPath = pathParts.slice(0, -1).join("/");
      setCurrentPath(newPath);
      setViewInfo(null);
    }
  }, []);

  const handleClose = useCallback(() => {
    setViewInfo(null);
    setSearchQuery("");
  }, []);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleRefresh = useCallback(() => {
    loadFilesRef.current?.(currentPathRef.current, true);
  }, []);

  /**
   * Keyboard shortcuts configuration
   *
   * Defines all browser shortcuts with handlers and enabled conditions.
   * Integrates with centralized keyboard shortcut system.
   */
  const browserShortcuts = useMemo(
    () => [
      // Navigation - Arrow keys
      {
        ...BROWSER_SHORTCUTS.ARROW_DOWN,
        handler: handleNavigateDown,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      {
        ...BROWSER_SHORTCUTS.ARROW_UP,
        handler: handleArrowUp,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      // Navigation - Home/End
      {
        ...COMMON_SHORTCUTS.FIRST_PAGE,
        description: "First file",
        handler: handleHome,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      {
        ...COMMON_SHORTCUTS.LAST_PAGE,
        description: "Last file",
        handler: handleEnd,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      // Navigation - Page Up/Down
      {
        ...COMMON_SHORTCUTS.PAGE_DOWN,
        handler: handlePageDown,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      {
        ...COMMON_SHORTCUTS.PAGE_UP,
        handler: handlePageUp,
        enabled: !settingsOpen && !viewInfo && filesRef.current.length > 0,
      },
      // Open file/folder
      {
        ...COMMON_SHORTCUTS.OPEN,
        handler: handleOpenFile,
        enabled: !settingsOpen && !viewInfo && focusedIndex >= 0 && filesRef.current[focusedIndex] !== undefined,
      },
      // Navigate up directory
      {
        ...BROWSER_SHORTCUTS.NAVIGATE_UP,
        handler: handleNavigateUpDirectory,
        enabled: !settingsOpen && !viewInfo && currentPathRef.current !== "",
      },
      // Clear selection and search (close action in browser context)
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleClose,
        enabled: !settingsOpen,
      },
      // Focus search
      {
        ...BROWSER_SHORTCUTS.FOCUS_SEARCH,
        handler: handleFocusSearch,
        enabled: !settingsOpen && !viewInfo,
      },
      // Refresh
      {
        ...BROWSER_SHORTCUTS.REFRESH,
        handler: handleRefresh,
        enabled: !viewInfo,
      },
    ],
    [
      handleNavigateDown,
      settingsOpen,
      viewInfo,
      handleArrowUp,
      handleHome,
      handleEnd,
      handlePageDown,
      handlePageUp,
      handleOpenFile,
      focusedIndex,
      handleNavigateUpDirectory,
      handleClose,
      handleFocusSearch,
      handleRefresh,
    ]
  );

  useKeyboardShortcuts({
    shortcuts: browserShortcuts,
  });

  /**
   * Special keyboard handler for edge cases:
   * 1. Arrow down from search box -> focus first file
   * 2. Backspace in empty search -> navigate up directory
   * 3. Incremental search: type characters to jump to matching files
   *
   * Runs in bubble phase after centralized shortcuts.
   */
  useEffect(() => {
    const handleKeyDown = (e?: KeyboardEvent) => {
      if (!e) return;

      // Don't handle if event already handled
      if (e.defaultPrevented) return;

      const target = e.target as HTMLElement;
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Handle special transitions when in input fields
      if (isInInput) {
        // Exception: Allow ArrowDown in search box to move to first file in list
        if (e.key === "ArrowDown" && target === searchInputRef.current) {
          e.preventDefault();
          // Blur the search input
          searchInputRef.current?.blur();
          // Focus on the list container
          listContainerEl?.focus();
          // Set focus to first item
          updateFocus(0, { immediate: true });
          return;
        }
        // Exception: Allow Backspace for navigation when search is empty and in search input
        if (e.key === "Backspace" && (searchQuery === "" || (target as HTMLInputElement).value === "") && currentPathRef.current) {
          // Check if cursor is at the beginning of input (no text to delete)
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

        // Allow certain special keys to pass through to useKeyboardShortcuts
        // These keys have allowInInput: true and will be handled there
        const allowedKeysInInput = ["/", "?", "Escape"];
        if (allowedKeysInInput.includes(e.key)) {
          // Don't interfere - let these pass through to useKeyboardShortcuts
          return;
        }

        // For all other keys when in input, don't interfere (let normal input behavior happen)
        return;
      }

      // Don't handle if dialogs are open or viewer is showing
      if (settingsOpen || viewInfo) {
        return;
      }

      const files = filesRef.current;
      const fileCount = files.length;

      // Incremental search - accumulate keystrokes to match file names (only when NOT in input)
      // Match any printable character, excluding special shortcut keys
      const shortcutKeys = ["/", "?", "Escape"];
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " " && !shortcutKeys.includes(e.key) && fileCount > 0) {
        e.preventDefault();

        // Clear any existing timeout
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }

        // Add this character to the search buffer
        searchBufferRef.current += e.key.toLowerCase();

        // Find first file matching the accumulated prefix
        const index = files.findIndex((f: FileEntry) => f.name.toLowerCase().startsWith(searchBufferRef.current));
        if (index !== -1) {
          updateFocus(index);
        }

        // Reset search buffer after 1 second of no typing
        searchTimeoutRef.current = window.setTimeout(() => {
          searchBufferRef.current = "";
        }, 1000);
      }
    };

    // Attach to window in bubble phase (runs AFTER useKeyboardShortcuts)
    // This allows useKeyboardShortcuts to handle special keys (/, ?, Esc) first
    // Only if they don't match a shortcut, this handler will process incremental search
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen, searchQuery, viewInfo, updateFocus, listContainerEl]);

  // ──────────────────────────────────────────────────────────────────────────
  // Accessibility
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Keyboard vs Mouse/Touch focus tracking
   *
   * Shows focus indicators only during keyboard navigation per WCAG guidelines.
   * Hides focus ring for mouse/touch to reduce visual clutter.
   */
  useLayoutEffect(() => {
    const handleKeyDown = () => setIsUsingKeyboard(true);
    const handlePointerDown = () => setIsUsingKeyboard(false);

    // Use capture phase to ensure these run before any other handlers
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Render Helpers
  // ──────────────────────────────────────────────────────────────────────────

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    navigate("/login");
  };

  const pathParts = currentPath ? currentPath.split("/") : [];
  const currentDirectoryName = (pathParts.length > 0 && pathParts[pathParts.length - 1]) || "Root";
  const canNavigateUp = currentPath !== "";

  const handleNavigateUp = () => {
    if (!canNavigateUp) return;
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, -1).join("/");
    setCurrentPath(newPath);
    setViewInfo(null);
  };

  // Memoized FileRow component for optimal performance
  // FileRow component styles - memoized outside to prevent recreation on every scroll
  const fileRowStyles = React.useMemo(
    () => ({
      iconBox: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        flexShrink: 0,
      },
      contentBox: {
        flex: 1,
        minWidth: 0,
      },
      buttonSelected: {
        display: "flex",
        alignItems: "center",
        gap: 1,
        height: "100%",
        width: "100%",
        px: 2,
        py: 1.5,
        cursor: "pointer",
        userSelect: "none",
        border: "none",
        borderRadius: 0,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
        // Only show focus highlight when keyboard is being used
        background: isUsingKeyboard ? theme.palette.action.selected : "transparent",
        "&:hover": {
          backgroundColor: isUsingKeyboard ? theme.palette.action.hover : "transparent",
        },
        "&:active": {
          backgroundColor: isUsingKeyboard ? theme.palette.action.selected : "transparent",
        },
      },
      buttonNotSelected: {
        display: "flex",
        alignItems: "center",
        gap: 1,
        height: "100%",
        width: "100%",
        px: 2,
        py: 1.5,
        cursor: "pointer",
        userSelect: "none",
        border: "none",
        background: "transparent",
        borderRadius: 0,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
        "&:hover": {
          backgroundColor: isUsingKeyboard ? theme.palette.action.hover : "transparent",
        },
        "&:active": {
          backgroundColor: isUsingKeyboard ? theme.palette.action.selected : "transparent",
        },
      },
    }),
    [theme, isUsingKeyboard]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Component Render
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Hamburger Menu - Mobile Only */}
      <HamburgerMenu
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        connections={connections}
        selectedConnectionId={selectedConnectionId}
        onConnectionChange={handleConnectionChange}
        onNavigateToRoot={() => {
          setCurrentPath("");
          setViewInfo(null);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={handleLogout}
        isAdmin={isAdmin}
      />

      <AppBar position="static">
        <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
          {useCompactLayout ? (
            <MobileToolbar
              currentDirectoryName={currentDirectoryName}
              onOpenMenu={() => setDrawerOpen(true)}
              onNavigateUp={handleNavigateUp}
              canNavigateUp={canNavigateUp}
            />
          ) : (
            <DesktopToolbar
              connections={connections}
              selectedConnectionId={selectedConnectionId}
              onConnectionChange={handleConnectionChange}
              onOpenSettings={() => setSettingsOpen(true)}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchInputRef={searchInputRef}
              showSearch={files.length > 0}
            />
          )}
        </Toolbar>
      </AppBar>
      <Container
        maxWidth={false}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          pt: 2,
          pb: 0,
          px: { xs: 0, sm: 3, md: 4 },
          overflow: "hidden",
        }}
      >
        <BrowserAlerts error={error} loadingConnections={loadingConnections} connectionsCount={connections.length} isAdmin={isAdmin} />

        {selectedConnectionId && (
          <>
            {/* Desktop: Breadcrumbs and controls header */}
            {!useCompactLayout && (
              <Box
                display="flex"
                flexDirection={{ xs: "column", md: "row" }}
                gap={{ xs: 2, md: 0 }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", md: "center" }}
                sx={{ mb: 2 }}
              >
                <BreadcrumbsNavigation
                  currentPath={currentPath}
                  onNavigate={(path) => {
                    setCurrentPath(path);
                    setViewInfo(null);
                    // Blur any focused element
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }}
                />

                {files.length > 0 && (
                  <SortControls
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    sortDirection={sortDirection}
                    onDirectionChange={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                    onRefresh={() => loadFiles(currentPath, true)}
                  />
                )}
              </Box>
            )}

            {files.length > 0 && useCompactLayout && (
              <SearchBar value={searchQuery} onChange={setSearchQuery} inputRef={searchInputRef} useCompactLayout={useCompactLayout} />
            )}

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ display: "flex", gap: 2, flex: 1, minHeight: 0, mb: 0, flexDirection: "column" }}>
                <FileList
                  files={sortedAndFilteredFiles}
                  focusedIndex={focusedIndex}
                  searchQuery={searchQuery}
                  onClearSearch={() => setSearchQuery("")}
                  onFileClick={handleFileClick}
                  rowVirtualizer={rowVirtualizer}
                  parentRef={parentRef}
                  listContainerRef={listContainerRef}
                  fileRowStyles={fileRowStyles}
                />
              </Box>
            )}
          </>
        )}
      </Container>

      {!useCompactLayout && selectedConnectionId && sortedAndFilteredFiles.length > 0 && !loading && (
        <StatusBar files={sortedAndFilteredFiles} focusedIndex={focusedIndex} />
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={handleSettingsClose}
        isAdmin={isAdmin}
        shortcuts={browserShortcuts}
        onLogout={handleLogout}
      />
      {viewInfo && (
        <DynamicViewer
          connectionId={selectedConnectionId}
          viewInfo={viewInfo}
          onClose={handleViewClose}
          onIndexChange={handleViewIndexChange}
        />
      )}
    </Box>
  );
};

export default Browser;
