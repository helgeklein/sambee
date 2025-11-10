import {
  AccessTime as AccessTimeIcon,
  Clear as ClearIcon,
  DataUsage as DataUsageIcon,
  InsertDriveFile as FileIcon,
  Folder as FolderIcon,
  Home as HomeIcon,
  KeyboardOutlined as KeyboardIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  SortByAlpha as SortByAlphaIcon,
  Storage as StorageIcon,
} from "@mui/icons-material";
import {
  Alert,
  AppBar,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MarkdownPreview from "../components/Preview/MarkdownPreview";
import SettingsDialog from "../components/Settings/SettingsDialog";
import api from "../services/api";
import { logger } from "../services/logger";
import type { Connection, FileEntry } from "../types";
import { isApiError } from "../types";

// Performance Profiling System
// =============================
// To enable detailed performance profiling, set these flags to true:
//   - FOCUS_TRACE_ENABLED: Logs focus overlay visibility changes
//   - PERF_TRACE_ENABLED: Logs detailed timing measurements for all operations
//
// When PERF_TRACE_ENABLED is true, you'll see console output like:
//   [PERF] overlayUpdate: 3.45ms (operations that take longer than threshold)
//   [PERF] getVirtualItems: 1.23ms
//   [PERF] layoutRead: 0.15ms
//   [PERF] styleUpdate: 0.08ms
//   [PERF] scrollRAF: 5.67ms
//   [PERF] fileRow_0: 2.34ms (per visible row)
//   [PERF] fileRow_0_formatting: 0.12ms
//   [PERF] fileRow_0_render: 1.89ms
//   [PERF SCROLL] Scroll events: 45.2/s | RAF callbacks: 60.0/s | Overlay updates: 3 | Renders: 12
//
// This helps identify which operations are consuming CPU during scrolling:
//   - If overlayUpdate is consistently >5ms, overlay positioning is slow
//   - If getVirtualItems is >1ms, TanStack Virtual calculation is slow
//   - If fileRow times are high, rendering individual rows is slow
//   - If scrollRAF is >10ms, the scroll handler RAF callback is slow
//   - The aggregate SCROLL report shows overall event frequencies
//
// To use:
//   1. Set PERF_TRACE_ENABLED = true below
//   2. Open browser DevTools console
//   3. Scroll through a long file list
//   4. Observe timing measurements in console
//   5. Identify bottlenecks (operations exceeding thresholds)
//   6. Set flag back to false when done profiling

const FOCUS_TRACE_ENABLED = false;
const PERF_TRACE_ENABLED = false; // Enable to see performance metrics in console

const traceFocus = (message: string, payload?: Record<string, unknown>) => {
  if (!FOCUS_TRACE_ENABLED) {
    return;
  }
  logger.info(message, payload);
};

// Performance tracking utilities
const perfMarkers = new Map<string, number>();

const perfStart = (marker: string) => {
  if (!PERF_TRACE_ENABLED) return;
  perfMarkers.set(marker, performance.now());
};

const perfEnd = (marker: string, threshold = 0) => {
  if (!PERF_TRACE_ENABLED) return;
  const start = perfMarkers.get(marker);
  if (start) {
    const duration = performance.now() - start;
    if (duration > threshold) {
      console.log(`[PERF] ${marker}: ${duration.toFixed(2)}ms`);
    }
    perfMarkers.delete(marker);
  }
};

// Track scroll performance
const scrollMetrics = {
  events: 0,
  rafCallbacks: 0,
  overlayUpdates: 0,
  renderCount: 0,
};

type SortField = "name" | "size" | "modified";

const ROW_HEIGHT = 68;

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

const formatDate = (dateString?: string): string => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
};

const Browser: React.FC = () => {
  // Track renders for performance monitoring
  const renderCountRef = React.useRef(0);
  React.useEffect(() => {
    renderCountRef.current++;
    if (PERF_TRACE_ENABLED && renderCountRef.current % 10 === 0) {
      console.log(`[PERF] Browser component renders: ${renderCountRef.current}`);
    }
  });

  const navigate = useNavigate();
  const params = useParams<{ connectionId: string; "*": string }>();
  const location = useLocation();
  const theme = useTheme();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);

  const pendingFocusedIndexRef = React.useRef<number | null>(null);
  const focusCommitRafRef = React.useRef<number | null>(null);

  const updateFocus = React.useCallback((next: number, options?: { immediate?: boolean }) => {
    const immediate = options?.immediate ?? false;

    const commit = () => {
      setFocusedIndex((prev) => (prev === next ? prev : next));
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
      setFocusedIndex((prev) => (prev === target ? prev : target));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (focusCommitRafRef.current !== null) {
        cancelAnimationFrame(focusCommitRafRef.current);
      }
    };
  }, []);

  // Ref for the parent scroll container element (used by TanStack Virtual)
  const parentRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const filesRef = React.useRef<FileEntry[]>([]);
  const [listContainerEl, setListContainerEl] = useState<HTMLDivElement | null>(null);
  const listContainerRef = useCallback((node: HTMLDivElement | null) => {
    setListContainerEl(node);
  }, []);
  const [visibleRowCount, setVisibleRowCount] = React.useState(10);
  // Mirror of visibleRowCount to avoid capturing state in effects
  const visibleRowCountRef = React.useRef<number>(10);
  const focusOverlayRef = React.useRef<HTMLDivElement | null>(null);

  // Refs to access current values in WebSocket callbacks (avoid closure issues)
  const selectedConnectionIdRef = React.useRef<string>("");
  const currentPathRef = React.useRef<string>("");
  const loadFilesRef = React.useRef<(path: string, forceRefresh?: boolean) => Promise<void>>();

  // Incremental search for quick navigation
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
  const directoryCache = React.useRef<Map<string, { items: FileEntry[]; timestamp: number }>>(
    new Map()
  );

  // WebSocket for real-time directory updates
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);

  // Track if we're initializing from URL to avoid circular updates
  const isInitializing = React.useRef<boolean>(true);
  // Track if we're updating state from URL (back/forward) to avoid circular navigate
  const isUpdatingFromUrl = React.useRef<boolean>(false);

  // Helper functions for connection name/ID mapping
  const slugifyConnectionName = useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with dashes
      .replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
  }, []);

  const getConnectionByName = useCallback(
    (slug: string): Connection | undefined => {
      return connections.find((c) => slugifyConnectionName(c.name) === slug);
    },
    [connections, slugifyConnectionName]
  );

  const getConnectionIdentifier = useCallback(
    (connection: Connection): string => {
      return slugifyConnectionName(connection.name);
    },
    [slugifyConnectionName]
  );

  const checkAdminStatus = useCallback(async () => {
    try {
      await api.getConnections();
      setIsAdmin(true);
    } catch (error: unknown) {
      // If 403, user is not admin; if 401, not logged in
      if (isApiError(error) && error.response?.status === 403) {
        setIsAdmin(false);
      }
    }
  }, []);

  const loadFiles = useCallback(
    async (path: string, forceRefresh: boolean = false) => {
      if (!selectedConnectionId) return;

      // Create cache key
      const cacheKey = `${selectedConnectionId}:${path}`;

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = directoryCache.current.get(cacheKey);
        if (cached) {
          // Use cached data immediately - no loading spinner!
          logger.debug("Using cached directory listing", {
            connectionId: selectedConnectionId,
            path,
            cacheAge: Date.now() - cached.timestamp,
          });
          setFiles(cached.items);
          setError(null);
          return;
        }
      }
      try {
        setLoading(true);
        setError(null);

        logger.info("Loading directory", {
          connectionId: selectedConnectionId,
          path,
          forceRefresh,
        });

        const listing = await api.listDirectory(selectedConnectionId, path);

        // Store in cache
        directoryCache.current.set(cacheKey, {
          items: listing.items,
          timestamp: Date.now(),
        });

        logger.info("Directory loaded successfully", {
          connectionId: selectedConnectionId,
          path,
          itemCount: listing.items.length,
        });

        setFiles(listing.items);
      } catch (err: unknown) {
        logger.error(
          "Failed to load directory",
          {
            connectionId: selectedConnectionId,
            path,
            status: isApiError(err) ? err.response?.status : undefined,
            detail: isApiError(err) ? err.response?.data?.detail : undefined,
          },
          err instanceof Error ? err : undefined
        );

        if (isApiError(err)) {
          if (err.response?.status === 401) {
            navigate("/login");
          } else if (err.response?.status === 404) {
            setError("Connection not found. Please select another connection.");
          } else {
            setError(
              err.response?.data?.detail ||
                "Failed to load files. Please check your connection settings."
            );
          }
        } else {
          setError("Failed to load files. Please check your connection settings.");
        }
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedConnectionId, navigate]
  );

  // Keep loadFiles ref in sync
  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  const loadConnections = useCallback(async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        navigate("/login");
        return;
      }
      const data = await api.getConnections();
      setConnections(data);

      // Priority: URL param (name slug) > localStorage > first connection
      if (params.connectionId) {
        const urlConnection = data.find(
          (c: Connection) => slugifyConnectionName(c.name) === params.connectionId
        );
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
      } else if (data.length > 0) {
        autoSelectedConnection = data[0];
        setSelectedConnectionId(data[0].id);
      }

      // Update URL to include the auto-selected connection
      if (autoSelectedConnection) {
        const identifier = slugifyConnectionName(autoSelectedConnection.name);
        navigate(`/browse/${identifier}`, { replace: true });
      }
    } catch (err: unknown) {
      logger.error("Error loading connections", { error: err });
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
    }
  }, [navigate, params.connectionId, slugifyConnectionName]);

  // Helper to update URL when navigation changes
  const updateUrl = useCallback(
    (connectionId: string, path: string) => {
      if (isInitializing.current) return; // Don't update URL during initialization
      if (isUpdatingFromUrl.current) return; // Don't update URL when state is being set from URL

      // Find connection and use its name as identifier
      const connection = connections.find((c) => c.id === connectionId);
      if (!connection) return;

      const identifier = getConnectionIdentifier(connection);

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
    [connections, getConnectionIdentifier, location.pathname, navigate]
  );

  const handleFileClick = useCallback(
    (file: FileEntry, index?: number) => {
      if (index !== undefined) {
        updateFocus(index, { immediate: true });
      }
      if (file.type === "directory") {
        // Save current state before navigating into directory
        const currentScrollOffset = parentRef.current?.scrollTop || 0;
        const currentFocusedIndex = focusedIndexRef.current; // Use ref instead of state
        navigationHistory.current.set(currentPath, {
          focusedIndex: currentFocusedIndex,
          scrollOffset: currentScrollOffset,
          selectedFileName: file.name,
        });

        const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;

        logger.info("Navigating to directory", {
          from: currentPath,
          to: newPath,
          directory: file.name,
        });

        setCurrentPath(newPath);
        setSelectedFile(null);
        // Blur any focused element when navigating so keyboard shortcuts work
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;

        logger.info("File selected for preview", {
          path: filePath,
          fileName: file.name,
          size: file.size,
          mimeType: file.mime_type,
        });

        setSelectedFile(filePath);
      }
    },
    [currentPath, updateFocus] // Removed focusedIndex dependency
  );

  // Keep refs in sync with state for WebSocket callbacks
  useEffect(() => {
    selectedConnectionIdRef.current = selectedConnectionId;
  }, [selectedConnectionId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  // Debug: Log when focusedIndex state changes
  useEffect(() => {
    traceFocus(">>> STATE CHANGED: focusedIndex updated", { focusedIndex });
  }, [focusedIndex]);

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
    // Mark initialization complete after a brief delay
    setTimeout(() => {
      isInitializing.current = false;
    }, 100);
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
      console.log("[URL Navigation useEffect] Setting currentPath to:", decodedPath);
      setCurrentPath(decodedPath);
    } else {
      console.log("[URL Navigation useEffect] Path unchanged, skipping update");
    }

    // Reset flag after state updates have propagated
    setTimeout(() => {
      isUpdatingFromUrl.current = false;
    }, 50);
  }, [connections.length, params.connectionId, params["*"]]);

  // WebSocket connection and reconnection logic
  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // In development, use port 8000; in production, use same port as current page
      const isDev = window.location.port === "3000" || window.location.hostname === "localhost";
      const port = isDev ? "8000" : window.location.port;
      const wsUrl = port
        ? `${protocol}//${window.location.hostname}:${port}/api/ws`
        : `${protocol}//${window.location.hostname}/api/ws`;

      logger.info("Connecting to WebSocket", { wsUrl });
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        logger.info("WebSocket connected", { wsUrl });
        wsRef.current = ws;

        // Subscribe to current directory if we have one
        const connId = selectedConnectionIdRef.current;
        const path = currentPathRef.current;
        if (connId && path !== undefined) {
          logger.debug("Subscribing to directory changes", {
            connectionId: connId,
            path,
          });
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

          logger.info("Directory changed notification received", {
            connectionId: data.connection_id,
            path: data.path,
            isCurrentDirectory: data.connection_id === currentConnId && data.path === currentDir,
          });

          // If we're currently viewing this directory, reload it
          if (data.connection_id === currentConnId && data.path === currentDir) {
            loadFilesRef.current?.(currentDir, true); // Force reload
          }
        }
      };

      ws.onerror = (error) => {
        logger.error("WebSocket error", { wsUrl, error: String(error) });
      };

      ws.onclose = () => {
        logger.warn("WebSocket disconnected, will reconnect in 5s", { wsUrl });
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
      const visibleRows = Math.floor(rect.height / ROW_HEIGHT);
      const newCount = visibleRows >= 5 ? visibleRows : 10;
      if (newCount !== visibleRowCountRef.current) {
        traceFocus(">>> visibleRowCount updated", {
          height: rect.height,
          visibleRows,
          newCount,
        });
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
  }, [listContainerEl]);

  const handleConnectionChange = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setCurrentPath("");
    setSelectedFile(null);
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

  const sortedAndFilteredFiles = useMemo(() => {
    // Filter by search query first
    let filtered = files;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = files.filter((f) => f.name.toLowerCase().includes(query));
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
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "size":
          return (b.size || 0) - (a.size || 0);
        case "modified": {
          const dateA = a.modified_at ? new Date(a.modified_at).getTime() : 0;
          const dateB = b.modified_at ? new Date(b.modified_at).getTime() : 0;
          return dateB - dateA;
        }
        default:
          return 0;
      }
    };

    directories.sort(sortFunction);
    regularFiles.sort(sortFunction);

    return [...directories, ...regularFiles];
  }, [files, sortBy, searchQuery]);

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
    estimateSize: () => ROW_HEIGHT,
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
      const restoredIndex = sortedAndFilteredFiles.findIndex(
        (f) => f.name === savedState.selectedFileName
      );
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

  // Focus overlay update - synced with TanStack Virtual's virtual items
  // Use ref for focusedIndex to avoid recreating callback on every focus change
  const focusedIndexRef = React.useRef<number>(focusedIndex);
  focusedIndexRef.current = focusedIndex;

  // Cache scroll position and viewport height to avoid forced synchronous layout reads
  // Updated passively during scroll events for optimal performance
  const scrollTopRef = React.useRef<number>(0);
  const clientHeightRef = React.useRef<number>(0);

  // Track previous overlay state to skip redundant DOM updates
  const prevOverlayStateRef = React.useRef({ top: -1, opacity: "", height: "" });

  // Cache virtual items within each RAF frame to avoid multiple getVirtualItems() calls
  const virtualItemsCacheRef = React.useRef<{
    items: ReturnType<typeof rowVirtualizer.getVirtualItems>;
    timestamp: number;
  } | null>(null);

  const getCachedVirtualItems = React.useCallback(() => {
    const now = performance.now();
    // Cache is valid for current frame (use 16ms threshold for 60fps)
    if (virtualItemsCacheRef.current && now - virtualItemsCacheRef.current.timestamp < 16) {
      return virtualItemsCacheRef.current.items;
    }
    const items = rowVirtualizer.getVirtualItems();
    virtualItemsCacheRef.current = { items, timestamp: now };
    return items;
  }, [rowVirtualizer]);

  // Set up passive scroll listener to cache scroll position and viewport height
  // This eliminates expensive forced synchronous layout reads in updateFocusOverlayImmediate
  useEffect(() => {
    const listElement = parentRef.current;
    if (!listElement) {
      return;
    }

    const updateScrollCache = () => {
      scrollTopRef.current = listElement.scrollTop;
      clientHeightRef.current = listElement.clientHeight;
    };

    // Initialize cache
    scrollTopRef.current = listElement.scrollTop;
    clientHeightRef.current = listElement.clientHeight;

    // Update cache on scroll (passive for performance)
    listElement.addEventListener("scroll", updateScrollCache, { passive: true });

    // Update cache on resize (viewport height can change)
    const updateHeightCache = () => {
      clientHeightRef.current = listElement.clientHeight;
    };
    window.addEventListener("resize", updateHeightCache, { passive: true });

    return () => {
      listElement.removeEventListener("scroll", updateScrollCache);
      window.removeEventListener("resize", updateHeightCache);
    };
  }, []);

  // Get virtual items for rendering - this will be called during each render,
  // but TanStack Virtual internally optimizes this call
  const virtualItemsForRender = rowVirtualizer.getVirtualItems();

  const updateFocusOverlayImmediate = React.useCallback(() => {
    perfStart("overlayUpdate");
    scrollMetrics.overlayUpdates++;

    const overlay = focusOverlayRef.current;
    const listElement = parentRef.current;
    const currentFocusedIndex = focusedIndexRef.current;

    if (!overlay || !listElement) {
      perfEnd("overlayUpdate");
      return;
    }

    if (currentFocusedIndex < 0 || filesRef.current.length === 0) {
      if (overlay.style.opacity !== "0") {
        overlay.style.opacity = "0";
      }
      perfEnd("overlayUpdate");
      return;
    }

    // Use cached virtual items to avoid expensive recalculation
    perfStart("getVirtualItems");
    const virtualItems = getCachedVirtualItems();
    perfEnd("getVirtualItems", 1);

    const focusedVirtualItem = virtualItems.find((item) => item.index === currentFocusedIndex);

    if (!focusedVirtualItem) {
      // Focused item is not in the viewport - hide overlay
      if (overlay.style.opacity !== "0") {
        overlay.style.opacity = "0";
      }
      perfEnd("overlayUpdate");
      return;
    }

    // Use cached scroll position and viewport height instead of reading from DOM
    // This eliminates expensive forced synchronous layout reads (was 3-9ms!)
    perfStart("layoutRead");
    const scrollTop = scrollTopRef.current;
    const availableHeight = clientHeightRef.current;
    perfEnd("layoutRead", 1);

    // Calculate position
    const top = focusedVirtualItem.start - scrollTop;

    // Check if the overlay would be visible in the viewport
    if (top < -ROW_HEIGHT || top > availableHeight) {
      if (overlay.style.opacity !== "0") {
        overlay.style.opacity = "0";
        prevOverlayStateRef.current = { top: -1, opacity: "0", height: "" };
      }
      perfEnd("overlayUpdate");
      return;
    }

    // Calculate target styles
    const targetOpacity = "1";
    const roundedTop = Math.round(top);
    const targetHeight = `${focusedVirtualItem.size}px`;

    // Skip update if nothing changed (optimization to avoid redundant DOM writes)
    const prevState = prevOverlayStateRef.current;
    if (
      prevState.top === roundedTop &&
      prevState.opacity === targetOpacity &&
      prevState.height === targetHeight
    ) {
      perfEnd("overlayUpdate");
      return;
    }

    // Update cached state
    prevOverlayStateRef.current = {
      top: roundedTop,
      opacity: targetOpacity,
      height: targetHeight,
    };

    // Apply styles using cssText for batched update (single reflow instead of multiple)
    perfStart("styleUpdate");
    const targetTransform = `translateY(${roundedTop}px)`;
    overlay.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: ${targetHeight};
      border-radius: inherit;
      pointer-events: none;
      background-color: ${overlay.style.backgroundColor};
      opacity: ${targetOpacity};
      transform: ${targetTransform};
      transition: transform 0s, opacity 40ms ease-out;
      will-change: transform;
      z-index: 2;
    `;
    perfEnd("styleUpdate", 1);
    perfEnd("overlayUpdate", 5);
  }, [getCachedVirtualItems]); // ✅ Stable - only changes when rowVirtualizer changes

  // Update overlay position when focused index changes
  // We use focusedIndex directly here to trigger updates, but the callback itself
  // uses a ref to avoid being recreated on every change (optimization)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusedIndex is intentionally in deps to trigger updates
  useLayoutEffect(() => {
    updateFocusOverlayImmediate();
  }, [focusedIndex, updateFocusOverlayImmediate]);

  // Update overlay position during scroll events
  // Use RAF throttling to limit updates to max 60fps during continuous scrolling
  useEffect(() => {
    const listElement = parentRef.current;
    if (!listElement) {
      return;
    }

    let rafId: number | null = null;
    let isScheduled = false;
    let lastScrollTime = 0;
    let isRapidScrolling = false;
    let restoreTimeoutId: number | null = null;

    // Performance tracking
    let scrollCount = 0;
    let rafCount = 0;
    let lastReport = performance.now();

    const reportMetrics = () => {
      if (PERF_TRACE_ENABLED) {
        const now = performance.now();
        const elapsed = now - lastReport;
        if (elapsed > 1000) {
          // Report every second
          const scrollFreq = (scrollCount / elapsed) * 1000;
          const rafFreq = (rafCount / elapsed) * 1000;
          console.log(
            `[PERF SCROLL] Scroll events: ${scrollFreq.toFixed(1)}/s | RAF callbacks: ${rafFreq.toFixed(1)}/s | Overlay updates: ${scrollMetrics.overlayUpdates} | Renders: ${renderCountRef.current}`
          );
          scrollCount = 0;
          rafCount = 0;
          scrollMetrics.overlayUpdates = 0;
          lastReport = now;
        }
      }
    };

    const handleScroll = () => {
      scrollCount++;
      scrollMetrics.events++;

      if (isScheduled) {
        reportMetrics();
        return; // Already scheduled an update for next frame
      }

      const now = performance.now();
      const timeSinceLastScroll = now - lastScrollTime;
      lastScrollTime = now;

      // Detect rapid scrolling (mouse wheel / trackpad) - consecutive scrolls within 50ms
      // During rapid scrolling, skip overlay updates entirely for better performance
      isRapidScrolling = timeSinceLastScroll < 50;

      // Clear any pending restore timeout
      if (restoreTimeoutId !== null) {
        clearTimeout(restoreTimeoutId);
        restoreTimeoutId = null;
      }

      if (isRapidScrolling) {
        // Hide overlay during rapid scroll for better performance
        const overlay = focusOverlayRef.current;
        if (overlay && overlay.style.opacity !== "0") {
          overlay.style.opacity = "0";
        }
        reportMetrics();
        return; // Skip RAF scheduling during rapid scroll
      }

      // Scrolling has slowed down - restore overlay after a brief delay
      restoreTimeoutId = window.setTimeout(() => {
        if (!isScheduled) {
          isScheduled = true;
          rafCount++;
          scrollMetrics.rafCallbacks++;
          rafId = requestAnimationFrame(() => {
            perfStart("scrollRAF");
            isScheduled = false;
            updateFocusOverlayImmediate();
            perfEnd("scrollRAF", 10);
            reportMetrics();
          });
        }
      }, 100); // Wait 100ms after scrolling slows to restore overlay
    };

    listElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      listElement.removeEventListener("scroll", handleScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (restoreTimeoutId !== null) {
        clearTimeout(restoreTimeoutId);
      }
    };
  }, [updateFocusOverlayImmediate]);

  useEffect(() => {
    if (listContainerEl && visibleRowCount >= 0) {
      updateFocusOverlayImmediate();
    }
  }, [updateFocusOverlayImmediate, listContainerEl, visibleRowCount]);

  useLayoutEffect(() => {
    if (focusedIndex >= 0) {
      const prev = prevFocusedIndexRef.current;
      const diff = focusedIndex - prev;

      if (skipNextLayoutScrollRef.current) {
        traceFocus(">>> useLayoutEffect: skipping scroll (already handled synchronously)");
        skipNextLayoutScrollRef.current = false;
        prevFocusedIndexRef.current = focusedIndex;
        return;
      }

      traceFocus(">>> useLayoutEffect[focusedIndex] running", {
        prev,
        current: focusedIndex,
        diff,
        visibleRowCount,
      });

      // Determine alignment based on jump size
      let align: "auto" | "center" | "end" | "start" = "auto";

      // Large forward jump (PageDown) - lock new focused item at bottom
      if (diff >= visibleRowCount) {
        align = "end";
        traceFocus(">>> Detected PageDown - using align=end");
      }
      // Large backward jump (PageUp) - lock new focused item at top
      else if (diff <= -visibleRowCount) {
        align = "start";
        traceFocus(">>> Detected PageUp - using align=start");
      } else if (Math.abs(diff) === 1) {
        // Single-step arrow navigation - use simple edge detection without forced reflow
        // Use "auto" alignment which lets TanStack Virtual decide based on its internal state
        // This avoids calling getVirtualItems() which causes layout thrashing
        align = "auto";
        traceFocus(">>> Single-step navigation - using align=auto");
      } else {
        // Multi-step jump (Home/End or programmatic) - align to appropriate edge
        align = diff > 0 ? "end" : "start";
        traceFocus(">>> Multi-step jump - aligning to edge", { align });
      }

      traceFocus(">>> About to call scrollToIndex", {
        index: focusedIndex,
        align,
      });

      rowVirtualizer.scrollToIndex(focusedIndex, {
        align,
      });

      traceFocus(">>> scrollToIndex completed");

      // Update previous value
      prevFocusedIndexRef.current = focusedIndex;
    }
  }, [focusedIndex, visibleRowCount, rowVirtualizer]);

  // Keyboard navigation (optimized to avoid recreation on file list changes)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input or if a dialog is open
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isInInput || settingsOpen || showHelp || selectedFile) {
        // Exception: Allow / to focus search from anywhere
        if (e.key === "/" && !settingsOpen && !showHelp) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
        // Exception: Allow Backspace for navigation when search is empty and in search input
        if (
          e.key === "Backspace" &&
          isInInput &&
          (searchQuery === "" || (target as HTMLInputElement).value === "") &&
          currentPathRef.current
        ) {
          // Check if cursor is at the beginning of input (no text to delete)
          const input = target as HTMLInputElement;
          if (input.selectionStart === 0 && input.selectionEnd === 0) {
            e.preventDefault();
            const pathParts = currentPathRef.current.split("/");
            const newPath = pathParts.slice(0, -1).join("/");
            setCurrentPath(newPath);
            setSelectedFile(null);
            return;
          }
        }
        return;
      }

      const files = filesRef.current;
      const fileCount = files.length;

      // Allow certain keys even when no files
      const alwaysAllowKeys = ["Backspace", "Escape", "/", "?", "F5"];
      if (fileCount === 0 && !alwaysAllowKeys.includes(e.key)) {
        return;
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (focusedIndex < 0) return;
          const next = Math.min(focusedIndex + 1, fileCount - 1);
          if (next === focusedIndex) break;

          // For key repeat (holding down arrow), use async scrolling to avoid layout thrashing
          if (e.repeat) {
            // Let TanStack Virtual handle scrolling smoothly without forced reflows
            updateFocus(next, { immediate: false });
          } else {
            // Single press - let layout effect handle scrolling
            updateFocus(next);
          }
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          if (focusedIndex < 0) return;
          const next = Math.max(focusedIndex - 1, 0);
          if (next === focusedIndex) break;

          // For key repeat (holding down arrow), use async scrolling to avoid layout thrashing
          if (e.repeat) {
            // Let TanStack Virtual handle scrolling smoothly without forced reflows
            updateFocus(next, { immediate: false });
          } else {
            // Single press - let layout effect handle scrolling
            updateFocus(next);
          }
          break;
        }

        case "Home":
          e.preventDefault();
          updateFocus(0);
          break;

        case "End":
          e.preventDefault();
          updateFocus(fileCount - 1);
          break;

        case "PageDown":
          e.preventDefault();
          {
            // Use estimated page size to avoid forced reflows during key repeat
            // TanStack Virtual will handle the actual scrolling smoothly
            const pageSize = visibleRowCount;
            const newIndex = Math.min(focusedIndex + pageSize, fileCount - 1);

            if (e.repeat) {
              // During key repeat, use async scrolling to avoid layout thrashing
              updateFocus(newIndex, { immediate: false });
            } else {
              // Single press - use synchronous scroll for instant feedback
              rowVirtualizer.scrollToIndex(newIndex, { align: "end" });
              skipNextLayoutScrollRef.current = true;
              updateFocus(newIndex, { immediate: true });
            }
          }
          break;

        case "PageUp":
          e.preventDefault();
          {
            // Use estimated page size to avoid forced reflows during key repeat
            // TanStack Virtual will handle the actual scrolling smoothly
            const pageSize = visibleRowCount;
            const newIndex = Math.max(focusedIndex - pageSize, 0);

            if (e.repeat) {
              // During key repeat, use async scrolling to avoid layout thrashing
              updateFocus(newIndex, { immediate: false });
            } else {
              // Single press - use synchronous scroll for instant feedback
              rowVirtualizer.scrollToIndex(newIndex, { align: "start" });
              skipNextLayoutScrollRef.current = true;
              updateFocus(newIndex, { immediate: true });
            }
          }
          break;
        case "Enter":
          e.preventDefault();
          {
            const current = focusedIndex;
            const file = files[current];
            if (file) {
              if (file.type === "directory") {
                navigationHistory.current.set(currentPathRef.current, {
                  focusedIndex: current,
                  scrollOffset: 0,
                  selectedFileName: file.name,
                });

                const newPath = currentPathRef.current
                  ? `${currentPathRef.current}/${file.name}`
                  : file.name;
                setCurrentPath(newPath);
                setSelectedFile(null);
              } else {
                const filePath = currentPathRef.current
                  ? `${currentPathRef.current}/${file.name}`
                  : file.name;
                setSelectedFile(filePath);
              }
            }
          }
          break;

        case "Backspace":
          e.preventDefault();
          if (currentPathRef.current) {
            const pathParts = currentPathRef.current.split("/");
            const newPath = pathParts.slice(0, -1).join("/");
            setCurrentPath(newPath);
            setSelectedFile(null);
          }
          break;

        case "Escape":
          e.preventDefault();
          setSelectedFile(null);
          setSearchQuery("");
          break;

        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;

        case "?":
          e.preventDefault();
          setShowHelp(true);
          break;

        case "F5":
          e.preventDefault();
          loadFiles(currentPathRef.current, true);
          break;

        default:
          // Incremental search - accumulate keystrokes to match file names
          if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
            // Clear any existing timeout
            if (searchTimeoutRef.current) {
              clearTimeout(searchTimeoutRef.current);
            }

            // Add this character to the search buffer
            searchBufferRef.current += e.key.toLowerCase();

            // Find first file matching the accumulated prefix
            const index = files.findIndex((f) =>
              f.name.toLowerCase().startsWith(searchBufferRef.current)
            );
            if (index !== -1) {
              updateFocus(index);
            }

            // Reset search buffer after 1 second of no typing
            searchTimeoutRef.current = window.setTimeout(() => {
              searchBufferRef.current = "";
            }, 1000);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    settingsOpen,
    showHelp,
    searchQuery,
    selectedFile,
    loadFiles,
    visibleRowCount,
    focusedIndex,
    updateFocus,
    rowVirtualizer,
  ]);

  const handleBreadcrumbClick = (index: number) => {
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, index + 1).join("/");
    setCurrentPath(newPath);
    setSelectedFile(null);
    // Blur any focused input
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Restoration will happen in useEffect after files are loaded
  };

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    navigate("/login");
  };

  const pathParts = currentPath ? currentPath.split("/") : [];

  // Memoized FileRow component for optimal performance
  // FileRow component styles - memoized outside to prevent recreation on every scroll
  const fileRowStyles = React.useMemo(
    () => ({
      iconBox: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        flexShrink: 0,
      },
      contentBox: {
        flex: 1,
        minWidth: 0,
      },
      chip: {
        flexShrink: 0,
      },
      buttonBase: {
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: "100%",
        width: "100%",
        px: 2,
        py: 1.5,
        cursor: "pointer",
        userSelect: "none",
        border: "none",
        borderRadius: theme.shape.borderRadius,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        "&:hover": {
          backgroundColor: theme.palette.action.hover,
        },
        "&:active": {
          backgroundColor: theme.palette.action.selected,
        },
      },
      buttonSelected: {
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: "100%",
        width: "100%",
        px: 2,
        py: 1.5,
        cursor: "pointer",
        userSelect: "none",
        border: "none",
        background: theme.palette.action.selected,
        borderRadius: theme.shape.borderRadius,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        "&:hover": {
          backgroundColor: theme.palette.action.hover,
        },
        "&:active": {
          backgroundColor: theme.palette.action.selected,
        },
      },
      buttonNotSelected: {
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: "100%",
        width: "100%",
        px: 2,
        py: 1.5,
        cursor: "pointer",
        userSelect: "none",
        border: "none",
        background: "transparent",
        borderRadius: theme.shape.borderRadius,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        "&:hover": {
          backgroundColor: theme.palette.action.hover,
        },
        "&:active": {
          backgroundColor: theme.palette.action.selected,
        },
      },
    }),
    [theme]
  );

  const FileRow = React.memo(
    React.forwardRef<
      HTMLDivElement,
      {
        file: FileEntry;
        index: number;
        isSelected: boolean;
        virtualStart: number;
        virtualSize: number;
        onClick: (file: FileEntry, index: number) => void;
      }
    >(({ file, index, isSelected, virtualStart, virtualSize, onClick }, ref) => {
      perfStart(`fileRow_${index}`);

      perfStart(`fileRow_${index}_formatting`);
      const secondaryInfo: string[] = [];
      if (file.size && file.type !== "directory") {
        secondaryInfo.push(formatFileSize(file.size));
      }
      if (file.modified_at) {
        secondaryInfo.push(formatDate(file.modified_at));
      }
      const secondaryText = secondaryInfo.join(" • ");
      perfEnd(`fileRow_${index}_formatting`, 1);

      perfStart(`fileRow_${index}_render`);
      const result = (
        <div
          ref={ref}
          data-index={index}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: `${virtualSize}px`,
            transform: `translateY(${virtualStart}px)`,
            willChange: "transform", // GPU acceleration hint
          }}
        >
          <Box
            component="button"
            tabIndex={-1}
            onClick={() => onClick(file, index)}
            sx={isSelected ? fileRowStyles.buttonSelected : fileRowStyles.buttonNotSelected}
          >
            <Box sx={fileRowStyles.iconBox}>
              {file.type === "directory" ? (
                <FolderIcon color="primary" />
              ) : (
                <FileIcon color="action" />
              )}
            </Box>
            <Box sx={fileRowStyles.contentBox}>
              <Typography variant="body2" noWrap title={file.name} color="text.primary">
                {file.name}
              </Typography>
              {secondaryText ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {secondaryText}
                </Typography>
              ) : null}
            </Box>
            {file.type === "directory" ? (
              <Chip label="Folder" size="small" variant="outlined" sx={fileRowStyles.chip} />
            ) : null}
          </Box>
        </div>
      );
      perfEnd(`fileRow_${index}_render`, 2);
      perfEnd(`fileRow_${index}`, 5);

      return result;
    }),
    // Custom comparison for optimal re-renders
    (prev, next) =>
      prev.index === next.index &&
      prev.isSelected === next.isSelected &&
      prev.file.name === next.file.name &&
      prev.file.modified_at === next.file.modified_at &&
      prev.file.size === next.file.size &&
      prev.virtualStart === next.virtualStart &&
      prev.virtualSize === next.virtualSize
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static">
        <Toolbar>
          <StorageIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ mr: 3 }}>
            Sambee
          </Typography>

          {connections.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 250, mr: 2 }}>
              <Select
                value={selectedConnectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                displayEmpty
                sx={{
                  color: "white",
                  ".MuiOutlinedInput-notchedOutline": {
                    borderColor: "rgba(255, 255, 255, 0.23)",
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: "rgba(255, 255, 255, 0.4)",
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    borderColor: "white",
                  },
                  ".MuiSvgIcon-root": {
                    color: "white",
                  },
                }}
              >
                {connections.map((conn) => (
                  <MenuItem key={conn.id} value={conn.id}>
                    {conn.name} ({conn.host}/{conn.share_name})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <IconButton
            color="inherit"
            onClick={() => setShowHelp(true)}
            sx={{ mr: 1 }}
            title="Keyboard Shortcuts (?)"
          >
            <KeyboardIcon />
          </IconButton>

          {isAdmin && (
            <IconButton
              color="inherit"
              onClick={() => setSettingsOpen(true)}
              sx={{ mr: 1 }}
              title="Settings"
            >
              <SettingsIcon />
            </IconButton>
          )}
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container
        maxWidth="lg"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          pt: 2,
          pb: 0,
          overflow: "hidden",
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {connections.length === 0 && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No SMB connections configured.
            {isAdmin && " Click the settings icon to add a connection."}
            {!isAdmin && " Please contact an administrator to configure connections."}
          </Alert>
        )}

        {selectedConnectionId && (
          <>
            <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Breadcrumbs>
                  <Link
                    component="button"
                    variant="body1"
                    onClick={() => {
                      setCurrentPath("");
                      setSelectedFile(null);
                    }}
                    sx={{ display: "flex", alignItems: "center" }}
                  >
                    <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
                    Root
                  </Link>
                  {pathParts.map((part, index) => (
                    <Link
                      key={pathParts.slice(0, index + 1).join("/")}
                      component="button"
                      variant="body1"
                      onClick={() => handleBreadcrumbClick(index)}
                    >
                      {part}
                    </Link>
                  ))}
                </Breadcrumbs>

                {files.length > 0 && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <IconButton
                      size="small"
                      onClick={() => loadFiles(currentPath, true)}
                      title="Refresh (F5)"
                      sx={{ mr: 1 }}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="body2" color="text.secondary">
                      Sort by:
                    </Typography>
                    <ToggleButtonGroup
                      value={sortBy}
                      exclusive
                      onChange={(_, newSort) => {
                        if (newSort !== null) setSortBy(newSort);
                      }}
                      size="small"
                    >
                      <ToggleButton value="name" aria-label="sort by name">
                        <SortByAlphaIcon fontSize="small" />
                      </ToggleButton>
                      <ToggleButton value="size" aria-label="sort by size">
                        <DataUsageIcon fontSize="small" />
                      </ToggleButton>
                      <ToggleButton value="modified" aria-label="sort by date">
                        <AccessTimeIcon fontSize="small" />
                      </ToggleButton>
                    </ToggleButtonGroup>
                    <Chip
                      label={`${sortedAndFilteredFiles.length}/${
                        files.length
                      } item${files.length !== 1 ? "s" : ""}`}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                )}
              </Box>
            </Paper>

            {files.length > 0 && (
              <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search files and folders... (press / to focus)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  inputRef={searchInputRef}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon />
                      </InputAdornment>
                    ),
                    endAdornment: searchQuery && (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearchQuery("")} edge="end">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Paper>
            )}

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ display: "flex", gap: 2, flex: 1, minHeight: 0, mb: 0 }}>
                <Paper
                  ref={listContainerRef}
                  elevation={2}
                  tabIndex={0}
                  sx={{
                    flex: 1,
                    minWidth: 300,
                    minHeight: 0,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    position: "relative",
                    "&:focus": {
                      outline: "none",
                    },
                  }}
                >
                  {sortedAndFilteredFiles.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: "center", flex: 1 }}>
                      <Typography color="text.secondary">
                        {searchQuery
                          ? `No files matching "${searchQuery}"`
                          : "This directory is empty"}
                      </Typography>
                      {searchQuery && (
                        <Button size="small" onClick={() => setSearchQuery("")} sx={{ mt: 1 }}>
                          Clear search
                        </Button>
                      )}
                    </Box>
                  ) : (
                    <>
                      <div
                        ref={focusOverlayRef}
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          top: 0,
                          height: ROW_HEIGHT,
                          borderRadius: theme.shape.borderRadius,
                          pointerEvents: "none",
                          backgroundColor: theme.palette.action.selected,
                          opacity: 0,
                          transform: "translateY(0px)",
                          transition: "none", // No transitions for instant visual feedback
                          willChange: "transform",
                          zIndex: 2,
                        }}
                      />
                      <div
                        ref={parentRef}
                        data-testid="virtual-list"
                        style={{
                          height: "100%",
                          overflow: "auto",
                          contain: "strict", // Optimize layout/paint/style calculations
                          willChange: "scroll-position", // Hint for GPU acceleration
                        }}
                      >
                        <div
                          style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: "100%",
                            position: "relative",
                          }}
                        >
                          {virtualItemsForRender.map((virtualItem) => (
                            <FileRow
                              ref={rowVirtualizer.measureElement}
                              key={virtualItem.key}
                              file={sortedAndFilteredFiles[virtualItem.index]}
                              index={virtualItem.index}
                              isSelected={virtualItem.index === focusedIndex}
                              virtualStart={virtualItem.start}
                              virtualSize={virtualItem.size}
                              onClick={handleFileClick}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </Paper>
              </Box>
            )}
          </>
        )}
      </Container>

      <SettingsDialog open={settingsOpen} onClose={handleSettingsClose} />

      {/* Keyboard Shortcuts Help Dialog */}
      <Dialog open={showHelp} onClose={() => setShowHelp(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogContent>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>
                  <strong>↑ / ↓</strong>
                </TableCell>
                <TableCell>Navigate through files</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Enter</strong>
                </TableCell>
                <TableCell>Open folder or select file</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Backspace</strong>
                </TableCell>
                <TableCell>Go up one directory level</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Escape</strong>
                </TableCell>
                <TableCell>Clear file selection and search</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Home / End</strong>
                </TableCell>
                <TableCell>Jump to first / last file</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>Page Up / Down</strong>
                </TableCell>
                <TableCell>Scroll through file list (10 items)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>/</strong>
                </TableCell>
                <TableCell>Focus search box</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>A-Z / 0-9</strong>
                </TableCell>
                <TableCell>Jump to file starting with letter</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>?</strong>
                </TableCell>
                <TableCell>Show this help dialog</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <strong>F5</strong>
                </TableCell>
                <TableCell>Refresh current directory</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Box sx={{ mt: 2, textAlign: "center" }}>
            <Button variant="contained" onClick={() => setShowHelp(false)}>
              Close
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {selectedFile && (
        <MarkdownPreview
          connectionId={selectedConnectionId}
          path={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </Box>
  );
};

export default Browser;
