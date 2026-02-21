/**
 * FileBrowser Component — Page-Level Orchestrator
 * =================================================
 *
 * Coordinates one or two file-browser panes with page-level concerns:
 * - Connection management and loading
 * - URL synchronisation (browser history, back/forward — left pane only)
 * - WebSocket connection for real-time directory change notifications
 * - Keyboard shortcut registration (routed to the active pane)
 * - Global dialogs (settings, help)
 * - Responsive layout decisions
 * - Dual-pane layout toggle and pane focus management
 *
 * All per-pane state (directory listing, sorting, focus, caching, viewer,
 * virtualizer, CRUD dialogs, etc.) is delegated to `useFileBrowserPane`.
 * Per-pane rendering is handled by `FileBrowserPane`.
 *
 * @see useFileBrowserPane — manages all per-pane state and logic
 * @see FileBrowserPane — renders a single pane's UI (breadcrumbs, file list, etc.)
 */

import { AppBar, Box, Container, Divider, Snackbar, Toolbar, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DesktopToolbar } from "../components/FileBrowser/DesktopToolbar";
import { DynamicViewer } from "../components/FileBrowser/DynamicViewer";
import { FileBrowserAlerts } from "../components/FileBrowser/FileBrowserAlerts";
import { MobileToolbar } from "../components/FileBrowser/MobileToolbar";
import { SecondaryActionStrip } from "../components/FileBrowser/SecondaryActionStrip";
import { KeyboardShortcutsHelp } from "../components/KeyboardShortcutsHelp";
import HamburgerMenu from "../components/Mobile/HamburgerMenu";
import { MobileSettingsDrawer } from "../components/Mobile/MobileSettingsDrawer";
import SettingsDialog, { type SettingsCategory } from "../components/Settings/SettingsDialog";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, PANE_SHORTCUTS } from "../config/keyboardShortcuts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import api from "../services/api";
import { logger } from "../services/logger";
import type { Connection } from "../types";
import { isApiError } from "../types";
import { FileBrowserPane } from "./FileBrowser/FileBrowserPane";
import type { PaneId, PaneMode } from "./FileBrowser/types";
import { ACTIVE_PANE_QUERY_KEY, ACTIVE_PANE_STORAGE_KEY, DUAL_PANE_STORAGE_KEY, RIGHT_PANE_QUERY_KEY } from "./FileBrowser/types";
import { useFileBrowserPane } from "./FileBrowser/useFileBrowserPane";

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
  const [searchParams] = useSearchParams();
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
  // Touch devices start without focus indicator; desktop shows focus on load
  const [isUsingKeyboard, setIsUsingKeyboard] = useState(!hasTouchInput);

  // ──────────────────────────────────────────────────────────────────────────
  // Global Page State
  // ──────────────────────────────────────────────────────────────────────────

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory>("appearance");
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileSettingsInitialView, setMobileSettingsInitialView] = useState<"main" | "appearance" | "connections">("main");
  const [showHelp, setShowHelp] = useState(false);
  const [companionHintOpen, setCompanionHintOpen] = useState(false);

  // ──────────────────────────────────────────────────────────────────────────
  // Dual-Pane State
  // ──────────────────────────────────────────────────────────────────────────

  /** Layout mode: single pane (default) or side-by-side dual pane. */
  const [paneMode, setPaneMode] = useState<PaneMode>(() => {
    // If the URL contains a p2 query parameter, activate dual mode automatically
    const urlP2 = new URLSearchParams(window.location.search).get(RIGHT_PANE_QUERY_KEY);
    if (urlP2) return "dual";
    // Otherwise fall back to localStorage preference
    const saved = localStorage.getItem(DUAL_PANE_STORAGE_KEY);
    return saved === "dual" ? "dual" : "single";
  });

  /** Which pane is currently active (receives keyboard input and toolbar actions). */
  const [activePaneId, setActivePaneId] = useState<PaneId>(() => {
    // If the URL specifies an active pane, use it
    const urlActive = new URLSearchParams(window.location.search).get(ACTIVE_PANE_QUERY_KEY);
    if (urlActive === "2") return "right";
    if (urlActive === "1") return "left";
    // Otherwise fall back to localStorage
    const saved = localStorage.getItem(ACTIVE_PANE_STORAGE_KEY);
    return saved === "right" ? "right" : "left";
  });

  // URL synchronization flags to prevent circular updates
  const isInitializing = React.useRef<boolean>(true); // Avoid URL updates during initial mount
  const isUpdatingFromUrl = React.useRef<boolean>(false); // Avoid navigate() during back/forward

  // WebSocket for real-time directory updates
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Pane Hooks — all per-pane state and logic
  // ──────────────────────────────────────────────────────────────────────────

  // Left pane — always present, synced with URL
  const leftPane = useFileBrowserPane({
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen,
    isActive: activePaneId === "left",
    onCompanionHint: () => setCompanionHintOpen(true),
  });

  // Right pane — always instantiated (React hooks rule: no conditional hooks),
  // but only renders in dual mode. Disabled when not in dual mode.
  const rightPane = useFileBrowserPane({
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen || paneMode === "single",
    isActive: activePaneId === "right" && paneMode === "dual",
    onCompanionHint: () => setCompanionHintOpen(true),
  });

  /**
   * Active pane — the pane that receives keyboard input and toolbar actions.
   * In single-pane mode, always the left pane. In dual mode, whichever has focus.
   */
  const isDualMode = paneMode === "dual" && !useCompactLayout;
  const effectiveActivePaneId = isDualMode ? activePaneId : "left";
  const effectiveActivePaneIdRef = React.useRef(effectiveActivePaneId);
  effectiveActivePaneIdRef.current = effectiveActivePaneId;
  const activePane = effectiveActivePaneId === "left" ? leftPane : rightPane;

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
  // API & Data Loading (Global)
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: setConnectionId and setError are stable React state setters from the pane hook
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
        }
        // Invalid connection slug in URL - redirect to /browse
        navigate("/browse", { replace: true });
        return;
      }

      // No URL param, use localStorage or first
      const savedConnectionId = localStorage.getItem("selectedConnectionId");
      let autoSelectedConnection: Connection | undefined;

      if (savedConnectionId && data.find((c: Connection) => c.id === savedConnectionId)) {
        autoSelectedConnection = data.find((c: Connection) => c.id === savedConnectionId);
        leftPane.setConnectionId(savedConnectionId);
      } else if (data.length > 0 && data[0]) {
        autoSelectedConnection = data[0];
        leftPane.setConnectionId(data[0].id);
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
          leftPane.setError("Access denied. Please contact an administrator to configure connections.");
        } else {
          leftPane.setError("Failed to load connections. Please try again.");
        }
      } else {
        leftPane.setError("Failed to load connections. Please try again.");
      }
    } finally {
      setLoadingConnections(false);
    }
  }, [navigate, params.connectionId, slugifyConnectionName]);

  /**
   * encodePath
   *
   * Encodes a file path for use in URLs — each segment is percent-encoded
   * individually but slashes are kept as literal '/' for readability.
   */
  const encodePath = useCallback((path: string): string => {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }, []);

  /**
   * updateUrl
   *
   * Builds the full URL from both panes' state and navigates to it.
   * Left pane is encoded in the path segment (backward-compatible).
   * Right pane is encoded as `?p2=connection-slug/path` query parameter.
   * Active pane is encoded as `&active=2` when the right pane is focused.
   *
   * Single-pane mode produces a clean URL with no query string.
   */
  const updateUrl = useCallback(() => {
    if (isInitializing.current) return;
    if (isUpdatingFromUrl.current) return;

    // ── Left pane (path segment) ──
    const leftConnId = leftPane.connectionIdRef.current;
    const leftPath = leftPane.currentPathRef.current;
    const leftConnection = connections.find((c: Connection) => c.id === leftConnId);
    if (!leftConnection) return;

    const leftSlug = slugifyConnectionName(leftConnection.name);
    const leftEncodedPath = encodePath(leftPath);
    let newUrl = `/browse/${leftSlug}${leftEncodedPath ? `/${leftEncodedPath}` : ""}`;

    // ── Right pane (query parameter) — only in dual mode ──
    const rightConnId = rightPane.connectionIdRef.current;
    const rightPath = rightPane.currentPathRef.current;
    const currentIsDual = paneMode === "dual" && !useCompactLayout;

    if (currentIsDual && rightConnId) {
      const rightConnection = connections.find((c: Connection) => c.id === rightConnId);
      if (rightConnection) {
        const rightSlug = slugifyConnectionName(rightConnection.name);
        const rightEncodedPath = encodePath(rightPath);
        const p2Value = `${rightSlug}${rightEncodedPath ? `/${rightEncodedPath}` : ""}`;

        const qp = new URLSearchParams();
        qp.set(RIGHT_PANE_QUERY_KEY, p2Value);
        if (activePaneId === "right") {
          qp.set(ACTIVE_PANE_QUERY_KEY, "2");
        }
        newUrl += `?${qp.toString()}`;
      }
    }

    // Only navigate if URL actually changed
    const currentFull = location.pathname + location.search;
    if (currentFull !== newUrl) {
      navigate(newUrl, { replace: false });
    }
  }, [
    connections,
    slugifyConnectionName,
    encodePath,
    paneMode,
    useCompactLayout,
    activePaneId,
    location.pathname,
    location.search,
    navigate,
    leftPane,
    rightPane,
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // Component Lifecycle Effects
  // ──────────────────────────────────────────────────────────────────────────

  // Initial load - run once on mount.
  // The `cancelled` flag prevents the second StrictMode invocation (and HMR
  // re-mounts) from issuing duplicate API calls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only once on mount to avoid aborting requests
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      await loadConnections();
      if (cancelled) return;
      await checkAdminStatus();
    };
    init();

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize state from URL after connections are loaded
  // biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName uses closure, including it causes re-initialization
  useEffect(() => {
    if (connections.length === 0) return; // Wait for connections to load

    // ── Left pane: restore from path params ──
    if (params.connectionId) {
      const connection = getConnectionByName(params.connectionId);
      if (connection) {
        leftPane.setConnectionId(connection.id);
        const urlPath = params["*"] || "";
        leftPane.setCurrentPath(decodeURIComponent(urlPath));
      }
    }

    // ── Right pane: restore from ?p2= query parameter ──
    const p2 = searchParams.get(RIGHT_PANE_QUERY_KEY);
    if (p2) {
      const slashIdx = p2.indexOf("/");
      const rightSlug = slashIdx >= 0 ? p2.slice(0, slashIdx) : p2;
      const rightPath = slashIdx >= 0 ? decodeURIComponent(p2.slice(slashIdx + 1)) : "";
      const rightConn = getConnectionByName(rightSlug);
      if (rightConn) {
        setPaneMode("dual");
        rightPane.setConnectionId(rightConn.id);
        rightPane.setCurrentPath(rightPath);
        localStorage.setItem(DUAL_PANE_STORAGE_KEY, "dual");
      }
    }

    // ── Active pane: restore from ?active= ──
    const activeParam = searchParams.get(ACTIVE_PANE_QUERY_KEY);
    if (activeParam === "2" && p2) {
      setActivePaneId("right");
      localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "right");
    }

    // Mark initialization complete after state updates have been flushed
    // Using flushSync would be too aggressive, so we let React batch the updates
    // and mark complete in the next microtask after this effect runs
    Promise.resolve().then(() => {
      isInitializing.current = false;
    });
  }, [connections.length, params.connectionId, params["*"]]);

  // Handle browser back/forward navigation (both panes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: getConnectionByName intentionally excluded - we use closure value to avoid re-running when function reference changes
  useEffect(() => {
    if (isInitializing.current || connections.length === 0) return;

    isUpdatingFromUrl.current = true;

    // ── Left pane: sync from path params ──
    if (params.connectionId) {
      const connection = getConnectionByName(params.connectionId);
      if (connection && connection.id !== leftPane.connectionIdRef.current) {
        leftPane.setConnectionId(connection.id);
      }
    }

    const urlPath = params["*"] || "";
    const decodedPath = decodeURIComponent(urlPath);
    if (leftPane.currentPathRef.current !== decodedPath) {
      logger.debug("[URL Navigation] Setting left pane path", { path: decodedPath }, "browser");
      leftPane.setCurrentPath(decodedPath);
    }

    // ── Right pane: sync from ?p2= ──
    const p2 = searchParams.get(RIGHT_PANE_QUERY_KEY);
    if (p2) {
      const slashIdx = p2.indexOf("/");
      const rightSlug = slashIdx >= 0 ? p2.slice(0, slashIdx) : p2;
      const rightPath = slashIdx >= 0 ? decodeURIComponent(p2.slice(slashIdx + 1)) : "";
      const rightConn = getConnectionByName(rightSlug);
      if (rightConn) {
        if (paneMode !== "dual") {
          setPaneMode("dual");
          localStorage.setItem(DUAL_PANE_STORAGE_KEY, "dual");
        }
        if (rightConn.id !== rightPane.connectionIdRef.current) {
          rightPane.setConnectionId(rightConn.id);
        }
        if (rightPane.currentPathRef.current !== rightPath) {
          rightPane.setCurrentPath(rightPath);
        }
      }
    } else if (paneMode === "dual") {
      // URL has no p2 — revert to single mode (e.g. user pressed back after closing dual mode)
      setPaneMode("single");
      setActivePaneId("left");
      rightPane.setConnectionId("");
      rightPane.setCurrentPath("");
      rightPane.setViewInfo(null);
      localStorage.setItem(DUAL_PANE_STORAGE_KEY, "single");
      localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "left");
    }

    // ── Active pane: sync from ?active= ──
    const activeParam = searchParams.get(ACTIVE_PANE_QUERY_KEY);
    const urlActivePaneId: PaneId = activeParam === "2" ? "right" : "left";
    if (activePaneId !== urlActivePaneId) {
      setActivePaneId(urlActivePaneId);
      localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, urlActivePaneId);
    }

    // Reset flag after state updates have been flushed
    Promise.resolve().then(() => {
      isUpdatingFromUrl.current = false;
    });
  }, [connections.length, params.connectionId, params["*"], searchParams]);

  // Sync URL with state changes from both panes
  // biome-ignore lint/correctness/useExhaustiveDependencies: rightPane dependencies are covered by the refs inside updateUrl
  useEffect(() => {
    if (leftPane.connectionId) {
      updateUrl();
    }
  }, [leftPane.currentPath, leftPane.connectionId, rightPane.currentPath, rightPane.connectionId, paneMode, activePaneId, updateUrl]);

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket Real-Time Updates
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * WebSocket connection for real-time directory change notifications.
   * Features:
   * - Automatic reconnection with 5-second delay on disconnect
   * - Cache invalidation when remote changes detected
   * - Selective directory subscription based on current path
   *
   * The socket is tracked in a local variable (`activeWs`) rather than only
   * in `wsRef`, because `wsRef.current` is set inside the async `onopen`
   * callback. If cleanup runs before `onopen` fires (React StrictMode
   * double-mount or Vite HMR), `wsRef.current` would still be `null` and
   * the socket would leak. `disposed` prevents reconnection after unmount.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: WebSocket created once on mount. handleDirectoryChanged refs are stable.
  useEffect(() => {
    let disposed = false;
    let activeWs: WebSocket | null = null;

    const connectWebSocket = () => {
      if (disposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // In development, use port 8000; in production, use same port as current page
      const isDev = window.location.port === "3000" || window.location.hostname === "localhost";
      const port = isDev ? "8000" : window.location.port;
      const wsUrl = port ? `${protocol}//${window.location.hostname}:${port}/api/ws` : `${protocol}//${window.location.hostname}/api/ws`;

      logger.info("Connecting to WebSocket", { wsUrl }, "websocket");
      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        logger.info("WebSocket connected", { wsUrl }, "websocket");
        wsRef.current = ws;

        // Subscribe to left pane's current directory
        const leftConnId = leftPane.connectionIdRef.current;
        const leftPath = leftPane.currentPathRef.current;
        if (leftConnId && leftPath !== undefined) {
          logger.debug("Subscribing to left pane directory", { connectionId: leftConnId, path: leftPath }, "websocket");
          ws.send(JSON.stringify({ action: "subscribe", connection_id: leftConnId, path: leftPath }));
        }

        // Subscribe to right pane's current directory (if in dual mode)
        const rightConnId = rightPane.connectionIdRef.current;
        const rightPath = rightPane.currentPathRef.current;
        if (rightConnId && rightPath !== undefined) {
          logger.debug("Subscribing to right pane directory", { connectionId: rightConnId, path: rightPath }, "websocket");
          ws.send(JSON.stringify({ action: "subscribe", connection_id: rightConnId, path: rightPath }));
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "directory_changed") {
          // Dispatch to both panes — each pane checks if it's viewing the affected directory
          leftPane.handleDirectoryChanged(data.connection_id, data.path);
          rightPane.handleDirectoryChanged(data.connection_id, data.path);
        }
      };

      ws.onerror = (error) => {
        logger.error("WebSocket error", { wsUrl, error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        logger.warn("WebSocket disconnected", { wsUrl, willReconnect: !disposed }, "websocket");
        if (activeWs === ws) {
          activeWs = null;
        }
        wsRef.current = null;

        if (!disposed) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };
    };

    connectWebSocket();

    return () => {
      disposed = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Close the locally-tracked socket — works even if onopen hasn't fired yet
      if (activeWs) {
        activeWs.close();
        activeWs = null;
      }
      wsRef.current = null;
    };
  }, []);

  // Subscribe/unsubscribe when either pane's directory changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: paneMode is needed to re-subscribe when toggling dual mode
  useEffect(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    // Subscribe to left pane's directory
    if (leftPane.connectionId) {
      wsRef.current.send(
        JSON.stringify({
          action: "subscribe",
          connection_id: leftPane.connectionId,
          path: leftPane.currentPath,
        })
      );
    }

    // Subscribe to right pane's directory when in dual mode
    if (isDualMode && rightPane.connectionId) {
      wsRef.current.send(
        JSON.stringify({
          action: "subscribe",
          connection_id: rightPane.connectionId,
          path: rightPane.currentPath,
        })
      );
    }
  }, [leftPane.currentPath, leftPane.connectionId, rightPane.currentPath, rightPane.connectionId, isDualMode, paneMode]);

  // ──────────────────────────────────────────────────────────────────────────
  // Dual-Pane Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /** Toggle between single and dual-pane mode. */
  const handleToggleDualPane = useCallback(() => {
    if (paneMode === "single") {
      // Activate dual mode — initialize right pane with left pane's location
      setPaneMode("dual");
      setActivePaneId("right");
      rightPane.setConnectionId(leftPane.connectionIdRef.current);
      rightPane.setCurrentPath(leftPane.currentPathRef.current);
      localStorage.setItem(DUAL_PANE_STORAGE_KEY, "dual");
      localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "right");
    } else {
      // Return to single mode — clear right pane to avoid background work
      setPaneMode("single");
      setActivePaneId("left");
      rightPane.setConnectionId("");
      rightPane.setCurrentPath("");
      rightPane.setViewInfo(null);
      localStorage.setItem(DUAL_PANE_STORAGE_KEY, "single");
      localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "left");
      // Focus left pane's list container
      setTimeout(() => leftPane.listContainerEl?.focus(), 0);
    }
  }, [paneMode, leftPane, rightPane]);

  /** Switch focus to the other pane (Tab in dual mode). */
  const handleSwitchPane = useCallback(() => {
    if (!isDualMode) return;
    const currentId = effectiveActivePaneIdRef.current;
    const nextId: PaneId = currentId === "left" ? "right" : "left";
    setActivePaneId(nextId);
    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, nextId);
    const nextPane = nextId === "left" ? leftPane : rightPane;
    setTimeout(() => nextPane.listContainerEl?.focus(), 0);
  }, [isDualMode, leftPane, rightPane]);

  /** Focus the left pane (Ctrl+1). Opens dual mode from single if Ctrl+2 is used. */
  const handleFocusLeftPane = useCallback(() => {
    setActivePaneId("left");
    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "left");
    setTimeout(() => leftPane.listContainerEl?.focus(), 0);
  }, [leftPane]);

  /** Focus the right pane (Ctrl+2). Opens dual mode if currently in single. */
  const handleFocusRightPane = useCallback(() => {
    if (paneMode === "single") {
      // Open dual mode and focus right pane
      setPaneMode("dual");
      rightPane.setConnectionId(leftPane.connectionIdRef.current);
      rightPane.setCurrentPath(leftPane.currentPathRef.current);
      localStorage.setItem(DUAL_PANE_STORAGE_KEY, "dual");
    }
    setActivePaneId("right");
    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "right");
    setTimeout(() => rightPane.listContainerEl?.focus(), 0);
  }, [paneMode, leftPane, rightPane]);

  // ──────────────────────────────────────────────────────────────────────────
  // Keyboard Shortcuts
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Keyboard shortcuts configuration
   *
   * Defines all browser shortcuts with handlers and enabled conditions.
   * Routes navigation/action shortcuts to the active pane.
   * Includes dual-pane shortcuts (Ctrl+B, Tab, Ctrl+1, Ctrl+2).
   */
  const browserShortcuts = useMemo(
    () => [
      // Navigation - Arrow keys (focus checked inside handlers)
      {
        ...BROWSER_SHORTCUTS.ARROW_DOWN,
        handler: activePane.handleNavigateDown,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      {
        ...BROWSER_SHORTCUTS.ARROW_UP,
        handler: activePane.handleArrowUp,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      // Navigation - Home/End (focus checked inside handlers)
      {
        ...COMMON_SHORTCUTS.FIRST_PAGE,
        description: "First file",
        handler: activePane.handleHome,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      {
        ...COMMON_SHORTCUTS.LAST_PAGE,
        description: "Last file",
        handler: activePane.handleEnd,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      // Navigation - Page Up/Down (focus checked inside handlers)
      {
        ...COMMON_SHORTCUTS.PAGE_DOWN,
        handler: activePane.handlePageDown,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      {
        ...COMMON_SHORTCUTS.PAGE_UP,
        handler: activePane.handlePageUp,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.filesRef.current.length > 0,
      },
      // Open file/folder (focus checked inside handler)
      {
        ...COMMON_SHORTCUTS.OPEN,
        handler: activePane.handleOpenFile,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          activePane.focusedIndex >= 0 &&
          activePane.filesRef.current[activePane.focusedIndex] !== undefined,
      },
      // Navigate up directory
      {
        ...BROWSER_SHORTCUTS.NAVIGATE_UP,
        handler: activePane.handleNavigateUpDirectory,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo && activePane.currentPathRef.current !== "",
      },
      // Clear selection and search (close action in browser context)
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: activePane.handleClose,
        enabled: true,
      },
      // Refresh
      {
        ...BROWSER_SHORTCUTS.REFRESH,
        handler: activePane.handleRefresh,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo,
      },
      // Quick navigate (Ctrl+K) — also focuses the search bar
      {
        ...BROWSER_SHORTCUTS.QUICK_NAVIGATE,
        handler: activePane.handleFocusSearch,
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo,
      },
      // Show help
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP,
        handler: () => setShowHelp(true),
        enabled: !settingsOpen && !mobileSettingsOpen && !activePane.viewInfo,
      },
      // Delete file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.DELETE_ITEM,
        handler: activePane.handleDeleteRequest,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          !activePane.deleteDialogOpen &&
          !activePane.renameDialogOpen &&
          !activePane.createDialogOpen &&
          activePane.focusedIndex >= 0 &&
          activePane.filesRef.current[activePane.focusedIndex] !== undefined,
      },
      // Rename file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.RENAME_ITEM,
        handler: activePane.handleRenameRequest,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          !activePane.deleteDialogOpen &&
          !activePane.renameDialogOpen &&
          !activePane.createDialogOpen &&
          activePane.focusedIndex >= 0 &&
          activePane.filesRef.current[activePane.focusedIndex] !== undefined,
      },
      // Open in companion app (Ctrl+Enter)
      {
        ...BROWSER_SHORTCUTS.OPEN_IN_APP,
        handler: activePane.handleOpenInApp,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          activePane.focusedIndex >= 0 &&
          activePane.filesRef.current[activePane.focusedIndex]?.type === "file",
      },
      // Create new directory (F7)
      {
        ...BROWSER_SHORTCUTS.NEW_DIRECTORY,
        handler: activePane.handleNewDirectoryRequest,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          !activePane.deleteDialogOpen &&
          !activePane.renameDialogOpen &&
          !activePane.createDialogOpen,
      },
      // Create new file (Shift+F7)
      {
        ...BROWSER_SHORTCUTS.NEW_FILE,
        handler: activePane.handleNewFileRequest,
        enabled:
          !settingsOpen &&
          !mobileSettingsOpen &&
          !activePane.viewInfo &&
          !activePane.deleteDialogOpen &&
          !activePane.renameDialogOpen &&
          !activePane.createDialogOpen,
      },

      // ── Dual-Pane Shortcuts ──────────────────────────────────────────────
      {
        ...PANE_SHORTCUTS.TOGGLE_DUAL_PANE,
        handler: handleToggleDualPane,
        enabled: !settingsOpen && !mobileSettingsOpen && !useCompactLayout,
      },
      {
        ...PANE_SHORTCUTS.FOCUS_LEFT_PANE,
        handler: handleFocusLeftPane,
        enabled: !settingsOpen && !mobileSettingsOpen,
      },
      {
        ...PANE_SHORTCUTS.FOCUS_RIGHT_PANE,
        handler: handleFocusRightPane,
        enabled: !settingsOpen && !mobileSettingsOpen,
      },
      {
        ...PANE_SHORTCUTS.SWITCH_PANE,
        handler: handleSwitchPane,
        enabled: !settingsOpen && !mobileSettingsOpen && isDualMode,
        allowInInput: true,
      },
    ],
    [
      activePane,
      settingsOpen,
      mobileSettingsOpen,
      useCompactLayout,
      isDualMode,
      handleToggleDualPane,
      handleSwitchPane,
      handleFocusLeftPane,
      handleFocusRightPane,
    ]
  );

  useKeyboardShortcuts({
    shortcuts: browserShortcuts,
  });

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

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    // Return focus to active pane's file list after closing settings
    setTimeout(() => {
      activePane.listContainerEl?.focus();
    }, 0);
  };

  /**
   * handleConnectionsChanged
   *
   * Called when connections are added, updated, or deleted in settings.
   * Re-fetches connections and applies selection logic:
   * - If current connection still exists: keep it selected
   * - If current connection was removed: select first alphabetically
   * - If no connections remain: show welcome screen
   */
  const handleConnectionsChanged = useCallback(async () => {
    try {
      const data = await api.getConnections();
      setConnections(data);

      // Invalidate caches in both panes since connection properties may have changed
      const leftConnId = leftPane.connectionId;
      if (leftConnId && data.find((c: Connection) => c.id === leftConnId)) {
        leftPane.invalidateConnectionCache(leftConnId);
        leftPane.loadFiles(leftPane.currentPathRef.current, true);
      }
      const rightConnId = rightPane.connectionId;
      if (rightConnId && data.find((c: Connection) => c.id === rightConnId)) {
        rightPane.invalidateConnectionCache(rightConnId);
        rightPane.loadFiles(rightPane.currentPathRef.current, true);
      }

      // Check if left pane's connection still exists
      if (leftConnId && data.find((c: Connection) => c.id === leftConnId)) {
        // Left pane's connection is fine — check right pane too
        if (rightConnId && !data.find((c: Connection) => c.id === rightConnId)) {
          // Right pane's connection was removed — revert to single mode
          setPaneMode("single");
          setActivePaneId("left");
          rightPane.setConnectionId("");
          rightPane.setCurrentPath("");
          rightPane.setViewInfo(null);
          localStorage.setItem(DUAL_PANE_STORAGE_KEY, "single");
          localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "left");
        }
        return;
      }

      // Left pane's connection removed or no selection - select first alphabetically
      if (data.length > 0) {
        const sortedByName = [...data].sort((a, b) => a.name.localeCompare(b.name));
        const firstConnection = sortedByName[0];
        if (firstConnection) {
          leftPane.handleConnectionChange(firstConnection.id);
          const identifier = slugifyConnectionName(firstConnection.name);
          navigate(`/browse/${identifier}`, { replace: true });
        }
      } else {
        // No connections remaining - show welcome screen
        leftPane.setConnectionId("");
        leftPane.setCurrentPath("");
        leftPane.setViewInfo(null);
        rightPane.setConnectionId("");
        rightPane.setCurrentPath("");
        rightPane.setViewInfo(null);
        localStorage.removeItem("selectedConnectionId");
        navigate("/browse", { replace: true });
      }
    } catch (err) {
      logger.error("Error refreshing connections", { error: err }, "browser");
    }
  }, [leftPane, rightPane, slugifyConnectionName, navigate]);

  // ── Computed values for the active pane (used in toolbar / mobile) ────────
  const activeCurrentPath = activePane.currentPath;
  const pathParts = activeCurrentPath ? activeCurrentPath.split("/") : [];
  const currentDirectoryName = (pathParts.length > 0 && pathParts[pathParts.length - 1]) || "Root";
  const canNavigateUp = activeCurrentPath !== "";

  // Force single-pane on mobile
  const effectivePaneMode: PaneMode = useCompactLayout ? "single" : paneMode;

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
        selectedConnectionId={activePane.connectionId}
        onConnectionChange={activePane.handleConnectionChange}
        onNavigateToRoot={() => {
          activePane.setCurrentPath("");
          activePane.setViewInfo(null);
        }}
        onOpenSettings={() => setMobileSettingsOpen(true)}
        onLogout={handleLogout}
      />

      <AppBar position="static" elevation={useCompactLayout ? undefined : 0}>
        <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
          {useCompactLayout ? (
            <MobileToolbar
              currentDirectoryName={currentDirectoryName}
              onOpenMenu={() => setDrawerOpen(true)}
              onNavigateUp={activePane.handleNavigateUp}
              canNavigateUp={canNavigateUp}
            />
          ) : (
            <DesktopToolbar
              searchProvider={activePane.directorySearchProvider}
              searchInputRef={activePane.searchInputRef}
              showSearch={activePane.connectionId !== ""}
              onOpenSettings={() => {
                setSettingsInitialCategory("appearance");
                setSettingsOpen(true);
              }}
              onBlurToFileList={() => activePane.listContainerEl?.focus()}
              disableTabFocus={isDualMode}
            />
          )}
        </Toolbar>
      </AppBar>

      {/* Secondary action strip — view mode & sort controls for the active pane (desktop only) */}
      {!useCompactLayout && (
        <SecondaryActionStrip
          connections={connections}
          selectedConnectionId={activePane.connectionId}
          onConnectionChange={activePane.handleConnectionChange}
          viewMode={activePane.viewMode}
          onViewModeChange={activePane.setViewMode}
          sortBy={activePane.sortBy}
          onSortChange={activePane.setSortBy}
          sortDirection={activePane.sortDirection}
          onDirectionChange={() => activePane.setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
          hasFiles={activePane.files.length > 0}
          onBlurToFileList={() => activePane.listContainerEl?.focus()}
          disableTabFocus={isDualMode}
        />
      )}

      <Container
        maxWidth={false}
        disableGutters
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          pt: 2,
          pb: { xs: "env(safe-area-inset-bottom)", sm: 0 },
          overflow: "hidden",
        }}
      >
        <FileBrowserAlerts
          error={leftPane.error}
          loadingConnections={loadingConnections}
          connectionsCount={connections.length}
          isAdmin={isAdmin}
          onOpenConnectionsSettings={() => {
            if (useCompactLayout) {
              setMobileSettingsInitialView("connections");
              setMobileSettingsOpen(true);
            } else {
              setSettingsInitialCategory("connections");
              setSettingsOpen(true);
            }
          }}
        />

        {/* Pane content area — single or dual-pane layout */}
        {leftPane.connectionId && (
          <Box
            sx={{
              display: "flex",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Left Pane — always visible */}
            <FileBrowserPane
              pane={leftPane}
              paneId="left"
              isActive={effectiveActivePaneId === "left"}
              paneMode={effectivePaneMode}
              connections={connections}
              useCompactLayout={useCompactLayout}
              isUsingKeyboard={isUsingKeyboard}
              onPaneFocus={() => {
                setActivePaneId("left");
                localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "left");
              }}
              disableTabFocus={isDualMode}
            />

            {/* Divider + Right Pane — dual mode only */}
            {isDualMode && rightPane.connectionId && (
              <>
                <Divider orientation="vertical" flexItem />
                <FileBrowserPane
                  pane={rightPane}
                  paneId="right"
                  isActive={effectiveActivePaneId === "right"}
                  paneMode={effectivePaneMode}
                  connections={connections}
                  useCompactLayout={useCompactLayout}
                  isUsingKeyboard={isUsingKeyboard}
                  onPaneFocus={() => {
                    setActivePaneId("right");
                    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, "right");
                  }}
                  disableTabFocus={isDualMode}
                />
              </>
            )}
          </Box>
        )}
      </Container>

      {/* Settings Dialog (Desktop only) */}
      {!useCompactLayout && (
        <SettingsDialog
          open={settingsOpen}
          onClose={handleSettingsClose}
          initialCategory={settingsInitialCategory}
          onConnectionsChanged={handleConnectionsChanged}
        />
      )}

      {/* Settings Drawer (Mobile only) */}
      {useCompactLayout && (
        <MobileSettingsDrawer
          open={mobileSettingsOpen}
          onClose={() => {
            setMobileSettingsOpen(false);
            setMobileSettingsInitialView("main");
          }}
          onConnectionsChanged={handleConnectionsChanged}
          initialView={mobileSettingsInitialView}
        />
      )}

      {/* Viewer overlay — full-screen, from whichever pane opened it */}
      {leftPane.viewInfo && (
        <DynamicViewer
          connectionId={leftPane.connectionId}
          viewInfo={leftPane.viewInfo}
          onClose={leftPane.handleViewClose}
          onIndexChange={leftPane.handleViewIndexChange}
        />
      )}
      {rightPane.viewInfo && !leftPane.viewInfo && (
        <DynamicViewer
          connectionId={rightPane.connectionId}
          viewInfo={rightPane.viewInfo}
          onClose={rightPane.handleViewClose}
          onIndexChange={rightPane.handleViewIndexChange}
        />
      )}

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={browserShortcuts}
        title="File browser shortcuts"
      />

      {/* Companion app guidance hint */}
      <Snackbar
        open={companionHintOpen}
        autoHideDuration={6000}
        onClose={() => setCompanionHintOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message="Opening in Sambee Companion… If nothing happened, make sure the companion app is installed."
      />
    </Box>
  );
};

export default Browser;
