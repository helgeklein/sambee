/**
 * FileBrowser Component — Page-Level Orchestrator
 * =================================================
 *
 * Coordinates one or two file-browser panes with page-level concerns:
 * - Connection management and loading
 * - URL synchronisation (browser history, back/forward — both panes)
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
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import CopyMoveDialog, { type CopyMoveMode, type OverwriteStrategy } from "../components/FileBrowser/CopyMoveDialog";
import { DesktopToolbar } from "../components/FileBrowser/DesktopToolbar";
import { DynamicViewer } from "../components/FileBrowser/DynamicViewer";
import { FileBrowserAlerts } from "../components/FileBrowser/FileBrowserAlerts";
import { MobileToolbar } from "../components/FileBrowser/MobileToolbar";
import OverwriteConflictDialog, { type ConflictResolution } from "../components/FileBrowser/OverwriteConflictDialog";
import { SecondaryActionStrip } from "../components/FileBrowser/SecondaryActionStrip";
import { useBrowserCommandsProvider, useSmartBrowserSearchProvider } from "../components/FileBrowser/search";
import { KeyboardShortcutsHelp } from "../components/KeyboardShortcutsHelp";
import HamburgerMenu from "../components/Mobile/HamburgerMenu";
import { MobileSettingsDrawer } from "../components/Mobile/MobileSettingsDrawer";
import SettingsDialog from "../components/Settings/SettingsDialog";
import { DEFAULT_SETTINGS_CATEGORY, type MobileSettingsView, type SettingsCategory } from "../components/Settings/settingsNavigation";
import { getEnabledBrowserCommands } from "../config/browserCommands";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, COPY_MOVE_SHORTCUTS, PANE_SHORTCUTS, SELECTION_SHORTCUTS } from "../config/keyboardShortcuts";
import { useCompanion } from "../hooks/useCompanion";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import api from "../services/api";
import { markBackendAvailable, markBackendReconnecting, useBackendAvailability } from "../services/backendAvailability";
import { isLocalDrive, mergeConnections } from "../services/backendRouter";
import companionService, { buildCompanionWsUrl, type DriveInfo, hasStoredSecret } from "../services/companion";
import { logger } from "../services/logger";
import { scheduleRuntimeWarmup } from "../services/runtimeWarmup";
import { buildServerWebSocketUrl } from "../services/serverWebsocket";
import { loadCurrentUserSettings } from "../services/userSettingsSync";
import type { ConflictInfo, Connection } from "../types";
import { isApiError } from "../types";
import { compareLocalizedStrings } from "../utils/localeFormatting";
import { isAdminUser } from "../utils/userAccess";
import { FileBrowserPane } from "./FileBrowser/FileBrowserPane";
import {
  readFileBrowserPaneModePreference,
  readSelectedConnectionIdPreference,
  setFileBrowserPaneModePreference,
  setSelectedConnectionIdPreference,
} from "./FileBrowser/preferences";
import {
  type BrowseRouteState,
  buildBrowseRouteTarget,
  parseBrowseRoute,
  resolveBrowseRouteState,
  serializeBrowseRoute,
} from "./FileBrowser/routing";
import type { PaneId, PaneMode } from "./FileBrowser/types";
import { ACTIVE_PANE_QUERY_KEY, ACTIVE_PANE_STORAGE_KEY, RIGHT_PANE_QUERY_KEY } from "./FileBrowser/types";
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
  const params = useParams<{ targetType: string; targetId: string; "*": string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const theme = useTheme();
  const { t } = useTranslation();

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
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory>(DEFAULT_SETTINGS_CATEGORY);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileSettingsInitialView, setMobileSettingsInitialView] = useState<MobileSettingsView>("main");
  const [showHelp, setShowHelp] = useState(false);
  const [quickBarMode, setQuickBarMode] = useState<"smart" | "commands" | "filter">("smart");
  const [quickBarActivationToken, setQuickBarActivationToken] = useState(0);
  const [quickBarPaneId, setQuickBarPaneId] = useState<PaneId>("left");
  const [companionHintOpen, setCompanionHintOpen] = useState(false);
  const backendAvailability = useBackendAvailability();

  // ── Companion detection & drive management ──────────────────────────────
  const companion = useCompanion();

  /** Server connections merged with companion-provided local drives. */
  const allConnections = useMemo(() => mergeConnections(connections, companion.drives), [connections, companion.drives]);

  // ──────────────────────────────────────────────────────────────────────────
  // Copy / Move Dialog State
  // ──────────────────────────────────────────────────────────────────────────

  const [copyMoveDialogOpen, setCopyMoveDialogOpen] = useState(false);
  const [copyMoveMode, setCopyMoveMode] = useState<CopyMoveMode>("copy");
  const [copyMoveFiles, setCopyMoveFiles] = useState<import("../types").FileEntry[]>([]);
  const [copyMoveSourcePaneId, setCopyMoveSourcePaneId] = useState<PaneId>("left");
  const [copyMoveSourceConnectionId, setCopyMoveSourceConnectionId] = useState("");
  const [copyMoveSourcePath, setCopyMoveSourcePath] = useState("");
  const [copyMoveDestConnectionId, setCopyMoveDestConnectionId] = useState("");
  const [copyMoveDestConnectionName, setCopyMoveDestConnectionName] = useState("");
  const [copyMoveDestPath, setCopyMoveDestPath] = useState("");
  const [copyMoveProcessing, setCopyMoveProcessing] = useState(false);
  const [copyMoveProgress, setCopyMoveProgress] = useState<{ current: number; total: number } | undefined>();
  const [copyMoveTransferProgress, setCopyMoveTransferProgress] = useState<{
    bytesTransferred: number;
    totalBytes: number | null;
    itemName: string;
  } | null>(null);
  const [copyMoveError, setCopyMoveError] = useState<string | null>(null);

  // Overwrite conflict dialog state
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  const [conflictProgress, setConflictProgress] = useState<{ current: number; total: number; conflictsSoFar: number } | undefined>();
  /** Ref holding the resolve function of a Promise used to pause the processing loop while the conflict dialog is open. */
  const conflictResolveRef = React.useRef<((value: { resolution: ConflictResolution; applyToAll: boolean }) => void) | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Dual-Pane State
  // ──────────────────────────────────────────────────────────────────────────

  /** Layout mode: single pane (default) or side-by-side dual pane. */
  const [paneMode, setPaneMode] = useState<PaneMode>(() => {
    // If the URL contains a p2 query parameter, activate dual mode automatically
    const urlP2 = new URLSearchParams(window.location.search).get(RIGHT_PANE_QUERY_KEY);
    if (urlP2) return "dual";
    return readFileBrowserPaneModePreference();
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

  const currentRoute = useMemo(
    () =>
      parseBrowseRoute({
        targetType: params.targetType,
        targetId: params.targetId,
        path: params["*"],
        searchParams,
      }),
    [params.targetId, params.targetType, params["*"], searchParams]
  );
  const resolvedRoute = useMemo(() => resolveBrowseRouteState(currentRoute, allConnections), [allConnections, currentRoute]);

  const leftPathNavigateRef = React.useRef<(path: string) => void>(() => undefined);
  const rightPathNavigateRef = React.useRef<(path: string) => void>(() => undefined);
  const leftConnectionNavigateRef = React.useRef<(connectionId: string) => void>(() => undefined);
  const rightConnectionNavigateRef = React.useRef<(connectionId: string) => void>(() => undefined);

  // WebSocket for real-time directory updates (server)
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);

  // WebSocket for real-time directory updates (companion / local drives)
  const companionWsRef = React.useRef<WebSocket | null>(null);
  const companionReconnectRef = React.useRef<number | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Pane Hooks — all per-pane state and logic
  // ──────────────────────────────────────────────────────────────────────────

  // Left pane — always present, synced with URL
  const leftPane = useFileBrowserPane({
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen,
    isActive: activePaneId === "left",
    onCompanionHint: () => setCompanionHintOpen(true),
    onNavigatePath: (path) => leftPathNavigateRef.current(path),
    onNavigateConnection: (connectionId) => leftConnectionNavigateRef.current(connectionId),
  });

  // Right pane — always instantiated (React hooks rule: no conditional hooks),
  // but only renders in dual mode. Disabled when not in dual mode.
  const rightPane = useFileBrowserPane({
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen || paneMode === "single",
    isActive: activePaneId === "right" && paneMode === "dual",
    onCompanionHint: () => setCompanionHintOpen(true),
    onNavigatePath: (path) => rightPathNavigateRef.current(path),
    onNavigateConnection: (connectionId) => rightConnectionNavigateRef.current(connectionId),
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
  const quickBarPane = quickBarPaneId === "right" && isDualMode ? rightPane : leftPane;

  useEffect(() => {
    if ((!isDualMode || !rightPane.connectionId) && quickBarPaneId === "right") {
      setQuickBarPaneId("left");
    }
  }, [isDualMode, quickBarPaneId, rightPane.connectionId]);

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
      setIsAdmin(isAdminUser(user));
    } catch (err) {
      logger.warn("Failed to verify admin status", { error: err }, "browser");
      setIsAdmin(false);
    }
  }, []);

  const navigateToBrowseState = useCallback(
    (nextRoute: BrowseRouteState, options?: { replace?: boolean }) => {
      const nextUrl = serializeBrowseRoute(nextRoute);
      const currentUrl = location.pathname + location.search;
      if (currentUrl === nextUrl) {
        return;
      }

      navigate(nextUrl, { replace: options?.replace ?? false });
    },
    [location.pathname, location.search, navigate]
  );

  const getCurrentLeftTarget = useCallback(() => {
    return buildBrowseRouteTarget(leftPane.connectionIdRef.current, leftPane.currentPathRef.current, allConnections);
  }, [allConnections, leftPane]);

  const getCurrentRightTarget = useCallback(() => {
    if (paneMode !== "dual") {
      return null;
    }

    return buildBrowseRouteTarget(rightPane.connectionIdRef.current, rightPane.currentPathRef.current, allConnections);
  }, [allConnections, paneMode, rightPane]);

  const navigateLeftPane = useCallback(
    (connectionId: string, path: string, options?: { replace?: boolean; activePaneId?: PaneId }) => {
      const leftTarget = buildBrowseRouteTarget(connectionId, path, allConnections);
      if (!leftTarget) {
        navigate("/browse", { replace: options?.replace ?? false });
        return;
      }

      const rightTarget = getCurrentRightTarget();
      navigateToBrowseState(
        {
          left: leftTarget,
          right: rightTarget,
          activePaneId: rightTarget ? (options?.activePaneId ?? activePaneId) : "left",
        },
        options
      );
    },
    [activePaneId, allConnections, getCurrentRightTarget, navigate, navigateToBrowseState]
  );

  const navigateRightPane = useCallback(
    (connectionId: string, path: string, options?: { replace?: boolean; activePaneId?: PaneId }) => {
      const leftTarget = getCurrentLeftTarget();
      const rightTarget = buildBrowseRouteTarget(connectionId, path, allConnections);
      if (!leftTarget || !rightTarget) {
        return;
      }

      navigateToBrowseState(
        {
          left: leftTarget,
          right: rightTarget,
          activePaneId: options?.activePaneId ?? activePaneId,
        },
        options
      );
    },
    [activePaneId, allConnections, getCurrentLeftTarget, navigateToBrowseState]
  );

  const replaceActivePaneInRoute = useCallback(
    (nextActivePaneId: PaneId) => {
      const leftTarget = getCurrentLeftTarget();
      const rightTarget = getCurrentRightTarget();
      if (!leftTarget || !rightTarget) {
        return;
      }

      navigateToBrowseState(
        {
          left: leftTarget,
          right: rightTarget,
          activePaneId: nextActivePaneId,
        },
        { replace: true }
      );
    },
    [getCurrentLeftTarget, getCurrentRightTarget, navigateToBrowseState]
  );

  leftPathNavigateRef.current = (path) => {
    const connectionId = leftPane.connectionIdRef.current;
    if (!connectionId) {
      return;
    }

    navigateLeftPane(connectionId, path, { activePaneId: "left" });
  };

  rightPathNavigateRef.current = (path) => {
    const connectionId = rightPane.connectionIdRef.current;
    if (!connectionId) {
      return;
    }

    navigateRightPane(connectionId, path, { activePaneId: "right" });
  };

  leftConnectionNavigateRef.current = (connectionId) => {
    navigateLeftPane(connectionId, "", { activePaneId: paneMode === "dual" ? activePaneId : "left" });
  };

  rightConnectionNavigateRef.current = (connectionId) => {
    navigateRightPane(connectionId, "", { activePaneId: "right" });
  };

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

      const currentUserSettings = await loadCurrentUserSettings(true);
      const persistedSelectedConnectionId = currentUserSettings?.browser.selected_connection_id ?? null;
      if (persistedSelectedConnectionId !== null) {
        setSelectedConnectionIdPreference(persistedSelectedConnectionId, false);
      }

      const data = await api.getConnections();
      setConnections(data);

      if ((params.targetType || params.targetId) && !currentRoute.left) {
        navigate("/browse", { replace: true });
        return;
      }

      if (currentRoute.left?.kind === "smb" && !data.some((connection) => connection.slug === currentRoute.left?.targetId)) {
        navigate("/browse", { replace: true });
        return;
      }

      if (currentRoute.right?.kind === "smb" && !data.some((connection) => connection.slug === currentRoute.right?.targetId)) {
        navigateToBrowseState(
          {
            left: currentRoute.left,
            right: null,
            activePaneId: "left",
          },
          { replace: true }
        );
        return;
      }

      if (currentRoute.left) {
        return;
      }

      const savedConnectionId = persistedSelectedConnectionId ?? readSelectedConnectionIdPreference();
      const autoSelectedConnectionId =
        savedConnectionId && (isLocalDrive(savedConnectionId) || data.some((connection) => connection.id === savedConnectionId))
          ? savedConnectionId
          : data[0]?.id;

      if (autoSelectedConnectionId) {
        navigateToBrowseState(
          {
            left: buildBrowseRouteTarget(autoSelectedConnectionId, "", mergeConnections(data, companion.drives)),
            right: null,
            activePaneId: "left",
          },
          { replace: true }
        );
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
  }, [companion.drives, currentRoute.left, currentRoute.right, navigate, navigateToBrowseState, params.targetId, params.targetType]);

  // ──────────────────────────────────────────────────────────────────────────
  // Component Lifecycle Effects
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    scheduleRuntimeWarmup();
  }, []);

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

  useEffect(() => {
    if (loadingConnections) {
      return;
    }

    leftPane.applyLocation(resolvedRoute.left?.connectionId ?? "", resolvedRoute.left?.path ?? "");
    rightPane.applyLocation(resolvedRoute.right?.connectionId ?? "", resolvedRoute.right?.path ?? "");

    const nextPaneMode: PaneMode = resolvedRoute.right ? "dual" : "single";
    const nextActivePaneId: PaneId = resolvedRoute.right ? resolvedRoute.activePaneId : "left";

    if (paneMode !== nextPaneMode) {
      setPaneMode(nextPaneMode);
    }

    if (activePaneId !== nextActivePaneId) {
      setActivePaneId(nextActivePaneId);
    }

    setFileBrowserPaneModePreference(nextPaneMode, true);
    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, nextActivePaneId);
  }, [activePaneId, leftPane.applyLocation, loadingConnections, paneMode, resolvedRoute, rightPane.applyLocation]);

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

      const accessToken = localStorage.getItem("access_token");
      const wsUrl = buildServerWebSocketUrl(window.location, accessToken);

      logger.info("Connecting to WebSocket", { wsUrl }, "websocket");
      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        markBackendAvailable();
        logger.info("WebSocket connected", { wsUrl }, "websocket");
        wsRef.current = ws;

        // Subscribe to left pane's current directory (server connections only)
        const leftConnId = leftPane.connectionIdRef.current;
        const leftPath = leftPane.currentPathRef.current;
        if (leftConnId && leftPath !== undefined && !isLocalDrive(leftConnId)) {
          logger.debug("Subscribing to left pane directory", { connectionId: leftConnId, path: leftPath }, "websocket");
          ws.send(JSON.stringify({ action: "subscribe", connection_id: leftConnId, path: leftPath }));
        }

        // Subscribe to right pane's current directory (if in dual mode, server connections only)
        const rightConnId = rightPane.connectionIdRef.current;
        const rightPath = rightPane.currentPathRef.current;
        if (rightConnId && rightPath !== undefined && !isLocalDrive(rightConnId)) {
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
        } else if (data.type === "transfer_progress") {
          // Byte-level progress for cross-connection copy/move
          if (data.bytes_transferred === -1) {
            // Sentinel: transfer complete — clear byte progress
            setCopyMoveTransferProgress(null);
          } else {
            setCopyMoveTransferProgress({
              bytesTransferred: data.bytes_transferred,
              totalBytes: data.total_bytes ?? null,
              itemName: data.item_name ?? "",
            });
          }
        }
      };

      ws.onerror = (error) => {
        logger.error("WebSocket error", { wsUrl, error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        if (disposed) {
          if (activeWs === ws) {
            activeWs = null;
          }
          wsRef.current = null;
          return;
        }

        markBackendReconnecting("WebSocket disconnected");
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

  /**
   * Companion WebSocket for real-time local drive change notifications.
   *
   * Only connects when the companion is paired. Uses HMAC query-param auth
   * since the browser WebSocket API does not support custom headers.
   * Reconnects independently from the server WebSocket.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleDirectoryChanged refs are stable; companion.status drives connect/disconnect.
  useEffect(() => {
    if (companion.status !== "paired") return;

    let disposed = false;
    let activeWs: WebSocket | null = null;

    const connectCompanionWs = async () => {
      if (disposed) return;

      const wsUrl = await buildCompanionWsUrl();
      if (!wsUrl || disposed) return;

      logger.info("Connecting to companion WebSocket", { wsUrl }, "websocket");
      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        logger.info("Companion WebSocket connected", {}, "websocket");
        companionWsRef.current = ws;

        // Subscribe to local-drive directories currently being viewed
        const leftConnId = leftPane.connectionIdRef.current;
        const leftPath = leftPane.currentPathRef.current;
        if (leftConnId && leftPath !== undefined && isLocalDrive(leftConnId)) {
          ws.send(JSON.stringify({ action: "subscribe", connection_id: leftConnId, path: leftPath }));
        }

        const rightConnId = rightPane.connectionIdRef.current;
        const rightPath = rightPane.currentPathRef.current;
        if (rightConnId && rightPath !== undefined && isLocalDrive(rightConnId)) {
          ws.send(JSON.stringify({ action: "subscribe", connection_id: rightConnId, path: rightPath }));
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "directory_changed") {
          leftPane.handleDirectoryChanged(data.connection_id, data.path);
          rightPane.handleDirectoryChanged(data.connection_id, data.path);
        }
      };

      ws.onerror = (error) => {
        logger.error("Companion WebSocket error", { error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        if (disposed) {
          if (activeWs === ws) {
            activeWs = null;
          }
          companionWsRef.current = null;
          return;
        }

        logger.warn("Companion WebSocket disconnected", { willReconnect: !disposed }, "websocket");
        if (activeWs === ws) {
          activeWs = null;
        }
        companionWsRef.current = null;

        if (!disposed) {
          companionReconnectRef.current = window.setTimeout(() => {
            connectCompanionWs();
          }, 5000);
        }
      };
    };

    connectCompanionWs();

    return () => {
      disposed = true;
      if (companionReconnectRef.current) {
        clearTimeout(companionReconnectRef.current);
        companionReconnectRef.current = null;
      }
      if (activeWs) {
        activeWs.close();
        activeWs = null;
      }
      companionWsRef.current = null;
    };
  }, [companion.status]);

  // Subscribe/unsubscribe when either pane's directory changes.
  // Returns a cleanup function that unsubscribes from the paths that were
  // subscribed in *this* effect run, so stale directory-monitor handles on
  // the backend are released before the next subscribe fires.
  // biome-ignore lint/correctness/useExhaustiveDependencies: paneMode is needed to re-subscribe when toggling dual mode
  useEffect(() => {
    // Helper: send a message to the correct WebSocket for a given connection.
    const sendToWs = (connectionId: string, msg: object): boolean => {
      if (isLocalDrive(connectionId)) {
        if (companionWsRef.current?.readyState === WebSocket.OPEN) {
          companionWsRef.current.send(JSON.stringify(msg));
          return true;
        }
      } else {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(msg));
          return true;
        }
      }
      return false;
    };

    // Track what we subscribe to so we can unsubscribe on cleanup
    const subscribed: Array<{ connection_id: string; path: string }> = [];

    // Subscribe to left pane's directory
    if (leftPane.connectionId) {
      const msg = { action: "subscribe", connection_id: leftPane.connectionId, path: leftPane.currentPath };
      if (sendToWs(leftPane.connectionId, msg)) {
        subscribed.push({ connection_id: leftPane.connectionId, path: leftPane.currentPath });
      }
    }

    // Subscribe to right pane's directory when in dual mode
    if (isDualMode && rightPane.connectionId) {
      const msg = { action: "subscribe", connection_id: rightPane.connectionId, path: rightPane.currentPath };
      if (sendToWs(rightPane.connectionId, msg)) {
        subscribed.push({ connection_id: rightPane.connectionId, path: rightPane.currentPath });
      }
    }

    // Cleanup: unsubscribe from old paths when deps change or on unmount
    return () => {
      for (const sub of subscribed) {
        sendToWs(sub.connection_id, { action: "unsubscribe", connection_id: sub.connection_id, path: sub.path });
      }
    };
  }, [leftPane.currentPath, leftPane.connectionId, rightPane.currentPath, rightPane.connectionId, isDualMode, paneMode]);

  // ──────────────────────────────────────────────────────────────────────────
  // Dual-Pane Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /** Toggle between single and dual-pane mode. */
  const handleToggleDualPane = useCallback(() => {
    const leftTarget = getCurrentLeftTarget();
    if (!leftTarget) {
      return;
    }

    if (paneMode === "single") {
      navigateToBrowseState({
        left: leftTarget,
        right: buildBrowseRouteTarget(leftPane.connectionIdRef.current, leftPane.currentPathRef.current, allConnections),
        activePaneId: "right",
      });
    } else {
      navigateToBrowseState({
        left: leftTarget,
        right: null,
        activePaneId: "left",
      });
      // Focus left pane's list container
      setTimeout(() => leftPane.listContainerEl?.focus(), 0);
    }
  }, [allConnections, getCurrentLeftTarget, leftPane, navigateToBrowseState, paneMode]);

  /** Switch focus to the other pane (Tab in dual mode). */
  const handleSwitchPane = useCallback(() => {
    if (!isDualMode) return;
    const currentId = effectiveActivePaneIdRef.current;
    const nextId: PaneId = currentId === "left" ? "right" : "left";
    replaceActivePaneInRoute(nextId);
    const nextPane = nextId === "left" ? leftPane : rightPane;
    setTimeout(() => nextPane.listContainerEl?.focus(), 0);
  }, [isDualMode, leftPane, replaceActivePaneInRoute, rightPane]);

  /** Focus the left pane (Ctrl+1). Opens dual mode from single if Ctrl+2 is used. */
  const handleFocusLeftPane = useCallback(() => {
    if (paneMode === "dual") {
      replaceActivePaneInRoute("left");
    }
    setTimeout(() => leftPane.listContainerEl?.focus(), 0);
  }, [leftPane, paneMode, replaceActivePaneInRoute]);

  /** Focus the right pane (Ctrl+2). Opens dual mode if currently in single. */
  const handleFocusRightPane = useCallback(() => {
    const leftTarget = getCurrentLeftTarget();
    if (!leftTarget) {
      return;
    }

    if (paneMode === "single") {
      navigateToBrowseState({
        left: leftTarget,
        right: buildBrowseRouteTarget(leftPane.connectionIdRef.current, leftPane.currentPathRef.current, allConnections),
        activePaneId: "right",
      });
    } else {
      replaceActivePaneInRoute("right");
    }
    setTimeout(() => rightPane.listContainerEl?.focus(), 0);
  }, [allConnections, getCurrentLeftTarget, leftPane, navigateToBrowseState, paneMode, replaceActivePaneInRoute, rightPane]);

  // ──────────────────────────────────────────────────────────────────────────
  // Copy / Move Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Open the copy/move dialog with the effective selection from the active pane.
   * The destination is pre-filled from the other pane's current directory.
   */
  const handleOpenCopyMoveDialog = useCallback(
    (mode: CopyMoveMode) => {
      if (!isDualMode) return;

      const sourcePaneId = effectiveActivePaneIdRef.current;
      const sourcePane = sourcePaneId === "left" ? leftPane : rightPane;
      const destPane = sourcePaneId === "left" ? rightPane : leftPane;

      const files = sourcePane.getEffectiveSelection();
      if (files.length === 0) return;

      const destConnId = destPane.connectionIdRef.current;
      const destConn = connections.find((c) => c.id === destConnId);

      setCopyMoveMode(mode);
      setCopyMoveFiles(files);
      setCopyMoveSourcePaneId(sourcePaneId);
      setCopyMoveSourceConnectionId(sourcePane.connectionIdRef.current);
      setCopyMoveSourcePath(sourcePane.currentPathRef.current);
      setCopyMoveDestConnectionId(destConnId);
      setCopyMoveDestConnectionName(destConn?.name ?? "");
      setCopyMoveDestPath(destPane.currentPathRef.current);
      setCopyMoveError(null);
      setCopyMoveProgress(undefined);
      setCopyMoveTransferProgress(null);
      setCopyMoveProcessing(false);
      setCopyMoveDialogOpen(true);
    },
    [isDualMode, leftPane, rightPane, connections]
  );

  /** Open the copy dialog (F5). */
  const handleCopyToOtherPane = useCallback(() => handleOpenCopyMoveDialog("copy"), [handleOpenCopyMoveDialog]);

  /** Open the move dialog (F6). */
  const handleMoveToOtherPane = useCallback(() => handleOpenCopyMoveDialog("move"), [handleOpenCopyMoveDialog]);

  /**
   * Execute the copy/move operation for all selected files sequentially.
   * Shows progress per file. Both panes refresh via WebSocket after completion.
   */
  const handleCopyMoveConfirm = useCallback(
    async (destPath: string, destFileName: string | undefined, overwriteStrategy: OverwriteStrategy) => {
      if (copyMoveFiles.length === 0) return;

      setCopyMoveProcessing(true);
      setCopyMoveError(null);
      setCopyMoveTransferProgress(null);
      setCopyMoveProgress({ current: 0, total: copyMoveFiles.length });

      const apiFn = copyMoveMode === "copy" ? api.copyItem.bind(api) : api.moveItem.bind(api);
      const errors: string[] = [];
      let destinationMutated = false;
      let sourceMutated = false;

      // Mutable state for "apply to all" decisions made during the loop
      let effectiveStrategy = overwriteStrategy;
      let conflictCount = 0;

      for (let i = 0; i < copyMoveFiles.length; i++) {
        const file = copyMoveFiles[i]!;
        const sourcePath = copyMoveSourcePath ? `${copyMoveSourcePath}/${file.name}` : file.name;
        // Use the renamed file name for single-item operations, otherwise keep original
        const targetName = destFileName ?? file.name;
        const fullDestPath = destPath ? `${destPath}/${targetName}` : targetName;
        const crossConnId = copyMoveSourceConnectionId !== copyMoveDestConnectionId ? copyMoveDestConnectionId : undefined;

        setCopyMoveProgress({ current: i + 1, total: copyMoveFiles.length });

        try {
          await apiFn(copyMoveSourceConnectionId, sourcePath, fullDestPath, crossConnId);
          destinationMutated = true;
          if (copyMoveMode === "move") {
            sourceMutated = true;
          }
        } catch (err) {
          // ── Handle 409 Conflict (destination already exists) ──
          if (isApiError(err) && err.response?.status === 409) {
            const detail = err.response?.data?.detail;
            const conflict = typeof detail === "object" && detail !== null ? (detail as ConflictInfo) : null;

            if (conflict && effectiveStrategy === "ask") {
              // Pause the loop and show the conflict dialog
              conflictCount++;
              setConflictInfo(conflict);
              setConflictProgress({ current: i + 1, total: copyMoveFiles.length, conflictsSoFar: conflictCount });

              const decision = await new Promise<{ resolution: ConflictResolution; applyToAll: boolean }>((resolve) => {
                conflictResolveRef.current = resolve;
                setConflictDialogOpen(true);
              });

              setConflictDialogOpen(false);

              // If user chose "apply to all", convert the per-file decision
              // into a batch strategy for the rest of the operation.
              if (decision.applyToAll) {
                effectiveStrategy = decision.resolution === "replace" ? "replace-all" : "skip-all";
              }

              if (decision.resolution === "replace") {
                // Retry the operation with overwrite enabled
                try {
                  await apiFn(copyMoveSourceConnectionId, sourcePath, fullDestPath, crossConnId, true);
                  destinationMutated = true;
                  if (copyMoveMode === "move") {
                    sourceMutated = true;
                  }
                } catch (retryErr) {
                  const msg = (isApiError(retryErr) ? retryErr.message : undefined) ?? `Failed to ${copyMoveMode} ${file.name}`;
                  errors.push(msg);
                  logger.error(`${copyMoveMode} overwrite failed`, { file: file.name, error: retryErr }, "browser");
                }
              }
              // else: "skip" — do nothing, move to next file
              continue;
            }

            if (effectiveStrategy === "replace-all") {
              // Silently overwrite
              try {
                await apiFn(copyMoveSourceConnectionId, sourcePath, fullDestPath, crossConnId, true);
                destinationMutated = true;
                if (copyMoveMode === "move") {
                  sourceMutated = true;
                }
              } catch (retryErr) {
                const msg = (isApiError(retryErr) ? retryErr.message : undefined) ?? `Failed to ${copyMoveMode} ${file.name}`;
                errors.push(msg);
                logger.error(`${copyMoveMode} overwrite failed`, { file: file.name, error: retryErr }, "browser");
              }
              continue;
            }

            if (effectiveStrategy === "skip-all") {
              // Silently skip
              continue;
            }
          }

          // ── Non-conflict errors ──
          const msg = (isApiError(err) ? err.message : undefined) ?? `Failed to ${copyMoveMode} ${file.name}`;
          errors.push(msg);
          logger.error(`${copyMoveMode} failed`, { file: file.name, error: err }, "browser");
        }
      }

      setCopyMoveProcessing(false);
      setCopyMoveTransferProgress(null);

      const sourcePane = copyMoveSourcePaneId === "left" ? leftPane : rightPane;
      const destPane = copyMoveSourcePaneId === "left" ? rightPane : leftPane;

      if (destinationMutated) {
        destPane.forceReloadCurrentDirectory();
      }

      if (sourceMutated) {
        sourcePane.forceReloadCurrentDirectory();
      }

      if (errors.length > 0) {
        setCopyMoveError(errors.join("; "));
      } else {
        // Success — close dialog and clear selection on the source pane
        setCopyMoveDialogOpen(false);
        const sourcePaneId = effectiveActivePaneIdRef.current;
        const sourcePane = sourcePaneId === "left" ? leftPane : rightPane;
        sourcePane.handleClearSelection();
      }
    },
    [
      copyMoveFiles,
      copyMoveMode,
      copyMoveSourcePaneId,
      copyMoveSourceConnectionId,
      copyMoveSourcePath,
      copyMoveDestConnectionId,
      leftPane,
      rightPane,
    ]
  );

  /** Called when the user resolves an overwrite conflict dialog. */
  const handleConflictResolve = useCallback((resolution: ConflictResolution, applyToAll: boolean) => {
    conflictResolveRef.current?.({ resolution, applyToAll });
    conflictResolveRef.current = null;
  }, []);

  /** Cancel the copy/move dialog. */
  const handleCopyMoveCancel = useCallback(() => {
    if (!copyMoveProcessing) {
      setCopyMoveDialogOpen(false);
    }
  }, [copyMoveProcessing]);

  const handleOpenSettings = useCallback(() => {
    if (useCompactLayout) {
      setMobileSettingsInitialView("main");
      setMobileSettingsOpen(true);
      return;
    }

    setSettingsInitialCategory(DEFAULT_SETTINGS_CATEGORY);
    setSettingsOpen(true);
  }, [useCompactLayout]);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    // Return focus to active pane's file list after closing settings
    setTimeout(() => {
      activePane.listContainerEl?.focus();
    }, 0);
  };

  const openConnectionsSettings = useCallback(() => {
    if (useCompactLayout) {
      setMobileSettingsInitialView("connections");
      setMobileSettingsOpen(true);
      return;
    }

    setSettingsInitialCategory("connections");
    setSettingsOpen(true);
  }, [useCompactLayout]);

  const openQuickBarMode = useCallback(
    (mode: "smart" | "commands" | "filter") => {
      const sourcePaneId = effectiveActivePaneIdRef.current;
      setQuickBarPaneId(sourcePaneId);
      setQuickBarMode(mode);
      setQuickBarActivationToken((current) => current + 1);
      setTimeout(() => {
        const sourcePane = sourcePaneId === "right" && isDualMode ? rightPane : leftPane;
        sourcePane.searchInputRef.current?.focus();
        sourcePane.searchInputRef.current?.select();
      }, 0);
    },
    [isDualMode, leftPane, rightPane]
  );

  const browserCommandContext = useMemo(
    () => ({
      isDualMode,
      useCompactLayout,
      settingsOpen,
      mobileSettingsOpen,
      helpOpen: showHelp,
      quickBarMode,
      hasFiles: quickBarPane.filesRef.current.length > 0,
      hasFocusedFile: quickBarPane.focusedIndex >= 0 && quickBarPane.filesRef.current[quickBarPane.focusedIndex] !== undefined,
      connectionSelected: quickBarPane.connectionId !== "",
      openQuickNav: () => openQuickBarMode("smart"),
      openFilterMode: () => openQuickBarMode("filter"),
      openCommandMode: () => openQuickBarMode("commands"),
      openSettings: handleOpenSettings,
      openConnectionsSettings,
      openHelp: () => setShowHelp(true),
      refresh: quickBarPane.handleRefresh,
      navigateUp: quickBarPane.handleNavigateUpDirectory,
      openFocusedItem: quickBarPane.handleOpenFile,
      renameFocusedItem: quickBarPane.handleRenameRequest,
      deleteFocusedItem: quickBarPane.handleDeleteRequest,
      newDirectory: quickBarPane.handleNewDirectoryRequest,
      newFile: quickBarPane.handleNewFileRequest,
      openInApp: () => {
        void quickBarPane.handleOpenInApp();
      },
      toggleDualPane: handleToggleDualPane,
      focusLeftPane: handleFocusLeftPane,
      focusRightPane: handleFocusRightPane,
      switchPane: handleSwitchPane,
      copyToOtherPane: handleCopyToOtherPane,
      moveToOtherPane: handleMoveToOtherPane,
    }),
    [
      handleCopyToOtherPane,
      handleFocusLeftPane,
      handleFocusRightPane,
      handleMoveToOtherPane,
      handleOpenSettings,
      handleSwitchPane,
      handleToggleDualPane,
      isDualMode,
      mobileSettingsOpen,
      openConnectionsSettings,
      openQuickBarMode,
      quickBarMode,
      quickBarPane,
      settingsOpen,
      showHelp,
      useCompactLayout,
    ]
  );

  const browserCommandsProvider = useBrowserCommandsProvider({
    commands: getEnabledBrowserCommands(browserCommandContext),
    onSelect: (command) => command.run(browserCommandContext),
  });

  const smartBrowserSearchProvider = useSmartBrowserSearchProvider({
    directoryProvider: quickBarPane.directorySearchProvider,
    commandsProvider: browserCommandsProvider,
  });

  const filterInputProvider = useMemo(
    () => ({
      id: "current-directory-filter-input",
      modeId: "filter",
      modeLabel: t("fileBrowser.search.modes.filter"),
      placeholder: t("fileBrowser.search.placeholders.filterCurrentDirectory"),
      debounceMs: 0,
      minQueryLength: 0,
      fetchResults: async () => [],
      onSelect: () => undefined,
      getStatusInfo: () => null,
      shortcutHint: BROWSER_SHORTCUTS.FILTER_CURRENT_DIRECTORY.label,
    }),
    [t]
  );

  const quickBarProvider = useMemo(() => {
    if (quickBarMode === "commands") {
      return browserCommandsProvider;
    }

    if (quickBarMode === "filter") {
      return filterInputProvider;
    }

    return smartBrowserSearchProvider;
  }, [browserCommandsProvider, filterInputProvider, quickBarMode, smartBrowserSearchProvider]);

  const quickBarQueryValue = quickBarMode === "filter" ? quickBarPane.currentDirectoryFilter : undefined;
  const handleQuickBarQueryValueChange = quickBarMode === "filter" ? quickBarPane.setCurrentDirectoryFilter : undefined;
  const connectionSelectorButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const handleQuickBarArrowDownToFileList = useCallback(() => {
    if (quickBarPane.filesRef.current.length === 0) {
      return;
    }

    quickBarPane.listContainerEl?.focus();
  }, [quickBarPane]);
  const handleOpenConnectionSelector = useCallback(() => {
    const connectionSelectorButton = connectionSelectorButtonRef.current;
    if (!connectionSelectorButton) {
      return;
    }

    connectionSelectorButton.focus();
    if (connectionSelectorButton.getAttribute("aria-expanded") !== "true") {
      connectionSelectorButton.click();
    }
  }, []);

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
  const browserShortcuts = useMemo(() => {
    // Common condition building blocks to avoid repetition
    const noSettings = !settingsOpen && !mobileSettingsOpen;
    const browsing = noSettings && !activePane.viewInfo;
    const hasFiles = activePane.filesRef.current.length > 0;
    const hasFocusedFile = activePane.focusedIndex >= 0 && activePane.filesRef.current[activePane.focusedIndex] !== undefined;
    const noDialogOpen = !activePane.deleteDialogOpen && !activePane.renameDialogOpen && !activePane.createDialogOpen;
    const noDialogOrCopyMove = noDialogOpen && !copyMoveDialogOpen;

    return [
      // Navigation - Arrow keys (focus checked inside handlers)
      {
        ...BROWSER_SHORTCUTS.ARROW_DOWN,
        handler: activePane.handleNavigateDown,
        enabled: browsing && hasFiles,
      },
      {
        ...BROWSER_SHORTCUTS.ARROW_UP,
        handler: activePane.handleArrowUp,
        enabled: browsing && hasFiles,
      },
      // Navigation - Home/End (focus checked inside handlers)
      {
        ...COMMON_SHORTCUTS.FIRST_PAGE,
        description: "First file",
        handler: activePane.handleHome,
        enabled: browsing && hasFiles,
      },
      {
        ...COMMON_SHORTCUTS.LAST_PAGE,
        description: "Last file",
        handler: activePane.handleEnd,
        enabled: browsing && hasFiles,
      },
      // Navigation - Page Up/Down (focus checked inside handlers)
      {
        ...COMMON_SHORTCUTS.PAGE_DOWN,
        handler: activePane.handlePageDown,
        enabled: browsing && hasFiles,
      },
      {
        ...COMMON_SHORTCUTS.PAGE_UP,
        handler: activePane.handlePageUp,
        enabled: browsing && hasFiles,
      },
      // Open file/folder (focus checked inside handler)
      {
        ...COMMON_SHORTCUTS.OPEN,
        handler: activePane.handleOpenFile,
        enabled: browsing && hasFocusedFile,
      },
      // Navigate up directory
      {
        ...BROWSER_SHORTCUTS.NAVIGATE_UP,
        handler: activePane.handleNavigateUpDirectory,
        enabled: browsing && activePane.currentPathRef.current !== "",
      },
      // Clear selection and search (close action in browser context)
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: activePane.handleClose,
        enabled: noDialogOrCopyMove,
      },
      // Refresh (Ctrl+R) — available in both single and dual pane modes
      {
        ...BROWSER_SHORTCUTS.REFRESH,
        handler: activePane.handleRefresh,
        enabled: browsing,
      },
      // Smart navigation (Ctrl+K) — also focuses the search bar
      {
        ...BROWSER_SHORTCUTS.QUICK_NAVIGATE,
        handler: () => openQuickBarMode("smart"),
        enabled: browsing,
      },
      // Smart navigation compatibility alias (Ctrl+Alt+F)
      {
        ...BROWSER_SHORTCUTS.FILTER_CURRENT_DIRECTORY,
        handler: () => openQuickBarMode("filter"),
        enabled: browsing,
      },
      // Command palette (Ctrl+P)
      {
        ...BROWSER_SHORTCUTS.COMMAND_PALETTE,
        handler: () => openQuickBarMode("commands"),
        enabled: noSettings,
      },
      // Command palette alternate binding (F1)
      {
        ...BROWSER_SHORTCUTS.COMMAND_PALETTE_ALTERNATE,
        handler: () => openQuickBarMode("commands"),
        enabled: noSettings,
      },
      // Focus connection selector (Ctrl+Down)
      {
        ...BROWSER_SHORTCUTS.FOCUS_CONNECTION_SELECTOR,
        handler: handleOpenConnectionSelector,
        enabled: !useCompactLayout && noSettings && allConnections.length > 0,
      },
      // Open settings (Ctrl+,)
      {
        ...BROWSER_SHORTCUTS.OPEN_SETTINGS,
        handler: handleOpenSettings,
        enabled: browsing,
      },
      // Show help
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP,
        handler: () => setShowHelp(true),
        enabled: browsing,
      },
      // Delete file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.DELETE_ITEM,
        handler: activePane.handleDeleteRequest,
        enabled: browsing && noDialogOpen && hasFocusedFile,
      },
      // Rename file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.RENAME_ITEM,
        handler: activePane.handleRenameRequest,
        enabled: browsing && noDialogOpen && hasFocusedFile,
      },
      // Open in companion app (Ctrl+Enter)
      {
        ...BROWSER_SHORTCUTS.OPEN_IN_APP,
        handler: activePane.handleOpenInApp,
        enabled: browsing && activePane.focusedIndex >= 0 && activePane.filesRef.current[activePane.focusedIndex]?.type === "file",
      },
      // Create new directory (F7)
      {
        ...BROWSER_SHORTCUTS.NEW_DIRECTORY,
        handler: activePane.handleNewDirectoryRequest,
        enabled: browsing && noDialogOpen,
      },
      // Create new file (Shift+F7)
      {
        ...BROWSER_SHORTCUTS.NEW_FILE,
        handler: activePane.handleNewFileRequest,
        enabled: browsing && noDialogOpen,
      },

      // ── Selection Shortcuts (Norton Commander multi-select) ──────────────
      // Toggle selection on focused file, then move focus down (Insert / Space)
      {
        ...SELECTION_SHORTCUTS.TOGGLE_SELECTION,
        handler: activePane.handleToggleSelection,
        enabled: browsing && noDialogOrCopyMove && hasFiles,
      },
      // Select focused file & move down (Alt+Down)
      {
        ...SELECTION_SHORTCUTS.SELECT_DOWN,
        handler: activePane.handleSelectDown,
        enabled: browsing && noDialogOrCopyMove && hasFiles,
        priority: 10,
      },
      // Select focused file & move up (Alt+Up)
      {
        ...SELECTION_SHORTCUTS.SELECT_UP,
        handler: activePane.handleSelectUp,
        enabled: browsing && noDialogOrCopyMove && hasFiles,
        priority: 10,
      },
      // Select all files (Ctrl+A)
      {
        ...SELECTION_SHORTCUTS.SELECT_ALL,
        handler: activePane.handleSelectAll,
        enabled: browsing && noDialogOrCopyMove && hasFiles,
      },

      // ── Copy / Move Shortcuts (dual-pane only) ──────────────────────────
      // Copy to other pane (F5 in dual mode — takes priority over Refresh)
      {
        ...COPY_MOVE_SHORTCUTS.COPY_TO_OTHER_PANE,
        handler: handleCopyToOtherPane,
        enabled: isDualMode && browsing && noDialogOrCopyMove,
      },
      // Move to other pane (F6 in dual mode)
      {
        ...COPY_MOVE_SHORTCUTS.MOVE_TO_OTHER_PANE,
        handler: handleMoveToOtherPane,
        enabled: isDualMode && browsing && noDialogOrCopyMove,
      },

      // ── Dual-Pane Shortcuts ──────────────────────────────────────────────
      {
        ...PANE_SHORTCUTS.TOGGLE_DUAL_PANE,
        handler: handleToggleDualPane,
        enabled: noSettings && !useCompactLayout,
      },
      {
        ...PANE_SHORTCUTS.FOCUS_LEFT_PANE,
        handler: handleFocusLeftPane,
        enabled: noSettings && noDialogOrCopyMove,
      },
      {
        ...PANE_SHORTCUTS.FOCUS_RIGHT_PANE,
        handler: handleFocusRightPane,
        enabled: noSettings && noDialogOrCopyMove,
      },
      {
        ...PANE_SHORTCUTS.SWITCH_PANE,
        handler: handleSwitchPane,
        enabled: noSettings && isDualMode && noDialogOrCopyMove,
      },
    ];
  }, [
    activePane,
    handleOpenSettings,
    handleOpenConnectionSelector,
    settingsOpen,
    mobileSettingsOpen,
    useCompactLayout,
    isDualMode,
    copyMoveDialogOpen,
    allConnections.length,
    openQuickBarMode,
    handleToggleDualPane,
    handleSwitchPane,
    handleFocusLeftPane,
    handleFocusRightPane,
    handleCopyToOtherPane,
    handleMoveToOtherPane,
  ]);

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
    let rafId = 0;

    const handleKeyDown = () => {
      // Cancel any pending pointer-triggered update so a quick
      // key-after-click doesn't get overridden.
      cancelAnimationFrame(rafId);
      setIsUsingKeyboard(true);
    };

    const handlePointerDown = () => {
      // Defer the state update until after the current event cycle.
      // Without this, React assigns SyncLane to the update (pointerdown
      // is a discrete event) and flushes it via microtask between the
      // pointerdown and click events.  The synchronous re-render cascades
      // through non-memoised viewer components, causing DOM mutations
      // (e.g. react-markdown's `node` prop) on the click target that
      // make the browser lose the click.
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setIsUsingKeyboard(false));
    };

    // Use capture phase to ensure these run before any other handlers
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Render Helpers
  // ──────────────────────────────────────────────────────────────────────────

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    navigate("/login");
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

      await companion.refresh();

      let companionDrives: DriveInfo[] = [];
      if (hasStoredSecret()) {
        try {
          companionDrives = await companionService.getDrives();
        } catch (error) {
          logger.warn("Failed to refresh companion drives after settings change", { error }, "companion");
        }
      }

      const availableConnections = mergeConnections(data, companionDrives);
      const hasConnection = (connectionId: string) => availableConnections.some((connection) => connection.id === connectionId);

      // Invalidate caches in both panes since connection properties may have changed
      const leftConnId = leftPane.connectionId;
      if (leftConnId && hasConnection(leftConnId)) {
        leftPane.invalidateConnectionCache(leftConnId);
        leftPane.loadFiles(leftPane.currentPathRef.current, true);
      }
      const rightConnId = rightPane.connectionId;
      if (rightConnId && hasConnection(rightConnId)) {
        rightPane.invalidateConnectionCache(rightConnId);
        rightPane.loadFiles(rightPane.currentPathRef.current, true);
      }

      // Check if left pane's connection still exists
      if (leftConnId && hasConnection(leftConnId)) {
        // Left pane's connection is fine — check right pane too
        if (rightConnId && !hasConnection(rightConnId)) {
          navigateToBrowseState(
            {
              left: buildBrowseRouteTarget(leftConnId, leftPane.currentPathRef.current, availableConnections),
              right: null,
              activePaneId: "left",
            },
            { replace: true }
          );
        }
        return;
      }

      // Left pane's connection removed or no selection - select first alphabetically
      if (availableConnections.length > 0) {
        const sortedByName = [...availableConnections].sort((a, b) => compareLocalizedStrings(a.name, b.name));
        const firstConnection = sortedByName[0];
        if (firstConnection) {
          navigateToBrowseState(
            {
              left: buildBrowseRouteTarget(firstConnection.id, "", availableConnections),
              right: null,
              activePaneId: "left",
            },
            { replace: true }
          );
        }
      } else {
        // No connections remaining - show welcome screen
        leftPane.applyLocation("", "");
        rightPane.applyLocation("", "");
        localStorage.removeItem("selectedConnectionId");
        navigate("/browse", { replace: true });
      }
    } catch (err) {
      logger.error("Error refreshing connections", { error: err }, "browser");
    }
  }, [companion, leftPane, navigate, navigateToBrowseState, rightPane]);

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
        connections={allConnections}
        selectedConnectionId={activePane.connectionId}
        onConnectionChange={activePane.handleConnectionChange}
        onNavigateToRoot={() => {
          if (effectiveActivePaneId === "right" && paneMode === "dual") {
            rightPathNavigateRef.current("");
          } else {
            leftPathNavigateRef.current("");
          }
          activePane.setViewInfo(null);
        }}
        onOpenSettings={handleOpenSettings}
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
              searchProvider={quickBarProvider}
              searchActivationToken={quickBarActivationToken}
              searchInputRef={quickBarPane.searchInputRef}
              showSearch={activePane.connectionId !== ""}
              onOpenSettings={handleOpenSettings}
              onBlurToFileList={() => quickBarPane.listContainerEl?.focus()}
              searchQueryValue={quickBarQueryValue}
              onSearchQueryValueChange={handleQuickBarQueryValueChange}
              disableSearchDropdown={quickBarMode === "filter"}
              onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
              disableTabFocus={isDualMode}
            />
          )}
        </Toolbar>
      </AppBar>
      {/* Secondary action strip — view mode & sort controls for the active pane (desktop only) */}
      {!useCompactLayout && (
        <SecondaryActionStrip
          connections={allConnections}
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
          companionStatus={companion.status}
          onOpenConnectionsSettings={openConnectionsSettings}
          connectionButtonRef={connectionSelectorButtonRef}
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
          backendAvailabilityStatus={backendAvailability.status}
          onRetry={leftPane.handleRefresh}
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
              connections={allConnections}
              useCompactLayout={useCompactLayout}
              isUsingKeyboard={isUsingKeyboard}
              onPaneFocus={() => {
                if (paneMode === "dual") {
                  replaceActivePaneInRoute("left");
                }
              }}
              disableTabFocus={isDualMode}
              searchProvider={quickBarProvider}
              searchActivationToken={quickBarActivationToken}
              searchQueryValue={quickBarQueryValue}
              onSearchQueryValueChange={handleQuickBarQueryValueChange}
              disableSearchDropdown={quickBarMode === "filter"}
              onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
              onNavigatePath={(path) => leftPathNavigateRef.current(path)}
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
                  connections={allConnections}
                  useCompactLayout={useCompactLayout}
                  isUsingKeyboard={isUsingKeyboard}
                  onPaneFocus={() => {
                    replaceActivePaneInRoute("right");
                  }}
                  disableTabFocus={isDualMode}
                  searchProvider={quickBarProvider}
                  searchActivationToken={quickBarActivationToken}
                  searchQueryValue={quickBarQueryValue}
                  onSearchQueryValueChange={handleQuickBarQueryValueChange}
                  disableSearchDropdown={quickBarMode === "filter"}
                  onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
                  onNavigatePath={(path) => rightPathNavigateRef.current(path)}
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
        title={t("keyboardShortcutsHelp.titles.fileBrowser")}
      />
      {/* Companion app guidance hint */}
      <Snackbar
        open={companionHintOpen}
        autoHideDuration={6000}
        onClose={() => setCompanionHintOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message="Opening in Sambee Companion… If nothing happened, make sure the companion app is installed."
      />
      {/* Copy / Move Dialog (dual-pane F5/F6) */}
      <CopyMoveDialog
        open={copyMoveDialogOpen}
        mode={copyMoveMode}
        files={copyMoveFiles}
        sourceConnectionId={copyMoveSourceConnectionId}
        sourcePath={copyMoveSourcePath}
        destConnectionId={copyMoveDestConnectionId}
        destConnectionName={copyMoveDestConnectionName}
        destPath={copyMoveDestPath}
        isSameConnection={copyMoveSourceConnectionId === copyMoveDestConnectionId}
        onConfirm={handleCopyMoveConfirm}
        onCancel={handleCopyMoveCancel}
        isProcessing={copyMoveProcessing}
        progress={copyMoveProgress}
        transferProgress={copyMoveTransferProgress}
        error={copyMoveError}
      />
      {/* Overwrite Conflict Dialog (shown per-file during copy/move) */}
      <OverwriteConflictDialog
        open={conflictDialogOpen}
        conflict={conflictInfo}
        progress={conflictProgress}
        onResolve={handleConflictResolve}
      />
    </Box>
  );
};

export default Browser;
