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
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MarkdownPreview from "../components/Preview/MarkdownPreview";
import SettingsDialog from "../components/Settings/SettingsDialog";
import api from "../services/api";
import { logger } from "../services/logger";
import type { Connection, FileEntry } from "../types";
import { isApiError } from "../types";

const FOCUS_TRACE_ENABLED = false;

const traceFocus = (message: string, payload?: Record<string, unknown>) => {
  if (!FOCUS_TRACE_ENABLED) {
    return;
  }
  logger.info(message, payload);
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

  const updateFocus = React.useCallback(
    (next: number, options?: { flush?: boolean; immediate?: boolean }) => {
      const shouldFlush = options?.flush ?? false;
      const immediate = options?.immediate ?? false;

      const commit = () => {
        setFocusedIndex((prev) => (prev === next ? prev : next));
      };

      if (shouldFlush || immediate) {
        if (focusCommitRafRef.current !== null) {
          cancelAnimationFrame(focusCommitRafRef.current);
          focusCommitRafRef.current = null;
        }
        pendingFocusedIndexRef.current = null;
        if (shouldFlush) {
          flushSync(commit);
        } else {
          commit();
        }
        return;
      }

      pendingFocusedIndexRef.current = next;

      if (focusCommitRafRef.current !== null) {
        return;
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
    },
    []
  );

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
      console.error("Error loading connections:", err);
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
        // Note: scrollOffset tracking removed as it's not available in react-window v2 ListRef
        const currentScrollOffset = 0;
        navigationHistory.current.set(currentPath, {
          focusedIndex,
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
    [currentPath, focusedIndex, updateFocus]
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

  // TanStack Virtual: Initialize the virtualizer for efficient rendering of large lists
  const rowVirtualizer = useVirtualizer({
    count: sortedAndFilteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5, // Render 5 extra items above/below viewport for smoother scrolling
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
        // Restore scroll position after a short delay to ensure list is rendered
        setTimeout(() => {
          rowVirtualizer.scrollToIndex(restoredIndex, {
            align: "auto",
          });
        }, 0);
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

  const focusOverlayUpdateRafRef = React.useRef<number | null>(null);

  const updateFocusOverlayImmediate = React.useCallback(() => {
    const overlay = focusOverlayRef.current;
    const listElement = parentRef.current;

    if (!overlay || !listElement) {
      return;
    }

    if (focusedIndex < 0 || filesRef.current.length === 0) {
      if (overlay.style.opacity !== "0") {
        overlay.style.opacity = "0";
      }
      return;
    }

    const scrollTop = listElement.scrollTop;
    const availableHeight = listElement.clientHeight;
    const top = focusedIndex * ROW_HEIGHT - scrollTop;

    if (top < -ROW_HEIGHT || top > availableHeight) {
      if (overlay.style.opacity !== "0") {
        overlay.style.opacity = "0";
      }
      return;
    }

    const targetOpacity = "1";
    const targetTransform = `translateY(${Math.round(top)}px)`;

    if (overlay.style.opacity !== targetOpacity) {
      overlay.style.opacity = targetOpacity;
    }
    if (overlay.style.transform !== targetTransform) {
      overlay.style.transform = targetTransform;
    }
  }, [focusedIndex]);

  const queueFocusOverlayUpdate = React.useCallback(() => {
    if (focusOverlayUpdateRafRef.current !== null) {
      return;
    }
    focusOverlayUpdateRafRef.current = requestAnimationFrame(() => {
      focusOverlayUpdateRafRef.current = null;
      updateFocusOverlayImmediate();
    });
  }, [updateFocusOverlayImmediate]);

  useEffect(() => {
    return () => {
      if (focusOverlayUpdateRafRef.current !== null) {
        cancelAnimationFrame(focusOverlayUpdateRafRef.current);
        focusOverlayUpdateRafRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    updateFocusOverlayImmediate();
  }, [updateFocusOverlayImmediate]);

  useEffect(() => {
    const listElement = parentRef.current;
    if (!listElement) {
      return;
    }

    const handleScroll = () => {
      queueFocusOverlayUpdate();
    };

    listElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      listElement.removeEventListener("scroll", handleScroll);
    };
  }, [queueFocusOverlayUpdate]);

  useEffect(() => {
    if (listContainerEl && visibleRowCount >= 0) {
      queueFocusOverlayUpdate();
    }
  }, [queueFocusOverlayUpdate, listContainerEl, visibleRowCount]);

  // Get current viewport metrics from TanStack Virtual
  const getViewportMetrics = React.useCallback(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    if (virtualItems.length === 0) {
      return {
        firstVisible: 0,
        lastVisible: 0,
        visibleCapacity: 0,
      };
    }
    const firstVisible = virtualItems[0].index;
    const lastVisible = virtualItems[virtualItems.length - 1].index;
    return {
      firstVisible,
      lastVisible,
      visibleCapacity: virtualItems.length,
    };
  }, [rowVirtualizer]);

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
      } else {
        // Single-step arrow navigation
        const viewport = getViewportMetrics();
        const { firstVisible, lastVisible } = viewport;
        const isCurrentlyVisible = focusedIndex >= firstVisible && focusedIndex <= lastVisible;
        traceFocus(">>> Layout visibility snapshot", {
          firstVisible,
          lastVisible,
          isCurrentlyVisible,
        });

        if (diff === 1 && prev === lastVisible) {
          align = "end";
          traceFocus(">>> Layout: diff=1 and prev at bottom -> align=end");
        } else if (diff === -1 && prev === firstVisible) {
          align = "start";
          traceFocus(">>> Layout: diff=-1 and prev at top -> align=start");
        } else if (!isCurrentlyVisible) {
          align = diff >= 0 ? "end" : "start";
          traceFocus(">>> Layout: not visible -> aligning", { align });
        }
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
  }, [focusedIndex, visibleRowCount, getViewportMetrics, rowVirtualizer]);

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

          // For key repeat (holding down arrow), ensure smooth scrolling
          if (e.repeat) {
            // Use synchronous scroll for immediate visual feedback
            const viewport = getViewportMetrics();
            const { lastVisible } = viewport;

            if (focusedIndex >= lastVisible - 1) {
              // Near bottom edge - scroll to keep item visible at bottom
              rowVirtualizer.scrollToIndex(next, { align: "end" });
              skipNextLayoutScrollRef.current = true;
            }
            updateFocus(next, { immediate: true });
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

          // For key repeat (holding down arrow), ensure smooth scrolling
          if (e.repeat) {
            // Use synchronous scroll for immediate visual feedback
            const viewport = getViewportMetrics();
            const { firstVisible } = viewport;

            if (focusedIndex <= firstVisible + 1) {
              // Near top edge - scroll to keep item visible at top
              rowVirtualizer.scrollToIndex(next, { align: "start" });
              skipNextLayoutScrollRef.current = true;
            }
            updateFocus(next, { immediate: true });
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
            // Use actual visible items count for more accurate page jumps
            const viewport = getViewportMetrics();
            const pageSize = viewport.visibleCapacity || visibleRowCount;
            const newIndex = Math.min(focusedIndex + pageSize, fileCount - 1);

            // Synchronously scroll and update focus for instant feedback
            rowVirtualizer.scrollToIndex(newIndex, { align: "end" });
            skipNextLayoutScrollRef.current = true;
            updateFocus(newIndex, { immediate: true });
          }
          break;

        case "PageUp":
          e.preventDefault();
          {
            // Use actual visible items count for more accurate page jumps
            const viewport = getViewportMetrics();
            const pageSize = viewport.visibleCapacity || visibleRowCount;
            const newIndex = Math.max(focusedIndex - pageSize, 0);

            // Synchronously scroll and update focus for instant feedback
            rowVirtualizer.scrollToIndex(newIndex, { align: "start" });
            skipNextLayoutScrollRef.current = true;
            updateFocus(newIndex, { immediate: true });
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
    getViewportMetrics,
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
                          transition: "transform 0s, opacity 40ms ease-out",
                          willChange: "transform",
                          zIndex: 2,
                        }}
                      />
                      <div
                        ref={parentRef}
                        style={{
                          height: "100%",
                          overflow: "auto",
                          contain: "strict",
                        }}
                      >
                        <div
                          style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: "100%",
                            position: "relative",
                          }}
                        >
                          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                            const file = sortedAndFilteredFiles[virtualItem.index];
                            const isSelected = virtualItem.index === focusedIndex;

                            const secondaryInfo: string[] = [];
                            if (file.size && file.type !== "directory") {
                              secondaryInfo.push(formatFileSize(file.size));
                            }
                            if (file.modified_at) {
                              secondaryInfo.push(formatDate(file.modified_at));
                            }
                            const secondaryText = secondaryInfo.join(" • ");

                            return (
                              <div
                                key={virtualItem.key}
                                data-index={virtualItem.index}
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: "100%",
                                  height: `${virtualItem.size}px`,
                                  transform: `translateY(${virtualItem.start}px)`,
                                }}
                              >
                                <Box
                                  role="option"
                                  tabIndex={-1}
                                  aria-selected={isSelected}
                                  onClick={() => handleFileClick(file, virtualItem.index)}
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 2,
                                    height: "100%",
                                    px: 2,
                                    py: 1.5,
                                    cursor: "pointer",
                                    userSelect: "none",
                                    borderRadius: theme.shape.borderRadius,
                                    transition: "background-color 80ms ease-out",
                                    "&:hover": {
                                      backgroundColor: theme.palette.action.hover,
                                    },
                                    "&:active": {
                                      backgroundColor: theme.palette.action.selected,
                                    },
                                  }}
                                >
                                  <Box
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: 36,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {file.type === "directory" ? (
                                      <FolderIcon color="primary" />
                                    ) : (
                                      <FileIcon color="action" />
                                    )}
                                  </Box>
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography
                                      variant="body2"
                                      noWrap
                                      title={file.name}
                                      color="text.primary"
                                    >
                                      {file.name}
                                    </Typography>
                                    {secondaryText ? (
                                      <Typography variant="caption" color="text.secondary" noWrap>
                                        {secondaryText}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                  {file.type === "directory" ? (
                                    <Chip
                                      label="Folder"
                                      size="small"
                                      variant="outlined"
                                      sx={{ flexShrink: 0 }}
                                    />
                                  ) : null}
                                </Box>
                              </div>
                            );
                          })}
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
