//
// types
//

import type { Virtualizer } from "@tanstack/react-virtual";
import type React from "react";
import type { SearchProvider } from "../../components/FileBrowser/search/types";
import type { FileEntry, FileType } from "../../types";

export type SortField = "name" | "size" | "modified" | "type";

export type ViewMode = "list" | "details";

// ============================================================================
// Dual-pane types
// ============================================================================

/** Identifies which pane in the dual-pane layout. */
export type PaneId = "left" | "right";

/** Whether the file browser shows one or two panes. */
export type PaneMode = "single" | "dual";

export interface ViewInfo {
  path: string;
  mimeType: string;
  images?: string[];
  currentIndex?: number;
  sessionId: string;
}

export interface NavigationHistoryEntry {
  focusedIndex: number;
  scrollOffset: number;
  selectedFileName: string | null;
}

export interface DirectoryCacheEntry {
  items: FileEntry[];
  timestamp: number;
}

// ============================================================================
// Pane hook configuration & return types
// ============================================================================

// ============================================================================
// localStorage keys
// ============================================================================

/** localStorage key for persisting single/dual pane preference. */
export const DUAL_PANE_STORAGE_KEY = "dual-pane-mode";

/** localStorage key for persisting the last active pane. */
export const ACTIVE_PANE_STORAGE_KEY = "active-pane";

// ============================================================================
// URL query-parameter keys (Phase 3 — URL routing for dual-pane)
// ============================================================================

/** Query parameter encoding right pane's connection-slug/path. */
export const RIGHT_PANE_QUERY_KEY = "p2";

/** Query parameter recording which pane has focus (1 = left, 2 = right). */
export const ACTIVE_PANE_QUERY_KEY = "active";

// ============================================================================
// Pane hook configuration & return types
// ============================================================================

/** Configuration for the useFileBrowserPane hook. */
export interface UseFileBrowserPaneConfig {
  /** Row height in pixels for the virtualizer (touch: 56, mouse: 40). */
  rowHeight: number;

  /**
   * When true, keyboard handlers inside the pane are suppressed.
   * Use this when a global dialog (settings, help) is open.
   */
  disabled?: boolean;

  /**
   * Whether this pane is the currently focused/active pane.
   * When false, the pane suppresses auto-focus on file list changes
   * to avoid stealing focus from the other pane. Defaults to true.
   */
  isActive?: boolean;

  /** Called when the pane wants to show the companion-app hint snackbar. */
  onCompanionHint?: () => void;
}

/** Everything returned by useFileBrowserPane for use by the parent and pane component. */
export interface UseFileBrowserPaneReturn {
  // ── Core State ──────────────────────────────────────────────────────────
  connectionId: string;
  setConnectionId: React.Dispatch<React.SetStateAction<string>>;
  currentPath: string;
  setCurrentPath: React.Dispatch<React.SetStateAction<string>>;
  files: FileEntry[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  // ── UI Preferences ─────────────────────────────────────────────────────
  sortBy: SortField;
  setSortBy: React.Dispatch<React.SetStateAction<SortField>>;
  sortDirection: "asc" | "desc";
  setSortDirection: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  focusedIndex: number;

  // ── Selection State (multi-select) ────────────────────────────────────
  /** Set of file names currently selected (multi-select). */
  selectedFiles: Set<string>;
  /** Toggle selection of the focused file and move focus down (Insert / Space). */
  handleToggleSelection: (e?: KeyboardEvent) => void;
  /** Select the focused file and move focus down (Alt+ArrowDown). */
  handleSelectDown: (e?: KeyboardEvent) => void;
  /** Select the focused file and move focus up (Alt+ArrowUp). */
  handleSelectUp: (e?: KeyboardEvent) => void;
  /** Select all files in the current directory (Ctrl+A). */
  handleSelectAll: () => void;
  /** Clear all selections. */
  handleClearSelection: () => void;
  /**
   * Returns the effective selection: if files are explicitly selected,
   * returns those; otherwise returns the single focused file.
   */
  getEffectiveSelection: () => FileEntry[];

  // ── Computed Data ──────────────────────────────────────────────────────
  sortedAndFilteredFiles: FileEntry[];
  imageFiles: string[];
  directorySearchProvider: SearchProvider;

  // ── Viewer State ───────────────────────────────────────────────────────
  viewInfo: ViewInfo | null;
  setViewInfo: React.Dispatch<React.SetStateAction<ViewInfo | null>>;

  // ── Dialog State ───────────────────────────────────────────────────────
  deleteDialogOpen: boolean;
  deleteTarget: FileEntry | null;
  isDeleting: boolean;
  renameDialogOpen: boolean;
  renameTarget: FileEntry | null;
  isRenaming: boolean;
  renameError: string | null;
  createDialogOpen: boolean;
  createItemType: FileType;
  isCreating: boolean;
  createError: string | null;
  openInAppLoading: boolean;

  // ── Refs (needed by parent for WebSocket wiring / shortcut checks) ────
  parentRef: React.RefObject<HTMLDivElement>;
  searchInputRef: React.RefObject<HTMLInputElement>;
  listContainerRef: (node: HTMLDivElement | null) => void;
  listContainerEl: HTMLDivElement | null;
  /** Always-current mirror of sortedAndFilteredFiles for use in callbacks. */
  filesRef: React.MutableRefObject<FileEntry[]>;
  /** Always-current mirror of connectionId for async/WebSocket callbacks. */
  connectionIdRef: React.MutableRefObject<string>;
  /** Always-current mirror of currentPath for async/WebSocket callbacks. */
  currentPathRef: React.MutableRefObject<string>;

  // ── Virtualizer ────────────────────────────────────────────────────────
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;

  // ── Navigation Handlers ────────────────────────────────────────────────
  handleFileClick: (file: FileEntry, index?: number) => void;
  handleConnectionChange: (connectionId: string) => void;
  handleNavigateDown: (e?: KeyboardEvent) => void;
  handleArrowUp: (e?: KeyboardEvent) => void;
  handleHome: () => void;
  handleEnd: () => void;
  handlePageDown: (e?: KeyboardEvent) => void;
  handlePageUp: (e?: KeyboardEvent) => void;
  handleOpenFile: () => void;
  handleNavigateUpDirectory: () => void;
  handleNavigateUp: () => void;
  handleClose: () => void;
  handleFocusSearch: () => void;
  handleRefresh: () => void;
  forceReloadCurrentDirectory: () => void;

  // ── Viewer Handlers ────────────────────────────────────────────────────
  handleViewIndexChange: (index: number) => void;
  handleViewClose: () => void;

  // ── CRUD Dialog Handlers ───────────────────────────────────────────────
  handleDeleteRequest: () => void;
  handleDeleteConfirm: () => Promise<void>;
  closeDeleteDialog: () => void;
  handleRenameRequest: () => void;
  handleRenameConfirm: (newName: string) => Promise<void>;
  handleRenameForFile: (file: FileEntry, index: number) => void;
  closeRenameDialog: () => void;
  handleNewDirectoryRequest: () => void;
  handleNewFileRequest: () => void;
  handleCreateConfirm: (name: string) => Promise<void>;
  closeCreateDialog: () => void;

  // ── Companion App ──────────────────────────────────────────────────────
  handleOpenInApp: () => Promise<void>;
  handleOpenInAppForFile: (file: FileEntry, index: number) => Promise<void>;

  // ── WebSocket Integration ──────────────────────────────────────────────
  /**
   * Call from the parent's WebSocket onmessage handler when a
   * `directory_changed` event is received.  Invalidates the cache entry
   * and triggers a reload if this pane is viewing the affected directory.
   */
  handleDirectoryChanged: (changedConnectionId: string, changedPath: string) => void;

  // ── Cache Management ───────────────────────────────────────────────────
  /** Clear all directory and navigation caches (e.g. on connection switch). */
  clearCaches: () => void;
  /** Invalidate cached entries for a specific connection (e.g. after settings change). */
  invalidateConnectionCache: (targetConnectionId: string) => void;
  /** Load files for a specific path, optionally bypassing cache. */
  loadFiles: (path: string, forceRefresh?: boolean) => Promise<void>;
}
