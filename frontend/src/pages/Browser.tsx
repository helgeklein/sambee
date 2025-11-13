import {
  AccessTime as AccessTimeIcon,
  ArrowUpward as ArrowUpwardIcon,
  Clear as ClearIcon,
  DataUsage as DataUsageIcon,
  InsertDriveFile as FileIcon,
  Folder as FolderIcon,
  Home as HomeIcon,
  KeyboardOutlined as KeyboardIcon,
  Menu as MenuIcon,
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
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import HamburgerMenu from "../components/Mobile/HamburgerMenu";
import type { PreviewComponent } from "../components/Preview/PreviewRegistry";
import { getPreviewComponent, isImageFile } from "../components/Preview/PreviewRegistry";
import SettingsDialog from "../components/Settings/SettingsDialog";
import api from "../services/api";
import { logger } from "../services/logger";
import type { Connection, FileEntry } from "../types";
import { isApiError } from "../types";

// Performance Profiling System
// =============================
// To enable detailed performance profiling, set PERF_TRACE_ENABLED to true:
//
// When PERF_TRACE_ENABLED is true, you'll see console output like:
//   [PERF] scrollRAF: 5.67ms
//   [PERF] fileRow_0: 2.34ms (per visible row)
//   [PERF] fileRow_0_formatting: 0.12ms
//   [PERF] fileRow_0_render: 1.89ms
//   [PERF SCROLL] Scroll events: 45.2/s | RAF callbacks: 60.0/s | Renders: 12
//
// This helps identify which operations are consuming CPU during scrolling:
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

const PERF_TRACE_ENABLED = false; // Enable to see performance metrics in console

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

type SortField = "name" | "size" | "modified";

const ROW_HEIGHT = 68;
const DIRECTORY_CACHE_TTL_MS = 30_000;

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
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [previewInfo, setPreviewInfo] = useState<{
    path: string;
    mimeType: string;
    images?: string[];
    currentIndex?: number;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [sortDirection, _setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  const currentPreviewIndexRef = React.useRef<number | null>(null);
  const currentPreviewImagesRef = React.useRef<string[] | undefined>(undefined);
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

  const checkAdminStatus = useCallback(async () => {
    try {
      const user = await api.getCurrentUser();
      setIsAdmin(user.is_admin);
    } catch (err) {
      logger.warn("Failed to verify admin status", { error: err });
      setIsAdmin(false);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      setLoadingConnections(true);
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
    } finally {
      setLoadingConnections(false);
    }
  }, [navigate, params.connectionId, slugifyConnectionName]);

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
        logger.error("Error loading directory", {
          error: err,
          connectionId: selectedConnectionId,
          path,
        });

        // Extract error message from API response if available
        let errorMessage = "Failed to load directory contents. Please try again.";

        // Check for network errors first (before API errors)
        if (err && typeof err === "object" && "message" in err && !isApiError(err)) {
          const error = err as Error & { code?: string };
          const message = error.message;
          if (
            message.includes("Network Error") ||
            message.includes("ECONNREFUSED") ||
            error.code === "ECONNREFUSED"
          ) {
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
      const connection = connections.find((c) => c.id === connectionId);
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

  // Keep refs in sync with state for WebSocket callbacks
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
      logger.debug("[URL Navigation useEffect] Setting currentPath to:", {
        path: decodedPath,
      });
      setCurrentPath(decodedPath);
    } else {
      logger.debug("[URL Navigation useEffect] Path unchanged, skipping update");
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
    setPreviewInfo(null);
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
      .filter((f) => f.type === "file" && isImageFile(f.name))
      .map((f) => (currentPath ? `${currentPath}/${f.name}` : f.name));
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

        logger.info("Navigating to directory", {
          from: currentPath,
          to: newPath,
          directory: file.name,
        });

        setCurrentPath(newPath);
        setPreviewInfo(null);
        // Blur any focused element when navigating so keyboard shortcuts work
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;

        // Get MIME type - fallback to guessing from filename if backend didn't provide it
        let mimeType = file.mime_type;
        if (!mimeType) {
          // Guess MIME type from file extension
          const ext = file.name.toLowerCase().split(".").pop();
          const mimeTypeMap: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            md: "text/markdown",
            markdown: "text/markdown",
            txt: "text/plain",
            pdf: "application/pdf",
          };
          mimeType = ext
            ? mimeTypeMap[ext] || "application/octet-stream"
            : "application/octet-stream";
        }

        // Check if it's an image for gallery mode
        const isImage = isImageFile(file.name);

        logger.info("File selected for preview", {
          path: filePath,
          fileName: file.name,
          size: file.size,
          mimeType,
          mimeTypeSource: file.mime_type ? "backend" : "guessed",
          isImage,
          imageFilesCount: imageFiles.length,
        });

        if (isImage && imageFiles.length > 0) {
          // Gallery mode for images
          const imageIndex = imageFiles.indexOf(filePath);
          logger.info("Opening image in gallery mode", {
            imageIndex,
            totalImages: imageFiles.length,
          });
          const effectiveIndex = imageIndex >= 0 ? imageIndex : 0;
          currentPreviewIndexRef.current = effectiveIndex;
          currentPreviewImagesRef.current = imageFiles;
          setPreviewInfo({
            path: filePath,
            mimeType,
            images: imageFiles,
            currentIndex: effectiveIndex,
          });
        } else {
          currentPreviewIndexRef.current = null;
          currentPreviewImagesRef.current = undefined;
          // Single file preview
          logger.info("Opening file in single preview mode", {
            isImage,
            hasPreviewSupport: mimeType !== "application/octet-stream",
          });
          setPreviewInfo({
            path: filePath,
            mimeType,
          });
        }

        // Keep old behavior for markdown (backward compatibility)
        // Preview component is managed exclusively through previewInfo state
      }
    },
    [currentPath, updateFocus, imageFiles, focusedIndex]
  );

  const handlePreviewIndexChange = useCallback((index: number) => {
    currentPreviewIndexRef.current = index;
    setPreviewInfo((prev) => {
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

  const handlePreviewClose = useCallback(() => {
    const images = currentPreviewImagesRef.current ?? previewInfo?.images;
    const indexFromRef = currentPreviewIndexRef.current ?? previewInfo?.currentIndex ?? null;

    let finalPath: string | undefined;
    if (images && images.length > 0) {
      const clampedIndex =
        indexFromRef !== null ? Math.min(Math.max(indexFromRef, 0), images.length - 1) : 0;
      finalPath = images[clampedIndex];
    } else if (previewInfo?.path) {
      finalPath = previewInfo.path;
    }

    setPreviewInfo(null);
    currentPreviewIndexRef.current = null;
    currentPreviewImagesRef.current = undefined;

    if (!finalPath) {
      return;
    }

    const targetIndex = sortedAndFilteredFiles.findIndex((file) => {
      if (file.type !== "file") {
        return false;
      }
      const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      return fullPath === finalPath;
    });

    if (targetIndex >= 0) {
      updateFocus(targetIndex, { immediate: true });
    }
  }, [currentPath, previewInfo, sortedAndFilteredFiles, updateFocus]);

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

  // Keyboard navigation (optimized to avoid recreation on file list changes)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input or if a dialog is open
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isInInput || settingsOpen || showHelp || previewInfo) {
        // Exception: Allow / to focus search from anywhere
        if (e.key === "/" && !settingsOpen && !showHelp) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
        // Exception: Allow ArrowDown in search box to move to first file in list
        if (e.key === "ArrowDown" && isInInput && target === searchInputRef.current) {
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
            setPreviewInfo(null);
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

          // If at first item (index 0), move focus to search box
          if (focusedIndex === 0 && searchInputRef.current) {
            searchInputRef.current.focus();
            return;
          }

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
              handleFileClick(file, current);
            }
          }
          break;

        case "Backspace":
          e.preventDefault();
          if (currentPathRef.current) {
            const pathParts = currentPathRef.current.split("/");
            const newPath = pathParts.slice(0, -1).join("/");
            setCurrentPath(newPath);
            setPreviewInfo(null);
          }
          break;

        case "Escape":
          e.preventDefault();
          setPreviewInfo(null);
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
          loadFilesRef.current?.(currentPathRef.current, true);
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
    previewInfo,
    visibleRowCount,
    focusedIndex,
    updateFocus,
    rowVirtualizer,
    listContainerEl,
    handleFileClick,
  ]);

  const handleBreadcrumbClick = (index: number) => {
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, index + 1).join("/");
    setCurrentPath(newPath);
    setPreviewInfo(null);
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
  const currentDirectoryName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "Root";
  const canNavigateUp = currentPath !== "";

  const handleNavigateUp = () => {
    if (!canNavigateUp) return;
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, -1).join("/");
    setCurrentPath(newPath);
    setPreviewInfo(null);
  };

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
        borderRadius: 0,
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
        borderRadius: 0,
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
        borderRadius: 0,
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
            aria-label={`${file.type === "directory" ? "Folder" : "File"}: ${file.name}${secondaryText ? `, ${secondaryText}` : ""}`}
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

  // Get virtual items for rendering - this will be called during each render,
  // but TanStack Virtual internally optimizes this call
  const virtualItemsForRender = rowVirtualizer.getVirtualItems();

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
          setPreviewInfo(null);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={handleLogout}
        isAdmin={isAdmin}
      />

      <AppBar position="static">
        <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
          {/* Mobile: Hamburger + Current Directory + Up Button */}
          {isMobile ? (
            <>
              <IconButton
                color="inherit"
                edge="start"
                onClick={() => setDrawerOpen(true)}
                sx={{
                  mr: 1,
                  minWidth: 44,
                  minHeight: 44,
                }}
                aria-label="Open menu"
              >
                <MenuIcon />
              </IconButton>
              <Typography
                variant="body1"
                component="div"
                sx={{
                  flexGrow: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: "bold",
                }}
              >
                {currentDirectoryName}
              </Typography>
              <IconButton
                color="inherit"
                onClick={handleNavigateUp}
                disabled={!canNavigateUp}
                title="Navigate up"
                aria-label="Navigate to parent directory"
                sx={{
                  minWidth: 44,
                  minHeight: 44,
                }}
              >
                <ArrowUpwardIcon />
              </IconButton>
            </>
          ) : (
            /* Desktop: Original layout */
            <>
              <StorageIcon sx={{ mr: 2 }} />
              <Typography variant="h6" component="div" sx={{ mr: 3 }}>
                Sambee
              </Typography>

              {connections.length > 0 && (
                <FormControl
                  size="small"
                  sx={{
                    minWidth: 250,
                    mr: 2,
                  }}
                >
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
            </>
          )}
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

        {loadingConnections && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Loading connections...
          </Alert>
        )}

        {connections.length === 0 && !error && !loadingConnections && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No SMB connections configured.
            {isAdmin && " Click the settings icon to add a connection."}
            {!isAdmin && " Please contact an administrator to configure connections."}
          </Alert>
        )}

        {selectedConnectionId && (
          <>
            {/* Desktop: Breadcrumbs and controls header */}
            {!isMobile && (
              <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
                <Box
                  display="flex"
                  flexDirection={{ xs: "column", md: "row" }}
                  gap={{ xs: 2, md: 0 }}
                  justifyContent="space-between"
                  alignItems={{ xs: "stretch", md: "center" }}
                >
                  <Breadcrumbs
                    separator="/"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      "& .MuiBreadcrumbs-ol": {
                        flexWrap: "wrap",
                      },
                    }}
                  >
                    <Link
                      component="button"
                      variant="body1"
                      onClick={() => {
                        setCurrentPath("");
                        setPreviewInfo(null);
                      }}
                      sx={{ display: "flex", alignItems: "center" }}
                      aria-label="Navigate to root directory"
                    >
                      <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
                      Root
                    </Link>
                    {/* Desktop: Show all segments */}
                    {pathParts.map((part, index) => {
                      const isLast = index === pathParts.length - 1;
                      if (isLast) {
                        // Last segment is non-clickable
                        return (
                          <Typography
                            key={pathParts.slice(0, index + 1).join("/")}
                            variant="body1"
                            color="text.primary"
                          >
                            {part}
                          </Typography>
                        );
                      }
                      return (
                        <Link
                          key={pathParts.slice(0, index + 1).join("/")}
                          component="button"
                          variant="body1"
                          onClick={() => handleBreadcrumbClick(index)}
                          aria-label={`Navigate to ${part}`}
                        >
                          {part}
                        </Link>
                      );
                    })}
                  </Breadcrumbs>

                  {files.length > 0 && (
                    <Box display="flex" alignItems="center" gap={1}>
                      <IconButton
                        size="small"
                        onClick={() => loadFiles(currentPath, true)}
                        title="Refresh (F5)"
                        aria-label="Refresh file list"
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
            )}

            {files.length > 0 && (
              <Paper
                elevation={2}
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  mb: 2,
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  backgroundColor: "background.paper",
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  placeholder={
                    isMobile ? "Search..." : "Search files and folders... (press / to focus)"
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  inputRef={searchInputRef}
                  sx={{
                    "& .MuiInputBase-root": {
                      fontSize: { xs: "16px", sm: "14px" }, // Prevent zoom on iOS
                    },
                    "& .MuiInputBase-input": {
                      padding: { xs: "10px 14px", sm: "8.5px 14px" }, // Ensure min 44px touch target
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize={isMobile ? "medium" : "small"} />
                      </InputAdornment>
                    ),
                    endAdornment: searchQuery && (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setSearchQuery("")}
                          edge="end"
                          sx={{
                            minWidth: { xs: 44, sm: "auto" },
                            minHeight: { xs: 44, sm: "auto" },
                          }}
                          aria-label="Clear search"
                        >
                          <ClearIcon fontSize={isMobile ? "medium" : "small"} />
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
                    <div
                      ref={parentRef}
                      data-testid="virtual-list"
                      style={{
                        height: "100%",
                        overflow: "auto",
                        WebkitOverflowScrolling: "touch", // Smooth scrolling on iOS
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
      {previewInfo && (
        <DynamicPreview
          connectionId={selectedConnectionId}
          previewInfo={previewInfo}
          onClose={handlePreviewClose}
          onIndexChange={handlePreviewIndexChange}
        />
      )}
    </Box>
  );
};

// Dynamic Preview Component
// Loads the appropriate preview component based on MIME type
const DynamicPreview: React.FC<{
  connectionId: string;
  previewInfo: {
    path: string;
    mimeType: string;
    images?: string[];
    currentIndex?: number;
  };
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}> = ({ connectionId, previewInfo, onClose, onIndexChange }) => {
  const [PreviewComponent, setPreviewComponent] = useState<PreviewComponent | null>(null);

  useEffect(() => {
    let mounted = true;

    logger.info("DynamicPreview: Loading preview component", {
      mimeType: previewInfo.mimeType,
    });

    getPreviewComponent(previewInfo.mimeType).then((component) => {
      if (mounted) {
        logger.info("DynamicPreview: Preview component loaded", {
          mimeType: previewInfo.mimeType,
          componentFound: !!component,
        });
        if (component) {
          setPreviewComponent(() => component);
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [previewInfo.mimeType]); // Only reload component when MIME type changes, not path

  if (!PreviewComponent) {
    logger.debug("DynamicPreview: No preview component yet", {
      mimeType: previewInfo.mimeType,
    });
    return null;
  }

  logger.debug("DynamicPreview: Rendering preview component", {
    mimeType: previewInfo.mimeType,
  });

  return (
    <PreviewComponent
      connectionId={connectionId}
      path={previewInfo.path}
      onClose={onClose}
      images={previewInfo.images}
      currentIndex={previewInfo.currentIndex}
      onCurrentIndexChange={onIndexChange}
    />
  );
};

export default Browser;
