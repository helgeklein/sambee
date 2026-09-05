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

import { AppBar, Box, Container, Divider, Snackbar, Toolbar, Typography, useMediaQuery, useTheme } from "@mui/material";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArchiveExtractDialog } from "../components/FileBrowser/ArchiveExtractDialog";
import { ArchiveOperationProgress } from "../components/FileBrowser/ArchiveOperationProgress";
import CopyMoveDialog, { type CopyMoveMode } from "../components/FileBrowser/CopyMoveDialog";
import { DesktopToolbar } from "../components/FileBrowser/DesktopToolbar";
import { DynamicViewer } from "../components/FileBrowser/DynamicViewer";
import type { CompanionLifecycleStatus } from "../components/FileBrowser/FileBrowserAlerts";
import { FileBrowserAlerts } from "../components/FileBrowser/FileBrowserAlerts";
import { InlineItemName } from "../components/FileBrowser/InlineItemName";
import { MobileToolbar } from "../components/FileBrowser/MobileToolbar";
import NameInputDialog from "../components/FileBrowser/NameInputDialog";
import {
  type ConflictDecision,
  type ConflictResolution,
  OverwriteResolutionDialog,
} from "../components/FileBrowser/OverwriteConflictDialog";
import { SecondaryActionStrip } from "../components/FileBrowser/SecondaryActionStrip";
import { useBrowserCommandsProvider } from "../components/FileBrowser/search";
import { useFileSearchProvider } from "../components/FileBrowser/search/useFileSearchProvider";
import { KeyboardShortcutsHelp } from "../components/KeyboardShortcutsHelp";
import HamburgerMenu from "../components/Mobile/HamburgerMenu";
import { MobileSettingsDrawer } from "../components/Mobile/MobileSettingsDrawer";
import SettingsDialog from "../components/Settings/SettingsDialog";
import {
  DEFAULT_SETTINGS_CATEGORY,
  type MobileSettingsView,
  SETTINGS_CATEGORY_ORDER,
  type SettingsCategory,
} from "../components/Settings/settingsNavigation";
import { getEnabledBrowserCommands } from "../config/browserCommands";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, COPY_MOVE_SHORTCUTS, PANE_SHORTCUTS, SELECTION_SHORTCUTS } from "../config/keyboardShortcuts";
import { useCompanion } from "../hooks/useCompanion";
import { type KeyboardShortcut, useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { signOutCurrentBrowser } from "../services/accountSession";
import { authSession } from "../services/authSession";
import { markBackendAvailable, useBackendAvailability } from "../services/backendAvailability";
import { subscribeBackendRecoveryConfirmed, subscribeBackendRecoveryReconnect } from "../services/backendRecoveryEvents";
import { isLocalDrive, mergeConnections } from "../services/backendRouter";
import { createBrowserContentServices } from "../services/browserContentServices";
import { loadBrowserRecoverySnapshot, saveBrowserRecoverySnapshot } from "../services/browserRecoverySnapshot";
import { companionSession } from "../services/companionSession";
import {
  hasForegroundArchiveWork,
  loadForegroundArchiveOperation,
  requestForegroundArchiveCancellation,
} from "../services/foregroundArchiveOperation";
import { logger } from "../services/logger";
import { loginPath } from "../services/oidcAuth";
import { RECENT_DIRECTORIES_CHANGED_EVENT } from "../services/recentDirectoriesSync";
import { RECENT_FILES_CHANGED_EVENT } from "../services/recentFilesSync";
import { scheduleRuntimeWarmup } from "../services/runtimeWarmup";
import { buildServerWebSocketUrl } from "../services/serverWebsocket";
import type { TargetResolutionPolicy } from "../services/storageContracts";
import { loadCurrentUserSettings } from "../services/userSettingsSync";
import { FILE_BROWSER_ROW_HEIGHT } from "../theme/constants";
import { getMobileViewportShellSx, mobileSafeAreaAppBarSx, mobileSafeAreaToolbarSx, SAFE_AREA_INSET } from "../theme/mobileShell";
import type { ConflictInfo, Connection } from "../types";
import { FileType, isApiError } from "../types";
import { openExternalUrl } from "../utils/externalLinks";
import { compareLocalizedStrings } from "../utils/localeFormatting";
import { canOpenFileInApp, getConnectionById, isConnectionReadOnly, isConnectionWritable } from "./FileBrowser/access";
import {
  areSameContentLocations,
  type ContentOperationExecution,
  cancelForegroundArchiveOperationOnPageHide,
  executeTransfer,
  getCreateContainerAvailability,
  getLocationDisplayName,
  getTransferAvailability,
  hasForegroundArchiveOperationWork,
  isPartialContainerOutputError,
  recoverInterruptedArchiveOperation,
  recoverInterruptedPhysicalTransfer,
  startArchiveExtraction,
  startCreateContainer,
} from "./FileBrowser/contentOperations";
import type {
  ArchiveExtractionConflict,
  ArchiveExtractionExecution,
  ArchiveExtractionOutcome,
  ArchiveExtractionSummary,
  BrowserItem,
  ContentItemHandle,
  ContentLocation,
  PhysicalLocation,
  VirtualLocation,
} from "./FileBrowser/contentProviders";
import { physicalLocation, virtualLocation } from "./FileBrowser/contentProviders";
import { FileBrowserPane } from "./FileBrowser/FileBrowserPane";
import {
  readFileBrowserPaneModePreference,
  readSelectedConnectionIdPreference,
  setFileBrowserPaneModePreference,
  setSelectedConnectionIdPreference,
  useQuickBarKeyboardHints,
  useQuickBarShortcutHintVisibilityPreference,
} from "./FileBrowser/preferences";
import {
  type BrowseRouteState,
  buildBrowseRouteTarget,
  parseBrowseRoute,
  resolveBrowseRouteState,
  serializeBrowseRoute,
} from "./FileBrowser/routing";
import type { ArchiveLocation, DirectoryChange, PaneId, PaneMode, VirtualRouteLocation } from "./FileBrowser/types";
import { ACTIVE_PANE_QUERY_KEY, ACTIVE_PANE_STORAGE_KEY, RIGHT_PANE_QUERY_KEY } from "./FileBrowser/types";
import { useFileBrowserPane } from "./FileBrowser/useFileBrowserPane";

// ============================================================================
// Main Component
// ============================================================================

const SERVER_WEBSOCKET_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;
const COMPANION_WEBSOCKET_RECONNECT_DELAY_MS = 5_000;
const COMPANION_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;

const COMPANION_STATUS_QUERY_PARAM = "companion_status";
const IGNORED_REALTIME_MESSAGE_TYPES = new Set(["subscribed", "unsubscribed", "pong"]);
const COPY_MOVE_FILE_CONFLICT_ACTIONS: readonly ConflictResolution[] = ["skip", "rename"];
const COPY_MOVE_DIRECTORY_CONFLICT_ACTIONS: readonly ConflictResolution[] = ["skip", "rename"];
type CopyMoveConflictPolicy = "ask" | "skip-all";

function parentPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex < 0 ? "" : path.slice(0, separatorIndex);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

export function getCopyMoveConflictActions(conflict: ConflictInfo | null): readonly ConflictResolution[] {
  if (conflict?.incoming_file.type === FileType.FILE && conflict.existing_file.type === FileType.FILE) {
    return COPY_MOVE_FILE_CONFLICT_ACTIONS;
  }
  return COPY_MOVE_DIRECTORY_CONFLICT_ACTIONS;
}

export function targetResolutionPolicyForConflictResolution(resolution: ConflictResolution): TargetResolutionPolicy {
  if (resolution === "overwrite") return "replace";
  if (resolution === "overwrite-older") return "replace_older";
  return "ask";
}

type RealtimeMessage =
  | { type: "directory_changed"; change: DirectoryChange }
  | { type: "transfer_progress"; bytesTransferred: number; totalBytes: number | null; itemName: string }
  | { type: "ignored" };

function parseRealtimeMessage(rawMessage: unknown): RealtimeMessage | null {
  if (typeof rawMessage !== "string") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawMessage);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const message = parsed as Record<string, unknown>;
    if (typeof message.type === "string" && IGNORED_REALTIME_MESSAGE_TYPES.has(message.type)) {
      return { type: "ignored" };
    }
    if (
      message.type === "directory_changed" &&
      typeof message.connection_id === "string" &&
      message.connection_id.length > 0 &&
      typeof message.path === "string"
    ) {
      return { type: "directory_changed", change: { connectionId: message.connection_id, path: message.path } };
    }
    if (message.type === "transfer_progress" && typeof message.bytes_transferred === "number") {
      return {
        type: "transfer_progress",
        bytesTransferred: message.bytes_transferred,
        totalBytes: typeof message.total_bytes === "number" ? message.total_bytes : null,
        itemName: typeof message.item_name === "string" ? message.item_name : "",
      };
    }
  } catch {
    return null;
  }

  return null;
}

const toVirtualRouteLocation = (archiveLocation: ArchiveLocation | null): VirtualRouteLocation | null => {
  if (!archiveLocation) {
    return null;
  }

  return {
    providerId: archiveLocation.providerId,
    sourcePath: archiveLocation.archivePath,
    virtualPath: archiveLocation.virtualPath,
  };
};

function getSafeWebSocketLogUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-websocket-url";
  }
}

function parseCompanionLifecycleStatus(rawStatus: string | null): CompanionLifecycleStatus | null {
  switch (rawStatus) {
    case "renewal_required":
    case "auth_failed":
    case "lock_lost":
    case "recovery_required":
      return rawStatus;
    default:
      return null;
  }
}

interface DirectorySubscription {
  connectionId: string;
  path: string;
}

function getDirectorySubscriptionKey({ connectionId, path }: DirectorySubscription): string {
  return `${connectionId}:${path}`;
}

function createDirectorySubscriptionMap(subscriptions: DirectorySubscription[]): Map<string, DirectorySubscription> {
  return new Map(subscriptions.map((subscription) => [getDirectorySubscriptionKey(subscription), subscription]));
}

function diffDirectorySubscriptions(
  previousSubscriptions: Map<string, DirectorySubscription>,
  nextSubscriptions: Map<string, DirectorySubscription>
): {
  removedSubscriptions: DirectorySubscription[];
  addedSubscriptions: DirectorySubscription[];
} {
  const removedSubscriptions: DirectorySubscription[] = [];
  const addedSubscriptions: DirectorySubscription[] = [];

  for (const [key, subscription] of previousSubscriptions) {
    if (!nextSubscriptions.has(key)) {
      removedSubscriptions.push(subscription);
    }
  }

  for (const [key, subscription] of nextSubscriptions) {
    if (!previousSubscriptions.has(key)) {
      addedSubscriptions.push(subscription);
    }
  }

  return {
    removedSubscriptions,
    addedSubscriptions,
  };
}

function collectDirectorySubscriptions({
  left,
  right,
  isDualMode,
  includeLocalDrives,
}: {
  left: DirectorySubscription;
  right: DirectorySubscription;
  isDualMode: boolean;
  includeLocalDrives: boolean;
}): DirectorySubscription[] {
  const subscriptions: DirectorySubscription[] = [];
  const seen = new Set<string>();

  const maybeAdd = ({ connectionId, path }: DirectorySubscription) => {
    if (!connectionId || isLocalDrive(connectionId) !== includeLocalDrives) {
      return;
    }

    const key = `${connectionId}:${path}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    subscriptions.push({ connectionId, path });
  };

  maybeAdd(left);

  if (isDualMode) {
    maybeAdd(right);
  }

  return subscriptions;
}

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
  const initialRecoverySnapshotRef = React.useRef(loadBrowserRecoverySnapshot());
  const hasHydratedRecoverySnapshotRef = React.useRef(false);

  // ──────────────────────────────────────────────────────────────────────────
  // Responsive Design
  // ──────────────────────────────────────────────────────────────────────────

  // Detect screen size and input method for responsive behavior
  const useCompactLayout = useMediaQuery(theme.breakpoints.down("sm"));
  const [quickBarShortcutHintVisibility] = useQuickBarShortcutHintVisibilityPreference();
  const showQuickBarKeyboardHints = useQuickBarKeyboardHints(quickBarShortcutHintVisibility, useCompactLayout);

  // Use explicit layout density rather than pointer heuristics so row sizing stays stable.
  const rowHeight = useCompactLayout ? FILE_BROWSER_ROW_HEIGHT.MOBILE_PX : FILE_BROWSER_ROW_HEIGHT.DESKTOP_PX;

  // Track if keyboard is being used for navigation (for proper focus styling)
  // Compact/mobile layout starts without focus indicator; desktop shows focus on load.
  const [isUsingKeyboard, setIsUsingKeyboard] = useState(!useCompactLayout);

  // ──────────────────────────────────────────────────────────────────────────
  // Global Page State
  // ──────────────────────────────────────────────────────────────────────────

  const [connections, setConnections] = useState<Connection[]>(() => initialRecoverySnapshotRef.current?.connections ?? []);
  const [loadingConnections, setLoadingConnections] = useState(() => initialRecoverySnapshotRef.current === null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory>(DEFAULT_SETTINGS_CATEGORY);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileSettingsInitialView, setMobileSettingsInitialView] = useState<MobileSettingsView>("main");
  const [showHelp, setShowHelp] = useState(false);
  const [quickBarMode, setQuickBarMode] = useState<"navigate" | "commands" | "file-search">("navigate");
  const [quickBarActivationToken, setQuickBarActivationToken] = useState(0);
  const [quickBarRefreshToken, setQuickBarRefreshToken] = useState(0);
  const [quickBarPaneId, setQuickBarPaneId] = useState<PaneId>("left");
  const [companionHintOpen, setCompanionHintOpen] = useState(false);
  const backendAvailability = useBackendAvailability();

  useEffect(() => {
    const requestedCategory = searchParams.get("settings");
    if (!requestedCategory || !SETTINGS_CATEGORY_ORDER.includes(requestedCategory as SettingsCategory)) {
      return;
    }

    const category = requestedCategory as SettingsCategory;
    if (useCompactLayout) {
      setMobileSettingsInitialView(category);
      setMobileSettingsOpen(true);
    } else {
      setSettingsInitialCategory(category);
      setSettingsOpen(true);
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("settings");
    const nextSearch = nextSearchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true }
    );
  }, [location.hash, location.pathname, navigate, searchParams, useCompactLayout]);

  // ── Companion detection & drive management ──────────────────────────────
  const companion = useCompanion();

  /** Server connections merged with companion-provided local drives. */
  const allConnections = useMemo(() => mergeConnections(connections, companion.drives), [connections, companion.drives]);
  const [browserContentServices] = useState(() => createBrowserContentServices(allConnections));
  useSyncExternalStore(browserContentServices.subscribe, browserContentServices.getSnapshot, browserContentServices.getSnapshot);

  useEffect(() => {
    browserContentServices.updateConnections(allConnections);
  }, [allConnections, browserContentServices]);

  useEffect(() => {
    const status =
      companion.status === "paired"
        ? "paired"
        : companion.status === "detecting" || companion.status === "pending_local_approval"
          ? "pairing"
          : companion.status === "unavailable"
            ? "unavailable"
            : "unpaired";
    browserContentServices.updateCompanionSnapshot({
      status,
      revision: companionSession.getSnapshot().revision,
      drives: companion.drives.map((drive) => ({ driveId: drive.id, name: drive.name, path: "" })),
      error: null,
    });
  }, [browserContentServices, companion.drives, companion.status]);

  useEffect(() => () => browserContentServices.dispose(), [browserContentServices]);

  // ──────────────────────────────────────────────────────────────────────────
  // Copy / Move Dialog State
  // ──────────────────────────────────────────────────────────────────────────

  const [copyMoveDialogOpen, setCopyMoveDialogOpen] = useState(false);
  const [copyMoveMode, setCopyMoveMode] = useState<CopyMoveMode>("copy");
  const [copyMoveItems, setCopyMoveItems] = useState<BrowserItem[]>([]);
  const [copyMoveSourcePaneId, setCopyMoveSourcePaneId] = useState<PaneId>("left");
  const [copyMoveDestination, setCopyMoveDestination] = useState<ContentLocation | null>(null);
  const [copyMoveDestinationLabel, setCopyMoveDestinationLabel] = useState("");
  const [copyMoveSameDirectory, setCopyMoveSameDirectory] = useState(false);
  const [copyMoveDestinationPaneId, setCopyMoveDestinationPaneId] = useState<PaneId>("right");
  const [copyMoveProcessing, setCopyMoveProcessing] = useState(false);
  const [copyMoveProgress, setCopyMoveProgress] = useState<{ current: number; total: number } | undefined>();
  const [copyMoveTransferProgress, setCopyMoveTransferProgress] = useState<{
    bytesTransferred: number;
    totalBytes: number | null;
    itemName: string;
  } | null>(null);
  const [copyMoveError, setCopyMoveError] = useState<string | null>(null);
  const [copyMoveWarning, setCopyMoveWarning] = useState<string | null>(null);
  const copyMoveAbortControllerRef = React.useRef<AbortController | null>(null);

  const [archiveCreateContext, setArchiveCreateContext] = useState<{
    sources: ContentItemHandle[];
    destination: ContentLocation;
    destinationLabel: string;
    destinationPaneId: PaneId;
  } | null>(null);
  const [archiveCreateError, setArchiveCreateError] = useState<string | null>(null);
  const [isCreatingArchive, setIsCreatingArchive] = useState(false);
  const [isCancellingArchiveCreation, setIsCancellingArchiveCreation] = useState(false);
  const archiveCreationExecutionRef = React.useRef<ContentOperationExecution | null>(null);
  const [archiveExtractionContext, setArchiveExtractionContext] = useState<{
    location: VirtualLocation;
    selectedMemberPaths?: string[];
    destinationParent: PhysicalLocation;
    destinationPaneId: PaneId;
    usesSiblingDirectory: boolean;
    destination: PhysicalLocation | null;
    destinationLabel: string;
    archiveName: string;
    initialDestinationName: string;
  } | null>(null);
  const [archiveExtractionError, setArchiveExtractionError] = useState<string | null>(null);
  const [isExtractingArchive, setIsExtractingArchive] = useState(false);
  const [isCancellingArchiveExtraction, setIsCancellingArchiveExtraction] = useState(false);
  const [archiveExtractionConflicts, setArchiveExtractionConflicts] = useState<ArchiveExtractionConflict[] | null>(null);
  const [archiveExtractionMemberError, setArchiveExtractionMemberError] = useState<{
    memberPath: string;
    targetPath: string;
    message: string;
    partialOutput: boolean;
  } | null>(null);
  const [archiveExtractionProgress, setArchiveExtractionProgress] = useState<ArchiveExtractionSummary | null>(null);
  const [archiveExtractionAllowedActions, setArchiveExtractionAllowedActions] = useState<
    Array<"skip" | "skip_all" | "replace" | "replace_all" | "replace_older" | "rename">
  >([]);
  const [isSubmittingArchiveExtractionDecision, setIsSubmittingArchiveExtractionDecision] = useState(false);
  const archiveExtractionExecutionRef = React.useRef<ArchiveExtractionExecution | null>(null);
  const [archiveInterruptionNoticeOpen, setArchiveInterruptionNoticeOpen] = useState(false);
  const archiveWorkflowDialogOpen = archiveCreateContext !== null || archiveExtractionContext !== null;

  useEffect(() => {
    void recoverInterruptedArchiveOperation(browserContentServices.archiveOperations).then((interrupted) => {
      if (interrupted) setArchiveInterruptionNoticeOpen(true);
    });
    void recoverInterruptedPhysicalTransfer();

    const handlePageHide = () => {
      cancelForegroundArchiveOperationOnPageHide(browserContentServices.archiveOperations);
      const extraction = archiveExtractionExecutionRef.current;
      if (extraction) {
        void extraction.cancel();
      } else {
        const operation = loadForegroundArchiveOperation();
        if (operation) requestForegroundArchiveCancellation(operation.operationId);
      }
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasForegroundArchiveOperationWork(browserContentServices.archiveOperations) || hasForegroundArchiveWork()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [browserContentServices.archiveOperations]);

  // Overwrite conflict dialog state
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  const [conflictProgress, setConflictProgress] = useState<{ current: number; total: number; conflictsSoFar: number } | undefined>();
  /** Ref holding the resolve function of a Promise used to pause the processing loop while the conflict dialog is open. */
  const conflictResolveRef = React.useRef<((value: ConflictDecision | null) => void) | null>(null);

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
  const companionLifecycleStatus = useMemo(
    () => parseCompanionLifecycleStatus(searchParams.get(COMPANION_STATUS_QUERY_PARAM)),
    [searchParams]
  );
  const resolvedRoute = useMemo(() => resolveBrowseRouteState(currentRoute, allConnections), [allConnections, currentRoute]);

  const dismissCompanionLifecycleStatus = useCallback(() => {
    if (!companionLifecycleStatus) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete(COMPANION_STATUS_QUERY_PARAM);
    const nextSearch = nextSearchParams.toString();

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true }
    );
  }, [companionLifecycleStatus, location.pathname, navigate, searchParams]);

  const leftPathNavigateRef = React.useRef<(path: string) => void>(() => undefined);
  const rightPathNavigateRef = React.useRef<(path: string) => void>(() => undefined);
  const leftConnectionNavigateRef = React.useRef<(connectionId: string) => void>(() => undefined);
  const rightConnectionNavigateRef = React.useRef<(connectionId: string) => void>(() => undefined);
  const leftDirectoryNavigateRef = React.useRef<(connectionId: string, path: string) => void>(() => undefined);
  const rightDirectoryNavigateRef = React.useRef<(connectionId: string, path: string) => void>(() => undefined);
  const leftVirtualLocationNavigateRef = React.useRef<(location: VirtualRouteLocation | null) => void>(() => undefined);
  const rightVirtualLocationNavigateRef = React.useRef<(location: VirtualRouteLocation | null) => void>(() => undefined);
  const leftRouteLocationResolveRef = React.useRef<(path: string, archiveLocation: ArchiveLocation | null) => void>(() => undefined);
  const rightRouteLocationResolveRef = React.useRef<(path: string, archiveLocation: ArchiveLocation | null) => void>(() => undefined);
  const pendingPaneFocusRef = React.useRef<PaneId | null>(null);
  const routeSyncTokenRef = React.useRef(0);

  // WebSocket for real-time directory updates (server)
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);
  const serverReconnectAttemptRef = React.useRef(0);
  const triggerServerReconnectRef = React.useRef<(reason: string) => void>(() => undefined);
  const [serverDirectoryWs, setServerDirectoryWs] = useState<WebSocket | null>(null);
  const serverAppliedSubscriptionsRef = React.useRef<Map<string, DirectorySubscription>>(new Map());

  // WebSocket for real-time directory updates (companion / local drives)
  const companionWsRef = React.useRef<WebSocket | null>(null);
  const companionReconnectRef = React.useRef<number | null>(null);
  const [companionDirectoryWs, setCompanionDirectoryWs] = useState<WebSocket | null>(null);
  const companionAppliedSubscriptionsRef = React.useRef<Map<string, DirectorySubscription>>(new Map());

  // ──────────────────────────────────────────────────────────────────────────
  // Pane Hooks — all per-pane state and logic
  // ──────────────────────────────────────────────────────────────────────────

  // Left pane — always present, synced with URL
  const leftPane = useFileBrowserPane({
    connections: allConnections,
    contentProviders: browserContentServices.providers,
    storageRegistry: browserContentServices.registry,
    history: browserContentServices.history,
    linkTargets: browserContentServices.linkTargets,
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen,
    isActive: activePaneId === "left",
    onCompanionHint: () => setCompanionHintOpen(true),
    onNavigatePath: (path) => leftPathNavigateRef.current(path),
    onNavigateConnection: (connectionId) => leftConnectionNavigateRef.current(connectionId),
    onNavigateDirectory: (connectionId, path) => leftDirectoryNavigateRef.current(connectionId, path),
    onNavigateVirtualLocation: (location) => leftVirtualLocationNavigateRef.current(location),
    onResolveRouteLocation: (path, archiveLocation) => leftRouteLocationResolveRef.current(path, archiveLocation),
  });

  // Right pane — always instantiated (React hooks rule: no conditional hooks),
  // but only renders in dual mode. Disabled when not in dual mode.
  const rightPane = useFileBrowserPane({
    connections: allConnections,
    contentProviders: browserContentServices.providers,
    storageRegistry: browserContentServices.registry,
    history: browserContentServices.history,
    linkTargets: browserContentServices.linkTargets,
    rowHeight,
    disabled: settingsOpen || mobileSettingsOpen || paneMode === "single",
    isActive: activePaneId === "right" && paneMode === "dual",
    onCompanionHint: () => setCompanionHintOpen(true),
    onNavigatePath: (path) => rightPathNavigateRef.current(path),
    onNavigateConnection: (connectionId) => rightConnectionNavigateRef.current(connectionId),
    onNavigateDirectory: (connectionId, path) => rightDirectoryNavigateRef.current(connectionId, path),
    onNavigateVirtualLocation: (location) => rightVirtualLocationNavigateRef.current(location),
    onResolveRouteLocation: (path, archiveLocation) => rightRouteLocationResolveRef.current(path, archiveLocation),
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
  const quickBarOtherPane = quickBarPaneId === "right" && isDualMode ? leftPane : rightPane;
  const quickBarInputRef = quickBarPane.searchInputRef;
  const viewerOverlayOpen = Boolean(leftPane.viewInfo || rightPane.viewInfo);
  const activePaneConnection = getConnectionById(allConnections, activePane.connectionId);
  const quickBarPaneConnection = getConnectionById(allConnections, quickBarPane.connectionId);
  const leftPaneConnection = getConnectionById(allConnections, leftPane.connectionId);
  const rightPaneConnection = getConnectionById(allConnections, rightPane.connectionId);
  const activePaneFocusedFile = activePane.focusedIndex >= 0 ? activePane.filesRef.current[activePane.focusedIndex] : undefined;
  const quickBarFocusedFile = quickBarPane.focusedIndex >= 0 ? quickBarPane.filesRef.current[quickBarPane.focusedIndex] : undefined;
  const activePaneIsArchive = activePane.archiveLocation !== null;
  const archiveExtractionSource = useMemo((): VirtualLocation | null => {
    const location = activePane.currentLocation;
    if (location.kind === "virtual") {
      return activePane.contentCapabilities.extract ? location : null;
    }
    if (activePaneFocusedFile?.type !== "file") {
      return null;
    }
    const providerId = browserContentServices.providers.getVirtualProviderIdForFilename(activePaneFocusedFile.name);
    if (!providerId) {
      return null;
    }
    const source = virtualLocation(
      providerId,
      location.connectionId,
      physicalLocation(location.connectionId, activePaneFocusedFile.path),
      ""
    );
    return browserContentServices.providers.getCapabilities(source).extract ? source : null;
  }, [activePane.contentCapabilities.extract, activePane.currentLocation, activePaneFocusedFile, browserContentServices.providers]);
  const contentOperationEnvironment = useMemo(
    () => ({
      isCompanionPaired: companion.status === "paired",
      storageRegistry: browserContentServices.registry,
      archiveOperations: browserContentServices.archiveOperations,
      history: browserContentServices.history,
    }),
    [browserContentServices.archiveOperations, browserContentServices.history, browserContentServices.registry, companion.status]
  );
  const quickBarPaneWritable = quickBarPane.contentCapabilities.mutate && isConnectionWritable(quickBarPaneConnection);
  const activePaneCanOpenInApp =
    activePane.contentCapabilities.openInNativeApp && activePaneFocusedFile?.type === "file" && canOpenFileInApp(activePaneConnection);
  const quickBarCanOpenInApp =
    quickBarPane.contentCapabilities.openInNativeApp && quickBarFocusedFile?.type === "file" && canOpenFileInApp(quickBarPaneConnection);
  const quickBarSelection = quickBarPane.getEffectiveSelection();
  const quickBarCanCopyToOtherPane =
    isDualMode &&
    quickBarSelection.length > 0 &&
    quickBarSelection.every(
      (item) =>
        getTransferAvailability(
          { kind: "copy", source: item.handle, destination: quickBarOtherPane.currentLocation },
          contentOperationEnvironment
        ).available
    );
  const quickBarCanMoveToOtherPane =
    isDualMode &&
    quickBarSelection.length > 0 &&
    quickBarSelection.every(
      (item) =>
        getTransferAvailability(
          { kind: "move", source: item.handle, destination: quickBarOtherPane.currentLocation },
          contentOperationEnvironment
        ).available
    );
  const inactivePane = effectiveActivePaneId === "left" ? rightPane : leftPane;
  const activePaneCanExtractSelectedMembers =
    isDualMode &&
    activePane.currentLocation.kind === "virtual" &&
    activePane.currentLocation.providerId === "zip" &&
    activePane.contentCapabilities.extract &&
    inactivePane.currentLocation.kind === "physical" &&
    inactivePane.contentCapabilities.mutate &&
    activePane
      .getEffectiveSelection()
      .some((item) => item.handle.kind === "virtual" && item.handle.location.providerId === "zip" && item.entry.is_readable);
  const createContainerDestination = isDualMode
    ? (effectiveActivePaneId === "left" ? rightPane : leftPane).currentLocation
    : activePane.currentLocation;
  const activePaneCanCreateArchive = getCreateContainerAvailability(
    { sources: activePane.getEffectiveSelection().map((item) => item.handle), destination: createContainerDestination },
    contentOperationEnvironment
  ).available;
  const hasVisibleLocalDrivePane =
    Boolean(leftPane.connectionId && isLocalDrive(leftPane.connectionId)) ||
    Boolean(isDualMode && rightPane.connectionId && isLocalDrive(rightPane.connectionId));

  useEffect(() => {
    if ((!isDualMode || !rightPane.connectionId) && quickBarPaneId === "right") {
      setQuickBarPaneId("left");
    }
  }, [isDualMode, quickBarPaneId, rightPane.connectionId]);

  useEffect(() => {
    const refreshQuickBarHistory = () => {
      if ((quickBarMode === "file-search" || quickBarMode === "navigate") && document.activeElement === quickBarInputRef.current) {
        setQuickBarRefreshToken((current) => current + 1);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshQuickBarHistory();
      }
    };
    window.addEventListener(RECENT_FILES_CHANGED_EVENT, refreshQuickBarHistory);
    window.addEventListener(RECENT_DIRECTORIES_CHANGED_EVENT, refreshQuickBarHistory);
    window.addEventListener("focus", refreshQuickBarHistory);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener(RECENT_FILES_CHANGED_EVENT, refreshQuickBarHistory);
      window.removeEventListener(RECENT_DIRECTORIES_CHANGED_EVENT, refreshQuickBarHistory);
      window.removeEventListener("focus", refreshQuickBarHistory);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [quickBarInputRef, quickBarMode]);

  const refreshVisiblePanesAfterRecovery = useCallback(() => {
    if (leftPane.connectionIdRef.current) {
      void leftPane.reloadCurrentLocation({ forceRefresh: true, preserveVisibleContent: true });
    }

    if (paneMode === "dual" && rightPane.connectionIdRef.current) {
      void rightPane.reloadCurrentLocation({ forceRefresh: true, preserveVisibleContent: true });
    }
  }, [leftPane, paneMode, rightPane]);

  const previousBackendStatusRef = React.useRef(backendAvailability.status);

  useEffect(() => {
    const previousStatus = previousBackendStatusRef.current;
    previousBackendStatusRef.current = backendAvailability.status;

    if (backendAvailability.status !== "available") {
      return;
    }

    if (previousStatus === "available") {
      return;
    }

    refreshVisiblePanesAfterRecovery();
  }, [backendAvailability.status, refreshVisiblePanesAfterRecovery]);

  useEffect(() => {
    return subscribeBackendRecoveryReconnect(({ reason }) => {
      triggerServerReconnectRef.current(reason);
    });
  }, []);

  useEffect(() => {
    return subscribeBackendRecoveryConfirmed(() => {
      refreshVisiblePanesAfterRecovery();
    });
  }, [refreshVisiblePanesAfterRecovery]);

  const restoreInitialRecoverySnapshot = useCallback(() => {
    const snapshot = initialRecoverySnapshotRef.current;
    if (!snapshot || hasHydratedRecoverySnapshotRef.current) {
      return;
    }

    hasHydratedRecoverySnapshotRef.current = true;

    leftPane.restoreRecoverySnapshot(snapshot.left);
    rightPane.restoreRecoverySnapshot(snapshot.right);

    if (!snapshot.right) {
      rightPane.applyLocation("", "");
    }

    if (paneMode !== snapshot.paneMode) {
      setPaneMode(snapshot.paneMode);
    }

    if (activePaneId !== snapshot.activePaneId) {
      setActivePaneId(snapshot.activePaneId);
    }

    setFileBrowserPaneModePreference(snapshot.paneMode, true);
    localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, snapshot.activePaneId);

    const currentUrl = location.pathname + location.search;
    if (currentUrl !== snapshot.routeUrl) {
      navigate(snapshot.routeUrl, { replace: true });
    }
  }, [activePaneId, leftPane, location.pathname, location.search, navigate, paneMode, rightPane]);

  useEffect(() => {
    restoreInitialRecoverySnapshot();
  }, [restoreInitialRecoverySnapshot]);

  useEffect(() => {
    const leftSnapshot = leftPane.captureRecoverySnapshot();
    if (!leftSnapshot || leftPane.loading || leftPane.error) {
      return;
    }

    const leftTarget = buildBrowseRouteTarget(
      leftSnapshot.connectionId,
      leftSnapshot.path,
      allConnections,
      toVirtualRouteLocation(leftSnapshot.archiveLocation ?? null)
    );
    if (!leftTarget) {
      return;
    }

    const rightSnapshot = paneMode === "dual" && !rightPane.loading && !rightPane.error ? rightPane.captureRecoverySnapshot() : null;
    const rightTarget =
      rightSnapshot === null
        ? null
        : buildBrowseRouteTarget(
            rightSnapshot.connectionId,
            rightSnapshot.path,
            allConnections,
            toVirtualRouteLocation(rightSnapshot.archiveLocation ?? null)
          );

    saveBrowserRecoverySnapshot({
      savedAt: Date.now(),
      routeUrl: serializeBrowseRoute({
        left: leftTarget,
        right: rightTarget,
        activePaneId: rightTarget ? activePaneId : "left",
      }),
      activePaneId: rightTarget ? activePaneId : "left",
      paneMode: rightTarget ? "dual" : "single",
      connections,
      left: leftSnapshot,
      right: rightSnapshot,
    });
  }, [
    activePaneId,
    allConnections,
    connections,
    leftPane.error,
    leftPane.loading,
    paneMode,
    rightPane.error,
    rightPane.loading,
    leftPane,
    rightPane,
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // API & Data Loading (Global)
  // ──────────────────────────────────────────────────────────────────────────

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
    return buildBrowseRouteTarget(
      leftPane.connectionIdRef.current,
      leftPane.currentPathRef.current,
      allConnections,
      toVirtualRouteLocation(leftPane.archiveLocation)
    );
  }, [allConnections, leftPane]);

  const getCurrentRightTarget = useCallback(() => {
    if (paneMode !== "dual") {
      return null;
    }

    return buildBrowseRouteTarget(
      rightPane.connectionIdRef.current,
      rightPane.currentPathRef.current,
      allConnections,
      toVirtualRouteLocation(rightPane.archiveLocation)
    );
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

  const navigateLeftVirtualLocation = useCallback(
    (virtualLocation: VirtualRouteLocation | null) => {
      const leftTarget = buildBrowseRouteTarget(
        leftPane.connectionIdRef.current,
        leftPane.currentPathRef.current,
        allConnections,
        virtualLocation
      );
      if (!leftTarget) {
        return;
      }

      const rightTarget = getCurrentRightTarget();
      navigateToBrowseState({ left: leftTarget, right: rightTarget, activePaneId: "left" });
    },
    [allConnections, getCurrentRightTarget, leftPane, navigateToBrowseState]
  );

  const navigateRightVirtualLocation = useCallback(
    (virtualLocation: VirtualRouteLocation | null) => {
      const leftTarget = getCurrentLeftTarget();
      const rightTarget = buildBrowseRouteTarget(
        rightPane.connectionIdRef.current,
        rightPane.currentPathRef.current,
        allConnections,
        virtualLocation
      );
      if (!leftTarget || !rightTarget) {
        return;
      }

      navigateToBrowseState({ left: leftTarget, right: rightTarget, activePaneId: "right" });
    },
    [allConnections, getCurrentLeftTarget, navigateToBrowseState, rightPane]
  );

  const resolveLeftRouteLocation = useCallback(
    (path: string, archiveLocation: ArchiveLocation | null) => {
      const leftTarget = buildBrowseRouteTarget(
        leftPane.connectionIdRef.current,
        path,
        allConnections,
        toVirtualRouteLocation(archiveLocation)
      );
      if (!leftTarget) {
        return;
      }

      navigateToBrowseState({ left: leftTarget, right: getCurrentRightTarget(), activePaneId }, { replace: true });
    },
    [activePaneId, allConnections, getCurrentRightTarget, leftPane, navigateToBrowseState]
  );

  const resolveRightRouteLocation = useCallback(
    (path: string, archiveLocation: ArchiveLocation | null) => {
      const leftTarget = getCurrentLeftTarget();
      const rightTarget = buildBrowseRouteTarget(
        rightPane.connectionIdRef.current,
        path,
        allConnections,
        toVirtualRouteLocation(archiveLocation)
      );
      if (!leftTarget || !rightTarget) {
        return;
      }

      navigateToBrowseState({ left: leftTarget, right: rightTarget, activePaneId }, { replace: true });
    },
    [activePaneId, allConnections, getCurrentLeftTarget, navigateToBrowseState, rightPane]
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

  leftDirectoryNavigateRef.current = (connectionId, path) => {
    navigateLeftPane(connectionId, path, { activePaneId: "left" });
  };

  rightDirectoryNavigateRef.current = (connectionId, path) => {
    navigateRightPane(connectionId, path, { activePaneId: "right" });
  };

  leftVirtualLocationNavigateRef.current = navigateLeftVirtualLocation;
  rightVirtualLocationNavigateRef.current = navigateRightVirtualLocation;
  leftRouteLocationResolveRef.current = resolveLeftRouteLocation;
  rightRouteLocationResolveRef.current = resolveRightRouteLocation;

  const leftApplyLocation = leftPane.applyLocation;
  const rightApplyLocation = rightPane.applyLocation;
  const leftListContainerEl = leftPane.listContainerEl;
  const rightListContainerEl = rightPane.listContainerEl;

  const seedRightPaneFromLeftIfSameDirectory = useCallback(() => {
    const leftConnectionId = leftPane.connectionIdRef.current;
    const leftPath = leftPane.currentPathRef.current;

    if (!leftConnectionId || leftPane.loading || leftPane.error) {
      return;
    }

    rightPane.seedDirectorySnapshot(leftConnectionId, leftPath, leftPane.files);
  }, [leftPane.connectionIdRef, leftPane.currentPathRef, leftPane.error, leftPane.files, leftPane.loading, rightPane]);

  const reconcileBootstrapRoute = useCallback(
    (loadedConnections: Connection[], persistedSelectedConnectionId: string | null) => {
      if ((params.targetType || params.targetId) && !currentRoute.left) {
        navigate("/browse", { replace: true });
        return;
      }

      if (currentRoute.left?.kind === "smb" && !loadedConnections.some((connection) => connection.slug === currentRoute.left?.targetId)) {
        navigate("/browse", { replace: true });
        return;
      }

      if (currentRoute.right?.kind === "smb" && !loadedConnections.some((connection) => connection.slug === currentRoute.right?.targetId)) {
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
        savedConnectionId &&
        (isLocalDrive(savedConnectionId) || loadedConnections.some((connection) => connection.id === savedConnectionId))
          ? savedConnectionId
          : loadedConnections[0]?.id;

      if (autoSelectedConnectionId) {
        navigateToBrowseState(
          {
            left: buildBrowseRouteTarget(autoSelectedConnectionId, "", mergeConnections(loadedConnections, companion.drives)),
            right: null,
            activePaneId: "left",
          },
          { replace: true }
        );
      }
    },
    [companion.drives, currentRoute.left, currentRoute.right, navigate, navigateToBrowseState, params.targetId, params.targetType]
  );

  /**
   * loadConnections
   *
   * `bootstrap` is allowed to change route/loading UI for a cold start.
   * `background-revalidate` refreshes connection metadata without disturbing the current browser UI.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: setConnectionId and setError are stable React state setters from the pane hook
  const loadConnections = useCallback(
    async (mode: "bootstrap" | "background-revalidate") => {
      const preserveVisibleUi = mode === "background-revalidate";

      try {
        if (!preserveVisibleUi) {
          setLoadingConnections(true);
        }

        const token = authSession.getAccessToken();
        if (!token) {
          const { isAuthRequired } = await import("../services/authConfig");
          const authRequired = await isAuthRequired();
          if (authRequired) {
            if (!preserveVisibleUi) {
              navigate(loginPath(window.location.pathname + window.location.search));
            }
            return;
          }
        }

        await logger.initializeBackendTracing();

        const currentUserSettings = await loadCurrentUserSettings(true);
        const persistedSelectedConnectionId = currentUserSettings?.browser.selected_connection_id ?? null;
        if (persistedSelectedConnectionId !== null) {
          setSelectedConnectionIdPreference(persistedSelectedConnectionId, false);
        }

        const data = await browserContentServices.connections.getConnections();
        setConnections(data);

        if (preserveVisibleUi) {
          return;
        }

        reconcileBootstrapRoute(data, persistedSelectedConnectionId);
      } catch (err: unknown) {
        logger.error("Error loading connections", { error: err }, "browser");
        if (isApiError(err)) {
          if (err.response?.status === 401) {
            if (!preserveVisibleUi) {
              navigate(loginPath(window.location.pathname + window.location.search));
            }
          } else if (err.response?.status === 403) {
            leftPane.setError("Access denied. Please contact an administrator to configure connections.");
          } else {
            leftPane.setError("Failed to load connections. Please try again.");
          }
        } else {
          leftPane.setError("Failed to load connections. Please try again.");
        }
      } finally {
        if (!preserveVisibleUi) {
          setLoadingConnections(false);
        }
      }
    },
    [navigate, reconcileBootstrapRoute]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Component Lifecycle Effects
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    scheduleRuntimeWarmup();
  }, []);

  // Initial load - run once on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only once on mount to avoid aborting requests
  useEffect(() => {
    const initialLoadMode = initialRecoverySnapshotRef.current !== null ? "background-revalidate" : "bootstrap";
    void loadConnections(initialLoadMode);
  }, []);

  useEffect(() => {
    if (loadingConnections) {
      return;
    }

    const routeSyncToken = routeSyncTokenRef.current + 1;
    routeSyncTokenRef.current = routeSyncToken;

    leftApplyLocation(resolvedRoute.left?.connectionId ?? "", resolvedRoute.left?.path ?? "", routeSyncToken);
    rightApplyLocation(resolvedRoute.right?.connectionId ?? "", resolvedRoute.right?.path ?? "", routeSyncToken);

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

    if (pendingPaneFocusRef.current !== nextActivePaneId) {
      pendingPaneFocusRef.current = null;
    }
  }, [activePaneId, leftApplyLocation, loadingConnections, paneMode, resolvedRoute, rightApplyLocation]);

  useEffect(() => {
    if (pendingPaneFocusRef.current !== activePaneId) {
      return;
    }

    window.setTimeout(() => {
      if (activePaneId === "right") {
        rightListContainerEl?.focus();
      } else {
        leftListContainerEl?.focus();
      }

      pendingPaneFocusRef.current = null;
    }, 0);
  }, [activePaneId, leftListContainerEl, rightListContainerEl]);

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket Real-Time Updates
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * WebSocket connection for real-time directory change notifications.
   * Features:
   * - Automatic reconnection with an adaptive backoff ladder on disconnect
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
    let suppressCloseReconnect = false;

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const scheduleReconnect = (reason: string, immediate = false) => {
      if (disposed) {
        return;
      }

      clearReconnectTimer();
      const delayMs = immediate
        ? 0
        : SERVER_WEBSOCKET_RECONNECT_DELAYS_MS[
            Math.min(serverReconnectAttemptRef.current, SERVER_WEBSOCKET_RECONNECT_DELAYS_MS.length - 1)
          ];

      if (!immediate) {
        serverReconnectAttemptRef.current += 1;
      }

      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectWebSocket(reason);
      }, delayMs);
    };

    const connectWebSocket = (reason = "initial") => {
      if (disposed) return;

      clearReconnectTimer();

      const accessToken = authSession.getAccessToken();
      const wsUrl = buildServerWebSocketUrl(window.location, accessToken);
      const wsLogUrl = getSafeWebSocketLogUrl(wsUrl);

      logger.info("Connecting to WebSocket", { wsUrl: wsLogUrl, reason }, "websocket");
      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        serverReconnectAttemptRef.current = 0;
        markBackendAvailable();
        logger.info("WebSocket connected", { wsUrl: wsLogUrl }, "websocket");
        wsRef.current = ws;
        setServerDirectoryWs(ws);
      };

      ws.onmessage = (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message) {
          logger.warn("Ignoring malformed WebSocket message", undefined, "websocket");
          return;
        }
        if (message.type === "directory_changed") {
          // Dispatch to both panes — each pane checks if it's viewing the affected directory
          leftPane.handleDirectoryChanged(message.change);
          rightPane.handleDirectoryChanged(message.change);
        } else if (message.type === "transfer_progress") {
          // Byte-level progress for cross-connection copy/move
          if (message.bytesTransferred === -1) {
            // Sentinel: transfer complete — clear byte progress
            setCopyMoveTransferProgress(null);
          } else {
            setCopyMoveTransferProgress({
              bytesTransferred: message.bytesTransferred,
              totalBytes: message.totalBytes,
              itemName: message.itemName,
            });
          }
        }
      };

      ws.onerror = (error) => {
        if (disposed || activeWs !== ws) {
          return;
        }
        logger.error("WebSocket error", { wsUrl: wsLogUrl, error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        if (disposed) {
          if (activeWs === ws) {
            activeWs = null;
          }
          wsRef.current = null;
          serverAppliedSubscriptionsRef.current = new Map();
          setServerDirectoryWs((current) => (current === ws ? null : current));
          return;
        }

        if (suppressCloseReconnect) {
          suppressCloseReconnect = false;
          if (activeWs === ws) {
            activeWs = null;
          }
          wsRef.current = null;
          serverAppliedSubscriptionsRef.current = new Map();
          setServerDirectoryWs((current) => (current === ws ? null : current));
          return;
        }

        logger.warn("WebSocket disconnected", { wsUrl: wsLogUrl, willReconnect: !disposed }, "websocket");
        if (activeWs === ws) {
          activeWs = null;
        }
        wsRef.current = null;
        serverAppliedSubscriptionsRef.current = new Map();
        setServerDirectoryWs((current) => (current === ws ? null : current));

        if (!disposed) {
          scheduleReconnect("socket-close");
        }
      };
    };

    triggerServerReconnectRef.current = (reason: string) => {
      if (disposed) {
        return;
      }

      serverReconnectAttemptRef.current = 0;
      clearReconnectTimer();

      if (activeWs) {
        suppressCloseReconnect = true;
        activeWs.close();
        activeWs = null;
        wsRef.current = null;
        serverAppliedSubscriptionsRef.current = new Map();
        setServerDirectoryWs(null);
      }

      scheduleReconnect(reason, true);
    };

    scheduleReconnect("initial", true);

    return () => {
      disposed = true;
      clearReconnectTimer();
      // Close the locally-tracked socket — works even if onopen hasn't fired yet
      if (activeWs) {
        activeWs.close();
        activeWs = null;
      }
      wsRef.current = null;
      serverAppliedSubscriptionsRef.current = new Map();
      setServerDirectoryWs(null);
      triggerServerReconnectRef.current = () => undefined;
    };
  }, []);

  /**
   * Companion WebSocket for real-time local drive change notifications.
   *
   * Only connects when the companion is paired. Uses HMAC query-param auth
   * since the browser WebSocket API does not support custom headers.
   * Reconnects independently from the server WebSocket.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleDirectoryChanged refs are stable; companion/local pane state drives connect/disconnect.
  useEffect(() => {
    if (companion.status !== "paired" || !hasVisibleLocalDrivePane) return;

    let disposed = false;
    let activeWs: WebSocket | null = null;
    let connectTimeoutId: number | null = null;

    const clearConnectTimeout = () => {
      if (connectTimeoutId !== null) {
        window.clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || companionReconnectRef.current !== null) {
        return;
      }

      companionReconnectRef.current = window.setTimeout(() => {
        companionReconnectRef.current = null;
        void connectCompanionWs();
      }, COMPANION_WEBSOCKET_RECONNECT_DELAY_MS);
    };

    const connectCompanionWs = async () => {
      if (disposed) return;

      const wsUrl = await browserContentServices.connections.getCompanionWebSocketUrl();
      if (!wsUrl || disposed) return;

      logger.info("Connecting to companion WebSocket", { wsUrl: getSafeWebSocketLogUrl(wsUrl) }, "websocket");
      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      const connectStartedAt = Date.now();
      clearConnectTimeout();
      connectTimeoutId = window.setTimeout(() => {
        if (disposed || activeWs !== ws || ws.readyState !== WebSocket.CONNECTING) {
          return;
        }

        logger.warn(
          "Companion WebSocket connection attempt timed out; closing stale socket before auth expires",
          {
            elapsedMs: Date.now() - connectStartedAt,
            timeoutMs: COMPANION_WEBSOCKET_CONNECT_TIMEOUT_MS,
          },
          "websocket"
        );
        ws.close();
      }, COMPANION_WEBSOCKET_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearConnectTimeout();
        if (disposed) {
          ws.close();
          return;
        }
        logger.info("Companion WebSocket connected", {}, "websocket");
        companionWsRef.current = ws;
        setCompanionDirectoryWs(ws);
      };

      ws.onmessage = (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message) {
          logger.warn("Ignoring malformed companion WebSocket message", undefined, "websocket");
          return;
        }
        if (message.type === "directory_changed") {
          leftPane.handleDirectoryChanged(message.change);
          rightPane.handleDirectoryChanged(message.change);
        }
      };

      ws.onerror = (error) => {
        logger.error("Companion WebSocket error", { error: String(error) }, "websocket");
      };

      ws.onclose = () => {
        clearConnectTimeout();
        if (disposed) {
          if (activeWs === ws) {
            activeWs = null;
          }
          companionWsRef.current = null;
          companionAppliedSubscriptionsRef.current = new Map();
          setCompanionDirectoryWs((current) => (current === ws ? null : current));
          return;
        }

        logger.warn("Companion WebSocket disconnected", { willReconnect: !disposed }, "websocket");
        if (activeWs === ws) {
          activeWs = null;
        }
        companionWsRef.current = null;
        companionAppliedSubscriptionsRef.current = new Map();
        setCompanionDirectoryWs((current) => (current === ws ? null : current));

        scheduleReconnect();
      };
    };

    void connectCompanionWs();

    return () => {
      disposed = true;
      clearConnectTimeout();
      if (companionReconnectRef.current) {
        clearTimeout(companionReconnectRef.current);
        companionReconnectRef.current = null;
      }
      if (activeWs) {
        activeWs.close();
        activeWs = null;
      }
      companionWsRef.current = null;
      companionAppliedSubscriptionsRef.current = new Map();
      setCompanionDirectoryWs(null);
    };
  }, [companion.status, hasVisibleLocalDrivePane]);

  useEffect(() => {
    if (!serverDirectoryWs) {
      serverAppliedSubscriptionsRef.current = new Map();
      return;
    }

    return () => {
      if (serverDirectoryWs.readyState === WebSocket.OPEN) {
        for (const sub of serverAppliedSubscriptionsRef.current.values()) {
          serverDirectoryWs.send(JSON.stringify({ action: "unsubscribe", connection_id: sub.connectionId, path: sub.path }));
        }
      }

      serverAppliedSubscriptionsRef.current = new Map();
    };
  }, [serverDirectoryWs]);

  // Subscribe/unsubscribe server-backed pane directories when the server
  // websocket changes or visible SMB targets change.
  useEffect(() => {
    if (serverDirectoryWs?.readyState !== WebSocket.OPEN) {
      return;
    }

    const desiredSubscriptions = collectDirectorySubscriptions({
      left: { connectionId: leftPane.connectionId, path: leftPane.currentPath },
      right: { connectionId: rightPane.connectionId, path: rightPane.currentPath },
      isDualMode,
      includeLocalDrives: false,
    });
    const nextSubscriptions = createDirectorySubscriptionMap(desiredSubscriptions);
    const { removedSubscriptions, addedSubscriptions } = diffDirectorySubscriptions(
      serverAppliedSubscriptionsRef.current,
      nextSubscriptions
    );

    for (const sub of removedSubscriptions) {
      serverDirectoryWs.send(JSON.stringify({ action: "unsubscribe", connection_id: sub.connectionId, path: sub.path }));
    }

    for (const sub of addedSubscriptions) {
      serverDirectoryWs.send(JSON.stringify({ action: "subscribe", connection_id: sub.connectionId, path: sub.path }));
    }

    serverAppliedSubscriptionsRef.current = nextSubscriptions;
  }, [leftPane.connectionId, leftPane.currentPath, rightPane.connectionId, rightPane.currentPath, isDualMode, serverDirectoryWs]);

  useEffect(() => {
    if (!companionDirectoryWs) {
      companionAppliedSubscriptionsRef.current = new Map();
      return;
    }

    return () => {
      if (companionDirectoryWs.readyState === WebSocket.OPEN) {
        for (const sub of companionAppliedSubscriptionsRef.current.values()) {
          companionDirectoryWs.send(JSON.stringify({ action: "unsubscribe", connection_id: sub.connectionId, path: sub.path }));
        }
      }

      companionAppliedSubscriptionsRef.current = new Map();
    };
  }, [companionDirectoryWs]);

  // Subscribe/unsubscribe local-drive pane directories when the companion
  // websocket changes or visible local targets change.
  useEffect(() => {
    if (companionDirectoryWs?.readyState !== WebSocket.OPEN) {
      return;
    }

    const desiredSubscriptions = collectDirectorySubscriptions({
      left: { connectionId: leftPane.connectionId, path: leftPane.currentPath },
      right: { connectionId: rightPane.connectionId, path: rightPane.currentPath },
      isDualMode,
      includeLocalDrives: true,
    });
    const nextSubscriptions = createDirectorySubscriptionMap(desiredSubscriptions);
    const { removedSubscriptions, addedSubscriptions } = diffDirectorySubscriptions(
      companionAppliedSubscriptionsRef.current,
      nextSubscriptions
    );

    for (const sub of removedSubscriptions) {
      companionDirectoryWs.send(JSON.stringify({ action: "unsubscribe", connection_id: sub.connectionId, path: sub.path }));
    }

    for (const sub of addedSubscriptions) {
      companionDirectoryWs.send(JSON.stringify({ action: "subscribe", connection_id: sub.connectionId, path: sub.path }));
    }

    companionAppliedSubscriptionsRef.current = nextSubscriptions;
  }, [leftPane.connectionId, leftPane.currentPath, rightPane.connectionId, rightPane.currentPath, isDualMode, companionDirectoryWs]);

  // ──────────────────────────────────────────────────────────────────────────
  // Dual-Pane Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /** Toggle between single and dual-pane mode. */
  const handleToggleDualPane = useCallback(() => {
    const leftTarget = getCurrentLeftTarget();
    if (!leftTarget) {
      return;
    }

    if (!resolvedRoute.right) {
      seedRightPaneFromLeftIfSameDirectory();
      pendingPaneFocusRef.current = "right";
      navigateToBrowseState({
        left: leftTarget,
        right: buildBrowseRouteTarget(
          leftPane.connectionIdRef.current,
          leftPane.currentPathRef.current,
          allConnections,
          toVirtualRouteLocation(leftPane.archiveLocation)
        ),
        activePaneId: "right",
      });
    } else {
      pendingPaneFocusRef.current = "left";
      navigateToBrowseState({
        left: leftTarget,
        right: null,
        activePaneId: "left",
      });
    }
  }, [allConnections, getCurrentLeftTarget, leftPane, navigateToBrowseState, resolvedRoute.right, seedRightPaneFromLeftIfSameDirectory]);

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
      seedRightPaneFromLeftIfSameDirectory();
      navigateToBrowseState({
        left: leftTarget,
        right: buildBrowseRouteTarget(
          leftPane.connectionIdRef.current,
          leftPane.currentPathRef.current,
          allConnections,
          toVirtualRouteLocation(leftPane.archiveLocation)
        ),
        activePaneId: "right",
      });
    } else {
      replaceActivePaneInRoute("right");
    }
    setTimeout(() => rightPane.listContainerEl?.focus(), 0);
  }, [
    allConnections,
    getCurrentLeftTarget,
    leftPane,
    navigateToBrowseState,
    paneMode,
    replaceActivePaneInRoute,
    rightPane,
    seedRightPaneFromLeftIfSameDirectory,
  ]);

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
      const destinationPane = sourcePaneId === "left" ? rightPane : leftPane;
      const items = sourcePane.getEffectiveSelection();
      const destination = destinationPane.currentLocation;
      if (
        items.length === 0 ||
        !items.every(
          (item) => getTransferAvailability({ kind: mode, source: item.handle, destination }, contentOperationEnvironment).available
        )
      ) {
        return;
      }

      setCopyMoveMode(mode);
      setCopyMoveItems(items);
      setCopyMoveSourcePaneId(sourcePaneId);
      setCopyMoveDestination(destination);
      setCopyMoveDestinationLabel(
        getLocationDisplayName(destination, (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId)
      );
      setCopyMoveSameDirectory(areSameContentLocations(sourcePane.currentLocation, destination));
      setCopyMoveDestinationPaneId(sourcePaneId === "left" ? "right" : "left");
      setCopyMoveError(null);
      setCopyMoveWarning(null);
      setCopyMoveProgress(undefined);
      setCopyMoveTransferProgress(null);
      setCopyMoveProcessing(false);
      setCopyMoveDialogOpen(true);
    },
    [allConnections, contentOperationEnvironment, isDualMode, leftPane, rightPane]
  );

  /** Open the move dialog (F6). */
  const handleMoveToOtherPane = useCallback(() => handleOpenCopyMoveDialog("move"), [handleOpenCopyMoveDialog]);

  /**
   * Execute the copy/move operation for all selected files sequentially.
   * Shows progress per file. Both panes refresh via WebSocket after completion.
   */
  const handleCopyMoveConfirm = useCallback(
    async (destFileName: string | undefined) => {
      if (copyMoveItems.length === 0 || !copyMoveDestination) return;

      setCopyMoveProcessing(true);
      setCopyMoveError(null);
      setCopyMoveWarning(null);
      setCopyMoveTransferProgress(null);
      setCopyMoveProgress({ current: 0, total: copyMoveItems.length });
      const abortController = new AbortController();
      copyMoveAbortControllerRef.current = abortController;
      const errors: string[] = [];
      const warnings: string[] = [];
      let effectiveStrategy: CopyMoveConflictPolicy = "ask";
      let conflictCount = 0;
      let operationCancelled = false;
      let outcomeUnknown = false;

      for (let index = 0; index < copyMoveItems.length; index += 1) {
        const item = copyMoveItems[index]!;
        const request = {
          kind: copyMoveMode,
          source: item.handle,
          destination: copyMoveDestination,
          targetName: destFileName,
          signal: abortController.signal,
          onProgress: (bytesTransferred: number, totalBytes: number | null) =>
            setCopyMoveTransferProgress({ bytesTransferred, totalBytes, itemName: item.entry.name }),
        } as const;
        let targetName = destFileName;
        const execute = (targetResolutionPolicy: TargetResolutionPolicy = "ask") =>
          executeTransfer({ ...request, targetName, targetResolutionPolicy }, contentOperationEnvironment);
        const applyTransferResult = (result: import("./services/storageContracts").ContentTransferResult) => {
          if (result.status === "completed" || result.status === "skipped") return;
          if (result.status === "completed_with_source_retained") {
            warnings.push(`${item.entry.name}: ${result.error.detail}`);
            return;
          }
          if (result.status === "outcome_unknown") {
            outcomeUnknown = true;
            throw new Error("The transfer outcome is unknown. Both locations were refreshed.");
          }
          if (result.status === "failed") {
            throw new Error(`Content transfer failed: ${result.error.code}`);
          }
          throw new Error("Content transfer was cancelled");
        };
        setCopyMoveProgress({ current: index + 1, total: copyMoveItems.length });

        try {
          applyTransferResult(await execute());
        } catch (error) {
          if (outcomeUnknown) {
            errors.push("The transfer outcome is unknown. Both locations were refreshed.");
            break;
          }
          if (abortController.signal.aborted) {
            operationCancelled = true;
            break;
          }
          if (isApiError(error) && error.response?.status === 409) {
            const detail = error.response?.data?.detail;
            let conflict = typeof detail === "object" && detail !== null ? (detail as ConflictInfo) : null;
            if (conflict && effectiveStrategy === "ask") {
              let resolutionHandled = false;
              while (conflict) {
                conflictCount += 1;
                setConflictInfo(conflict);
                setConflictProgress({ current: index + 1, total: copyMoveItems.length, conflictsSoFar: conflictCount });
                const decision = await new Promise<ConflictDecision | null>((resolve) => {
                  conflictResolveRef.current = resolve;
                  setConflictDialogOpen(true);
                });
                setConflictDialogOpen(false);
                if (!decision) {
                  operationCancelled = true;
                  break;
                }
                if (decision.applyToAll && decision.resolution === "skip") {
                  effectiveStrategy = "skip-all";
                }
                if (decision.resolution === "skip") {
                  resolutionHandled = true;
                  break;
                }
                if (decision.resolution === "rename") {
                  if (!decision.targetName) {
                    errors.push(`A target name is required to ${copyMoveMode} ${item.entry.name}`);
                    logger.error(`${copyMoveMode} rename decision was missing a target name`, { file: item.entry.name }, "browser");
                    resolutionHandled = true;
                    break;
                  }
                  targetName = decision.targetName;
                }
                try {
                  applyTransferResult(await execute(targetResolutionPolicyForConflictResolution(decision.resolution)));
                } catch (retryError) {
                  const retryDetail = isApiError(retryError) ? retryError.response?.data?.detail : null;
                  const retryConflict = typeof retryDetail === "object" && retryDetail !== null ? (retryDetail as ConflictInfo) : null;
                  if (decision.resolution === "rename" && isApiError(retryError) && retryError.response?.status === 409 && retryConflict) {
                    conflict = retryConflict;
                    continue;
                  }
                  const message =
                    (isApiError(retryError) ? retryError.message : undefined) ?? `Failed to ${copyMoveMode} ${item.entry.name}`;
                  errors.push(message);
                  logger.error(`${copyMoveMode} resolution retry failed`, { file: item.entry.name, error: retryError }, "browser");
                }
                resolutionHandled = true;
                break;
              }
              if (operationCancelled || outcomeUnknown) {
                break;
              }
              if (resolutionHandled) {
                continue;
              }
            }

            if (effectiveStrategy === "skip-all") {
              continue;
            }
          }

          const message = (isApiError(error) ? error.message : undefined) ?? `Failed to ${copyMoveMode} ${item.entry.name}`;
          errors.push(message);
          logger.error(`${copyMoveMode} failed`, { file: item.entry.name, error }, "browser");
        }
        if (outcomeUnknown) {
          break;
        }
      }

      setCopyMoveProcessing(false);
      setCopyMoveTransferProgress(null);
      if (copyMoveAbortControllerRef.current === abortController) {
        copyMoveAbortControllerRef.current = null;
      }
      const sourcePane = copyMoveSourcePaneId === "left" ? leftPane : rightPane;
      const destinationPane = copyMoveDestinationPaneId === "left" ? leftPane : rightPane;
      void destinationPane.reloadCurrentLocation({ forceRefresh: true });
      void sourcePane.reloadCurrentLocation({ forceRefresh: true });
      if (operationCancelled) {
        setCopyMoveError(`${copyMoveMode === "copy" ? "Copy" : "Move"} cancelled.`);
        if (warnings.length > 0) {
          setCopyMoveWarning(warnings.join("; "));
        }
        setConflictInfo(null);
        return;
      }

      if (errors.length > 0) {
        setCopyMoveError(errors.join("; "));
      }
      if (warnings.length > 0) {
        setCopyMoveWarning(warnings.join("; "));
      }
      if (errors.length === 0 && warnings.length === 0) {
        setCopyMoveDialogOpen(false);
        sourcePane.handleClearSelection();
      }
    },
    [
      contentOperationEnvironment,
      copyMoveDestination,
      copyMoveDestinationPaneId,
      copyMoveItems,
      copyMoveMode,
      copyMoveSourcePaneId,
      leftPane,
      rightPane,
    ]
  );

  /** Called when the user resolves an overwrite conflict dialog. */
  const handleConflictResolve = useCallback((decision: ConflictDecision) => {
    conflictResolveRef.current?.(decision);
    conflictResolveRef.current = null;
  }, []);

  const handleConflictCancel = useCallback(() => {
    conflictResolveRef.current?.(null);
    conflictResolveRef.current = null;
  }, []);

  /** Cancel the copy/move dialog. */
  const handleCopyMoveCancel = useCallback(() => {
    if (copyMoveProcessing) {
      copyMoveAbortControllerRef.current?.abort();
    } else {
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

  const handleOpenDocumentation = useCallback(() => {
    openExternalUrl("https://sambee.net/docs/");
  }, []);

  const openConnectionsSettings = useCallback(() => {
    if (useCompactLayout) {
      setMobileSettingsInitialView("connections");
      setMobileSettingsOpen(true);
      return;
    }

    setSettingsInitialCategory("connections");
    setSettingsOpen(true);
  }, [useCompactLayout]);

  const focusQuickBarInput = useCallback(
    (sourcePaneId: PaneId) => {
      setTimeout(() => {
        const sourcePane = sourcePaneId === "right" && isDualMode ? rightPane : leftPane;
        sourcePane.searchInputRef.current?.focus();
        sourcePane.searchInputRef.current?.select();
      }, 0);
    },
    [isDualMode, leftPane, rightPane]
  );

  const openQuickBarMode = useCallback(
    (mode: "navigate" | "commands" | "file-search") => {
      const sourcePaneId = effectiveActivePaneIdRef.current;
      setQuickBarPaneId(sourcePaneId);
      setQuickBarMode(mode);
      setQuickBarActivationToken((current) => current + 1);
      focusQuickBarInput(sourcePaneId);
    },
    [focusQuickBarInput]
  );

  const switchQuickBarMode = useCallback(
    (mode: "navigate" | "commands" | "file-search") => {
      const sourcePaneId = quickBarPaneId === "right" && isDualMode ? "right" : "left";
      setQuickBarPaneId(sourcePaneId);
      setQuickBarMode(mode);
      setQuickBarActivationToken((current) => current + 1);
      focusQuickBarInput(sourcePaneId);
    },
    [focusQuickBarInput, isDualMode, quickBarPaneId]
  );

  const handleCreateArchiveRequest = useCallback(() => {
    const sources = activePane.getEffectiveSelection().map((item) => item.handle);
    const destinationPaneId: PaneId = isDualMode ? (effectiveActivePaneId === "left" ? "right" : "left") : effectiveActivePaneId;
    const destinationPane = destinationPaneId === "right" ? rightPane : leftPane;
    const destination = destinationPane.currentLocation;
    if (!getCreateContainerAvailability({ sources, destination }, contentOperationEnvironment).available) {
      return;
    }
    setArchiveCreateError(null);
    setArchiveCreateContext({
      sources,
      destination,
      destinationLabel: getLocationDisplayName(
        destination,
        (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId
      ),
      destinationPaneId,
    });
  }, [activePane, allConnections, contentOperationEnvironment, effectiveActivePaneId, isDualMode, leftPane, rightPane]);

  const handleCreateArchiveConfirm = useCallback(
    async (archiveName: string) => {
      if (!archiveCreateContext) {
        return;
      }
      const execution = startCreateContainer(
        { sources: archiveCreateContext.sources, destination: archiveCreateContext.destination, name: archiveName },
        contentOperationEnvironment
      );
      archiveCreationExecutionRef.current = execution;
      setIsCreatingArchive(true);
      setArchiveCreateError(null);
      try {
        await execution.result;
        setArchiveCreateContext(null);
        (archiveCreateContext.destinationPaneId === "right" ? rightPane : leftPane).handleRefresh();
      } catch (error: unknown) {
        const hasPartialArchiveOutput = isPartialContainerOutputError(error);
        if (execution.isCancellationRequested()) {
          setArchiveCreateContext(null);
          return;
        }
        const detail = hasPartialArchiveOutput
          ? t("fileBrowser.archive.createPartialOutputError")
          : isApiError(error) && typeof error.response?.data?.detail === "string"
            ? error.response.data.detail
            : t("fileBrowser.archive.errorGeneric");
        setArchiveCreateError(detail);
        if (hasPartialArchiveOutput) {
          (archiveCreateContext.destinationPaneId === "right" ? rightPane : leftPane).handleRefresh();
        }
        logger.error("Archive creation failed", { error, archiveName, destination: archiveCreateContext.destinationLabel }, "file-browser");
      } finally {
        archiveCreationExecutionRef.current = null;
        setIsCancellingArchiveCreation(false);
        setIsCreatingArchive(false);
      }
    },
    [archiveCreateContext, contentOperationEnvironment, leftPane, rightPane, t]
  );

  const cancelArchiveCreation = useCallback(async () => {
    const execution = archiveCreationExecutionRef.current;
    if (!execution) {
      return;
    }
    setIsCancellingArchiveCreation(true);
    try {
      await execution.cancel();
    } catch {
      setIsCancellingArchiveCreation(false);
      setArchiveCreateError(t("fileBrowser.archive.errorGeneric"));
    }
  }, [t]);

  const handleArchiveExtractionRequest = useCallback(
    (selectedMemberPaths?: string[]) => {
      const location = archiveExtractionSource;
      if (!location) {
        return;
      }
      const destinationPaneId: PaneId = isDualMode ? (effectiveActivePaneId === "left" ? "right" : "left") : effectiveActivePaneId;
      const destinationPane = destinationPaneId === "right" ? rightPane : leftPane;
      if (isDualMode && (destinationPane.currentLocation.kind !== "physical" || !destinationPane.contentCapabilities.mutate)) {
        return;
      }
      const archiveName = fileName(location.source.path);
      const usesSiblingDirectory = !isDualMode;
      setArchiveExtractionError(null);
      setArchiveExtractionContext({
        location,
        selectedMemberPaths,
        destinationParent: usesSiblingDirectory
          ? physicalLocation(location.source.connectionId, parentPath(location.source.path))
          : destinationPane.currentLocation,
        destinationPaneId,
        usesSiblingDirectory,
        destination: null,
        destinationLabel: getLocationDisplayName(
          usesSiblingDirectory
            ? physicalLocation(location.source.connectionId, parentPath(location.source.path))
            : destinationPane.currentLocation,
          (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId
        ),
        archiveName,
        initialDestinationName: archiveName.replace(/\.zip$/i, "") || archiveName,
      });
    },
    [allConnections, archiveExtractionSource, effectiveActivePaneId, isDualMode, leftPane, rightPane]
  );

  const completeArchiveExtraction = useCallback(
    (outcome: ArchiveExtractionOutcome, context: NonNullable<typeof archiveExtractionContext>) => {
      if (outcome.status === "awaiting-decision") {
        setArchiveExtractionConflicts(outcome.conflicts);
        setArchiveExtractionAllowedActions(outcome.allowedActions);
        setArchiveExtractionMemberError(null);
        return;
      }
      if (outcome.status === "awaiting-member-error") {
        setArchiveExtractionConflicts(null);
        setArchiveExtractionAllowedActions([]);
        setArchiveExtractionMemberError(outcome.error);
        return;
      }

      archiveExtractionExecutionRef.current = null;
      setArchiveExtractionConflicts(null);
      setArchiveExtractionAllowedActions([]);
      setArchiveExtractionMemberError(null);
      setIsExtractingArchive(false);
      setIsCancellingArchiveExtraction(false);
      setArchiveExtractionProgress(null);
      const destinationPane = context.destinationPaneId === "right" ? rightPane : leftPane;
      destinationPane.handleDirectoryChanged({
        connectionId: context.destinationParent.connectionId,
        path: context.destinationParent.path,
      });
      setArchiveExtractionContext(null);
    },
    [leftPane, rightPane]
  );

  const handleArchiveExtractionConfirm = useCallback(
    async (destinationName: string) => {
      if (!archiveExtractionContext) {
        return;
      }
      setIsExtractingArchive(true);
      setArchiveExtractionError(null);
      setArchiveExtractionConflicts(null);
      setArchiveExtractionAllowedActions([]);
      setArchiveExtractionMemberError(null);
      setArchiveExtractionProgress(null);
      const destination = archiveExtractionContext.usesSiblingDirectory
        ? physicalLocation(
            archiveExtractionContext.destinationParent.connectionId,
            joinPath(archiveExtractionContext.destinationParent.path, destinationName)
          )
        : archiveExtractionContext.destinationParent;
      const executionContext = { ...archiveExtractionContext, destination };
      setArchiveExtractionContext(executionContext);
      const execution = startArchiveExtraction(browserContentServices.providers, {
        source: executionContext.location,
        destination,
        selectedMemberPaths: executionContext.selectedMemberPaths,
      });
      archiveExtractionExecutionRef.current = execution;
      const unsubscribeProgress = execution.onProgress(setArchiveExtractionProgress);
      try {
        completeArchiveExtraction(await execution.result, executionContext);
      } catch (error: unknown) {
        const detail =
          isApiError(error) && error.response?.status === 409
            ? t("fileBrowser.archive.validationDestinationExists")
            : t("fileBrowser.archive.extractError");
        setArchiveExtractionError(detail);
        logger.error("Archive extraction failed", { error, destinationPath: destination.path }, "file-browser");
        archiveExtractionExecutionRef.current = null;
        setIsExtractingArchive(false);
        setIsCancellingArchiveExtraction(false);
        setArchiveExtractionProgress(null);
      } finally {
        unsubscribeProgress();
      }
    },
    [archiveExtractionContext, browserContentServices.providers, completeArchiveExtraction, t]
  );

  const cancelArchiveExtraction = useCallback(async () => {
    const execution = archiveExtractionExecutionRef.current;
    if (!execution || !archiveExtractionContext) return;
    setIsCancellingArchiveExtraction(true);
    try {
      await execution.cancel();
      if (archiveExtractionConflicts || archiveExtractionMemberError) {
        completeArchiveExtraction({ status: "cancelled" }, archiveExtractionContext);
      }
    } catch (error) {
      setIsCancellingArchiveExtraction(false);
      setArchiveExtractionError(t("fileBrowser.archive.extractError"));
      logger.error("Archive extraction cancellation failed", { error }, "file-browser");
    }
  }, [archiveExtractionConflicts, archiveExtractionContext, archiveExtractionMemberError, completeArchiveExtraction, t]);

  const handleArchiveExtractionDecision = useCallback(
    async (action: Parameters<ArchiveExtractionExecution["decide"]>[0], memberPath?: string, targetPath?: string) => {
      const execution = archiveExtractionExecutionRef.current;
      if (!execution || !archiveExtractionContext) return;
      setIsSubmittingArchiveExtractionDecision(true);
      setArchiveExtractionError(null);
      try {
        completeArchiveExtraction(await execution.decide(action, memberPath, targetPath), archiveExtractionContext);
      } catch (error) {
        setArchiveExtractionError(t("fileBrowser.archive.extractError"));
        logger.error("Archive extraction collision decision failed", { error, action, memberPath }, "file-browser");
      } finally {
        setIsSubmittingArchiveExtractionDecision(false);
      }
    },
    [archiveExtractionContext, completeArchiveExtraction, t]
  );

  const handleArchiveExtractionMemberErrorDecision = useCallback(
    async (action: "retry" | "ignore") => {
      const execution = archiveExtractionExecutionRef.current;
      if (!execution || !archiveExtractionContext || !archiveExtractionMemberError) return;
      setIsSubmittingArchiveExtractionDecision(true);
      setArchiveExtractionError(null);
      try {
        completeArchiveExtraction(await execution.decide(action, archiveExtractionMemberError.memberPath), archiveExtractionContext);
      } catch (error) {
        setArchiveExtractionError(t("fileBrowser.archive.extractError"));
        logger.error("Archive extraction member error decision failed", { error }, "file-browser");
      } finally {
        setIsSubmittingArchiveExtractionDecision(false);
      }
    },
    [archiveExtractionContext, archiveExtractionMemberError, completeArchiveExtraction, t]
  );

  /** Route F5 in a ZIP pane to selected-member extraction. */
  const handleCopyToOtherPane = useCallback(() => {
    const location = activePane.currentLocation;
    if (location.kind === "virtual" && location.providerId === "zip" && isDualMode) {
      const selectedMemberPaths = activePane
        .getEffectiveSelection()
        .flatMap((item) =>
          item.handle.kind === "virtual" &&
          item.handle.location.providerId === "zip" &&
          item.handle.location.connectionId === location.connectionId &&
          item.handle.location.source.path === location.source.path &&
          item.entry.is_readable
            ? [item.handle.path]
            : []
        );
      if (selectedMemberPaths.length > 0) {
        handleArchiveExtractionRequest(selectedMemberPaths);
      }
      return;
    }
    handleOpenCopyMoveDialog("copy");
  }, [activePane, handleArchiveExtractionRequest, handleOpenCopyMoveDialog, isDualMode]);

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
      connectionWritable: quickBarPaneWritable,
      canCreateArchive: activePaneCanCreateArchive,
      canExtractArchive: archiveExtractionSource !== null && archiveExtractionContext === null,
      canOpenFocusedFileInApp: quickBarCanOpenInApp,
      canCopyToOtherPane: quickBarCanCopyToOtherPane,
      canMoveToOtherPane: quickBarCanMoveToOtherPane,
      openQuickNav: () => openQuickBarMode("navigate"),
      openFileSearch: () => openQuickBarMode("file-search"),
      openCommandMode: () => openQuickBarMode("commands"),
      openSettings: handleOpenSettings,
      openConnectionsSettings,
      openHelp: () => setShowHelp(true),
      refresh: quickBarPane.handleRefresh,
      navigateUp: quickBarPane.handleNavigateUpDirectory,
      openFocusedItem: () => quickBarPane.handleOpenFile({ requireListFocus: false }),
      renameFocusedItem: () => quickBarPane.handleRenameRequest({ requireListFocus: false }),
      deleteFocusedItem: () => quickBarPane.handleDeleteRequest({ requireListFocus: false }),
      newDirectory: quickBarPane.handleNewDirectoryRequest,
      newFile: quickBarPane.handleNewFileRequest,
      createArchive: handleCreateArchiveRequest,
      extractArchive: handleArchiveExtractionRequest,
      openInApp: () => {
        void quickBarPane.handleOpenInApp();
      },
      openInViewerPicker: () => quickBarPane.handleOpenFile({ requireListFocus: false, mode: "force-viewer-picker" }),
      openInNativePicker: () => {
        void quickBarPane.handleOpenInApp({ forcePicker: true });
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
      handleCreateArchiveRequest,
      handleArchiveExtractionRequest,
      archiveExtractionSource,
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
      quickBarCanCopyToOtherPane,
      activePaneCanCreateArchive,
      archiveExtractionContext,
      quickBarCanMoveToOtherPane,
      quickBarCanOpenInApp,
      quickBarMode,
      quickBarPane,
      quickBarPaneWritable,
      settingsOpen,
      showHelp,
      useCompactLayout,
    ]
  );

  const browserCommandsProvider = useBrowserCommandsProvider({
    commands: getEnabledBrowserCommands(browserCommandContext),
    onSelect: (command) => command.run(browserCommandContext),
  });

  const fileSearchProvider = useFileSearchProvider({
    connectionId: quickBarPane.connectionId,
    currentPath: quickBarPane.currentPath,
    files: quickBarPane.files,
    connectionName: getConnectionById(allConnections, quickBarPane.connectionId)?.name ?? quickBarPane.connectionId,
    resultLimit: 50,
    getConnectionName: (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId,
    onOpenCurrentFile: (file, mode) => {
      const index = quickBarPane.files.findIndex((entry) => entry.name === file.name);
      quickBarPane.handleOpenFileForFile(file, index, mode);
    },
    onOpenRecentFile: (file, mode) => {
      void quickBarPane.handleOpenFileAtPath(file.connection_id, file.path, mode, file.id);
    },
    history: browserContentServices.history,
  });

  const suppressQuickBarDropdown =
    showHelp ||
    settingsOpen ||
    mobileSettingsOpen ||
    copyMoveDialogOpen ||
    archiveExtractionContext !== null ||
    conflictDialogOpen ||
    archiveCreateContext !== null ||
    leftPane.viewInfo !== null ||
    rightPane.viewInfo !== null ||
    leftPane.browserViewerPickerState !== null ||
    rightPane.browserViewerPickerState !== null ||
    quickBarPane.deleteDialogOpen ||
    quickBarPane.renameDialogOpen ||
    quickBarPane.createDialogOpen;

  const quickBarProvider = useMemo(() => {
    if (quickBarMode === "commands") {
      return browserCommandsProvider;
    }

    if (quickBarMode === "file-search") {
      return fileSearchProvider;
    }

    return quickBarPane.directorySearchProvider;
  }, [browserCommandsProvider, fileSearchProvider, quickBarMode, quickBarPane.directorySearchProvider]);

  const quickBarModeOptions = useMemo(
    () => [
      {
        id: "navigate",
        label: t("fileBrowser.search.modes.navigate"),
        onSelect: () => switchQuickBarMode("navigate"),
      },
      {
        id: "file-search",
        label: t("fileBrowser.search.modes.fileSearch"),
        onSelect: () => switchQuickBarMode("file-search"),
      },
      {
        id: "commands",
        label: t("fileBrowser.search.modes.commands"),
        onSelect: () => switchQuickBarMode("commands"),
      },
    ],
    [switchQuickBarMode, t]
  );

  const quickBarQueryValue = undefined;
  const handleQuickBarQueryValueChange = undefined;
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
  const browserShortcuts = useMemo<KeyboardShortcut[]>(() => {
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
        description: t("fileBrowser.shortcuts.openSelectedItem"),
        handler: () => activePane.handleOpenFile({ mode: "associated-viewer" }),
        enabled: browsing && hasFocusedFile,
      },
      {
        ...BROWSER_SHORTCUTS.OPEN_IN_VIEWER_PICKER,
        handler: () => activePane.handleOpenFile({ mode: "force-viewer-picker" }),
        enabled: browsing && hasFocusedFile,
      },
      // Open in companion app (Ctrl+Enter)
      {
        ...BROWSER_SHORTCUTS.OPEN_IN_APP,
        handler: () => activePane.handleOpenInApp(),
        enabled: browsing && activePaneCanOpenInApp,
      },
      // Choose native app (Ctrl+Alt+Enter)
      {
        ...BROWSER_SHORTCUTS.OPEN_IN_NATIVE_PICKER,
        handler: () => activePane.handleOpenInApp({ forcePicker: true }),
        enabled: browsing && activePaneCanOpenInApp,
      },
      // Navigate up directory
      {
        ...BROWSER_SHORTCUTS.NAVIGATE_UP,
        handler: activePane.handleNavigateUpDirectory,
        enabled: browsing && (activePaneIsArchive || activePane.currentPathRef.current !== ""),
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
      // Navigate mode (Ctrl+K) — also focuses the search bar
      {
        ...BROWSER_SHORTCUTS.QUICK_NAVIGATE,
        handler: () => openQuickBarMode("navigate"),
        enabled: browsing,
      },
      // File Search (/)
      {
        ...BROWSER_SHORTCUTS.FILE_SEARCH,
        handler: () => openQuickBarMode("file-search"),
        enabled: browsing && noDialogOrCopyMove,
      },
      // Command palette (Ctrl+P)
      {
        ...BROWSER_SHORTCUTS.COMMAND_PALETTE,
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
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP_ALTERNATE,
        handler: () => setShowHelp(true),
        enabled: browsing,
      },
      // Delete file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.DELETE_ITEM,
        handler: () => activePane.handleDeleteRequest(),
        enabled: browsing && !activePaneIsArchive && noDialogOpen && hasFocusedFile,
      },
      // Rename file/directory (focus checked inside handler)
      {
        ...BROWSER_SHORTCUTS.RENAME_ITEM,
        handler: () => activePane.handleRenameRequest(),
        enabled: browsing && !activePaneIsArchive && noDialogOpen && hasFocusedFile,
      },
      // Copy to other pane (F5 in dual mode — takes priority over Refresh)
      {
        ...COPY_MOVE_SHORTCUTS.COPY_TO_OTHER_PANE,
        handler: handleCopyToOtherPane,
        enabled: isDualMode && browsing && noDialogOrCopyMove && (!activePaneIsArchive || activePaneCanExtractSelectedMembers),
      },
      // Move to other pane (F6 in dual mode)
      {
        ...COPY_MOVE_SHORTCUTS.MOVE_TO_OTHER_PANE,
        handler: handleMoveToOtherPane,
        enabled: isDualMode && browsing && !activePaneIsArchive && noDialogOrCopyMove,
      },
      // Create new directory (F7)
      {
        ...BROWSER_SHORTCUTS.NEW_DIRECTORY,
        handler: () => activePane.handleNewDirectoryRequest(),
        enabled: browsing && !activePaneIsArchive && noDialogOpen,
      },
      // Create new file (Shift+F7)
      {
        ...BROWSER_SHORTCUTS.NEW_FILE,
        handler: () => activePane.handleNewFileRequest(),
        enabled: browsing && !activePaneIsArchive && noDialogOpen,
      },
      // Create a ZIP archive from the selected physical entries (Alt+F5)
      {
        ...BROWSER_SHORTCUTS.CREATE_ARCHIVE,
        handler: handleCreateArchiveRequest,
        enabled: browsing && noDialogOpen && activePaneCanCreateArchive,
      },
      {
        ...BROWSER_SHORTCUTS.EXTRACT_ARCHIVE,
        handler: handleArchiveExtractionRequest,
        enabled: browsing && noDialogOpen && archiveExtractionSource !== null && archiveExtractionContext === null,
      },
      // ── Selection Shortcuts (Norton Commander multi-select) ──────────────
      // Toggle selection on focused file, then move focus down (Insert / Space)
      {
        ...SELECTION_SHORTCUTS.TOGGLE_SELECTION,
        handler: () => activePane.handleToggleSelection(),
        enabled: browsing && noDialogOrCopyMove && hasFiles,
      },
      // Select focused file & move down (Alt+Down)
      {
        ...SELECTION_SHORTCUTS.SELECT_DOWN,
        handler: () => activePane.handleSelectDown(),
        enabled: browsing && noDialogOrCopyMove && hasFiles,
        priority: 10,
      },
      // Select focused file & move up (Alt+Up)
      {
        ...SELECTION_SHORTCUTS.SELECT_UP,
        handler: () => activePane.handleSelectUp(),
        enabled: browsing && noDialogOrCopyMove && hasFiles,
        priority: 10,
      },
      // Select all files (Ctrl+A)
      {
        ...SELECTION_SHORTCUTS.SELECT_ALL,
        handler: () => activePane.handleSelectAll(),
        enabled: browsing && noDialogOrCopyMove && hasFiles,
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
    activePaneCanOpenInApp,
    activePaneCanExtractSelectedMembers,
    activePaneIsArchive,
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
    handleCreateArchiveRequest,
    activePaneCanCreateArchive,
    handleArchiveExtractionRequest,
    archiveExtractionContext,
    archiveExtractionSource,
    t,
  ]);

  useKeyboardShortcuts({
    active: !showHelp && !viewerOverlayOpen && !archiveWorkflowDialogOpen,
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

  const handleLogout = async () => {
    await signOutCurrentBrowser();
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
      const data = await browserContentServices.connections.getConnections();
      setConnections(data);

      await companion.refresh();

      let companionDrives = [];
      try {
        companionDrives = await browserContentServices.connections.getStoredCompanionDrives();
      } catch (error) {
        logger.warn("Failed to refresh companion drives after settings change", { error }, "companion");
      }

      const availableConnections = mergeConnections(data, companionDrives);
      const hasConnection = (connectionId: string) => availableConnections.some((connection) => connection.id === connectionId);

      // Invalidate caches in both panes since connection properties may have changed
      const leftConnId = leftPane.connectionId;
      if (leftConnId && hasConnection(leftConnId)) {
        leftPane.invalidateConnectionCache(leftConnId);
        void leftPane.reloadCurrentLocation({ forceRefresh: true });
      }
      const rightConnId = rightPane.connectionId;
      if (rightConnId && hasConnection(rightConnId)) {
        rightPane.invalidateConnectionCache(rightConnId);
        void rightPane.reloadCurrentLocation({ forceRefresh: true });
      }

      // Check if left pane's connection still exists
      if (leftConnId && hasConnection(leftConnId)) {
        // Left pane's connection is fine — check right pane too
        if (rightConnId && !hasConnection(rightConnId)) {
          navigateToBrowseState(
            {
              left: buildBrowseRouteTarget(
                leftConnId,
                leftPane.currentPathRef.current,
                availableConnections,
                toVirtualRouteLocation(leftPane.archiveLocation)
              ),
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
  }, [
    browserContentServices.connections.getConnections,
    browserContentServices.connections.getStoredCompanionDrives,
    companion,
    leftPane,
    navigate,
    navigateToBrowseState,
    rightPane,
  ]);

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
    <Box sx={getMobileViewportShellSx(useCompactLayout)}>
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
        onOpenHelp={() => setShowHelp(true)}
        onOpenDocumentation={handleOpenDocumentation}
        onOpenSettings={handleOpenSettings}
        onLogout={handleLogout}
      />
      <AppBar position="static" elevation={useCompactLayout ? undefined : 0} sx={mobileSafeAreaAppBarSx}>
        <Toolbar sx={mobileSafeAreaToolbarSx}>
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
              searchRefreshToken={quickBarRefreshToken}
              searchInputRef={quickBarPane.searchInputRef}
              showSearch={activePane.connectionId !== ""}
              onOpenHelp={() => setShowHelp(true)}
              onOpenDocumentation={handleOpenDocumentation}
              onOpenSettings={handleOpenSettings}
              onBlurToFileList={() => quickBarPane.listContainerEl?.focus()}
              searchQueryValue={quickBarQueryValue}
              onSearchQueryValueChange={handleQuickBarQueryValueChange}
              disableSearchDropdown={false}
              suppressSearchDropdown={suppressQuickBarDropdown}
              onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
              disableTabFocus={isDualMode}
              modeOptions={quickBarModeOptions}
              showKeyboardHints={showQuickBarKeyboardHints}
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
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          pt: 2,
          pb: { xs: SAFE_AREA_INSET.BOTTOM, sm: 0 },
          overflow: "hidden",
          overscrollBehaviorY: "contain",
        }}
      >
        <FileBrowserAlerts
          error={leftPane.error}
          companionLifecycleStatus={companionLifecycleStatus}
          loadingConnections={loadingConnections}
          connectionsCount={connections.length}
          backendAvailabilityStatus={backendAvailability.status}
          onDismissCompanionLifecycleStatus={dismissCompanionLifecycleStatus}
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
                if (paneMode === "dual" && pendingPaneFocusRef.current === null) {
                  replaceActivePaneInRoute("left");
                }
              }}
              disableTabFocus={isDualMode}
              searchProvider={quickBarProvider}
              searchActivationToken={quickBarActivationToken}
              searchRefreshToken={quickBarRefreshToken}
              searchQueryValue={quickBarQueryValue}
              onSearchQueryValueChange={handleQuickBarQueryValueChange}
              disableSearchDropdown={false}
              suppressSearchDropdown={suppressQuickBarDropdown}
              onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
              showKeyboardHints={showQuickBarKeyboardHints}
              modeOptions={quickBarModeOptions}
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
                    if (pendingPaneFocusRef.current === null) {
                      replaceActivePaneInRoute("right");
                    }
                  }}
                  disableTabFocus={isDualMode}
                  searchProvider={quickBarProvider}
                  searchActivationToken={quickBarActivationToken}
                  searchRefreshToken={quickBarRefreshToken}
                  searchQueryValue={quickBarQueryValue}
                  onSearchQueryValueChange={handleQuickBarQueryValueChange}
                  disableSearchDropdown={false}
                  suppressSearchDropdown={suppressQuickBarDropdown}
                  onSearchArrowDownToFileList={handleQuickBarArrowDownToFileList}
                  showKeyboardHints={showQuickBarKeyboardHints}
                  modeOptions={quickBarModeOptions}
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
          connectionId={leftPane.viewInfo.connectionId ?? leftPane.connectionId}
          isReadOnly={isConnectionReadOnly(leftPaneConnection)}
          viewInfo={leftPane.viewInfo}
          onClose={leftPane.handleViewClose}
          onIndexChange={leftPane.handleViewIndexChange}
          hasMoreItems={leftPane.viewInfo.virtualSource ? leftPane.archiveHasMore : false}
          isLoadingMoreItems={leftPane.viewInfo.virtualSource ? leftPane.archiveLoadingMore : false}
          onLoadMoreItems={leftPane.viewInfo.virtualSource ? leftPane.loadMoreArchive : undefined}
          contentProviders={browserContentServices.providers}
        />
      )}
      {rightPane.viewInfo && !leftPane.viewInfo && (
        <DynamicViewer
          connectionId={rightPane.viewInfo.connectionId ?? rightPane.connectionId}
          isReadOnly={isConnectionReadOnly(rightPaneConnection)}
          viewInfo={rightPane.viewInfo}
          onClose={rightPane.handleViewClose}
          onIndexChange={rightPane.handleViewIndexChange}
          hasMoreItems={rightPane.viewInfo.virtualSource ? rightPane.archiveHasMore : false}
          isLoadingMoreItems={rightPane.viewInfo.virtualSource ? rightPane.archiveLoadingMore : false}
          onLoadMoreItems={rightPane.viewInfo.virtualSource ? rightPane.loadMoreArchive : undefined}
          contentProviders={browserContentServices.providers}
        />
      )}
      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={browserShortcuts}
        title={t("keyboardShortcutsHelp.titles.fileBrowser")}
      />
      <NameInputDialog
        open={archiveCreateContext !== null}
        title={t("fileBrowser.archive.createTitle")}
        description={
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            <Trans
              i18nKey="fileBrowser.archive.createPrompt"
              count={archiveCreateContext?.sources.length ?? 0}
              values={{ directory: archiveCreateContext?.destinationLabel ?? "" }}
              components={{ directory: <InlineItemName testId="archive-create-prompt-directory" /> }}
            />
          </Typography>
        }
        inputLabel={t("fileBrowser.archive.nameLabel")}
        initialValue="archive.zip"
        submitLabel={t("fileBrowser.archive.buttonCreate")}
        submittingLabel={t("fileBrowser.archive.buttonCreating")}
        isSubmitting={isCreatingArchive}
        isCancelling={isCancellingArchiveCreation}
        onCancelSubmitting={isCreatingArchive ? () => void cancelArchiveCreation() : undefined}
        cancelSubmittingLabel={t("fileBrowser.archive.buttonCancelCreation")}
        onClose={() => {
          if (!isCreatingArchive) {
            setArchiveCreateContext(null);
            setArchiveCreateError(null);
          }
        }}
        onConfirm={handleCreateArchiveConfirm}
        apiError={archiveCreateError}
        extraValidate={(name) => (name.toLowerCase().endsWith(".zip") ? null : t("fileBrowser.archive.validationExtension"))}
        autoSelectRange={[0, "archive".length]}
        submittingContent={<ArchiveOperationProgress currentItem={archiveCreateContext?.sources[0]?.path ?? ""} />}
      />
      <ArchiveExtractDialog
        archiveName={archiveExtractionContext?.archiveName ?? ""}
        initialDestinationName={archiveExtractionContext?.initialDestinationName ?? ""}
        destinationLabel={archiveExtractionContext?.destinationLabel}
        sourcePathPrefix={
          archiveExtractionContext
            ? getLocationDisplayName(
                archiveExtractionContext.location,
                (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId
              )
            : undefined
        }
        targetConnectionName={
          archiveExtractionContext
            ? (getConnectionById(
                allConnections,
                (archiveExtractionContext.destination ?? archiveExtractionContext.destinationParent).connectionId
              )?.name ?? (archiveExtractionContext.destination ?? archiveExtractionContext.destinationParent).connectionId)
            : undefined
        }
        requiresDestinationName={archiveExtractionContext?.usesSiblingDirectory ?? true}
        open={archiveExtractionContext !== null}
        isExtracting={isExtractingArchive}
        isCancelling={isCancellingArchiveExtraction}
        error={archiveExtractionError}
        memberError={archiveExtractionMemberError}
        progressSummary={archiveExtractionProgress}
        conflicts={archiveExtractionConflicts}
        allowedConflictActions={archiveExtractionAllowedActions}
        isSubmittingConflictDecision={isSubmittingArchiveExtractionDecision || isCancellingArchiveExtraction}
        onClose={() => {
          if (!isExtractingArchive) {
            setArchiveExtractionContext(null);
            setArchiveExtractionError(null);
          }
        }}
        onConfirm={(destinationName) => void handleArchiveExtractionConfirm(destinationName)}
        onCancelExtraction={() => void cancelArchiveExtraction()}
        onMemberErrorDecision={(action) => void handleArchiveExtractionMemberErrorDecision(action)}
        onConflictDecision={(action, memberPath, targetPath) => void handleArchiveExtractionDecision(action, memberPath, targetPath)}
      />
      {/* Companion app guidance hint */}
      <Snackbar
        open={companionHintOpen}
        autoHideDuration={6000}
        onClose={() => setCompanionHintOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={t("fileBrowser.chrome.alerts.companionLaunchHint")}
      />
      <Snackbar
        open={archiveInterruptionNoticeOpen}
        autoHideDuration={8000}
        onClose={() => setArchiveInterruptionNoticeOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={t("fileBrowser.archive.interruptedAfterReload")}
      />
      {/* Copy / Move Dialog (dual-pane F5/F6) */}
      <CopyMoveDialog
        open={copyMoveDialogOpen}
        mode={copyMoveMode}
        files={copyMoveItems.map((item) => item.entry)}
        destinationLabel={copyMoveDestinationLabel}
        isSameDirectory={copyMoveSameDirectory}
        onConfirm={handleCopyMoveConfirm}
        onCancel={handleCopyMoveCancel}
        isProcessing={copyMoveProcessing}
        progress={copyMoveProgress}
        transferProgress={copyMoveTransferProgress}
        error={copyMoveError}
        warning={copyMoveWarning}
      />
      {/* Overwrite Conflict Dialog (shown per-file during copy/move) */}
      <OverwriteResolutionDialog
        open={conflictDialogOpen}
        conflict={conflictInfo}
        operation={copyMoveMode}
        allowedActions={getCopyMoveConflictActions(conflictInfo)}
        progress={conflictProgress}
        sourcePath={
          conflictInfo && copyMoveItems[0]
            ? getLocationDisplayName(
                { kind: "physical", connectionId: copyMoveItems[0].handle.location.connectionId, path: conflictInfo.incoming_file.path },
                (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId
              )
            : undefined
        }
        targetDirectoryPath={
          conflictInfo && copyMoveDestination
            ? getLocationDisplayName(
                {
                  kind: "physical",
                  connectionId: copyMoveDestination.connectionId,
                  path: parentPath(conflictInfo.existing_file.path),
                },
                (connectionId) => getConnectionById(allConnections, connectionId)?.name ?? connectionId
              )
            : undefined
        }
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </Box>
  );
};

export default Browser;
