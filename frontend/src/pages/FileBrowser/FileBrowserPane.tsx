/**
 * FileBrowserPane — Renders a single file browser pane
 * =====================================================
 *
 * Displays the per-pane UI: breadcrumbs, view/sort controls, file list,
 * status bar, and CRUD dialogs. Used by the parent Browser component
 * both in single-pane and dual-pane layouts.
 *
 * In dual-pane mode, the active pane gets a visual accent border and
 * the inactive pane is slightly dimmed. Clicking an inactive pane
 * makes it active.
 *
 * @see useFileBrowserPane — provides all pane state and handlers
 * @see FileBrowser — the parent page-level orchestrator
 */

import { Box, Chip, CircularProgress } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BreadcrumbsNavigation } from "../../components/FileBrowser/BreadcrumbsNavigation";
import ConfirmDeleteDialog from "../../components/FileBrowser/ConfirmDeleteDialog";
import CreateItemDialog from "../../components/FileBrowser/CreateItemDialog";
import { FileList } from "../../components/FileBrowser/FileList";
import RenameDialog from "../../components/FileBrowser/RenameDialog";
import { STATUS_BAR_HEIGHT, StatusBar } from "../../components/FileBrowser/StatusBar";
import type { SearchProvider } from "../../components/FileBrowser/search";
import { UnifiedSearchBar } from "../../components/FileBrowser/UnifiedSearchBar";
import type { Connection } from "../../types";
import { FileType } from "../../types";
import { canOpenFileInApp, isConnectionReadOnly } from "./access";
import type { PaneId, PaneMode, UseFileBrowserPaneReturn } from "./types";

// ============================================================================
// Props
// ============================================================================

export interface FileBrowserPaneProps {
  /** The pane hook return value containing all pane state and handlers. */
  pane: UseFileBrowserPaneReturn;

  /** Which pane this is (left or right). */
  paneId: PaneId;

  /** Whether this pane is the currently active/focused pane. */
  isActive: boolean;

  /** Current layout mode (single or dual). */
  paneMode: PaneMode;

  /** Available SMB connections. */
  connections: Connection[];

  /** Whether the UI is in mobile/compact layout. */
  useCompactLayout: boolean;

  /** Whether the user is navigating with keyboard (for focus indicators). */
  isUsingKeyboard: boolean;

  /** Called when the user clicks on this pane to make it active. */
  onPaneFocus: () => void;

  /** Remove interactive controls from Tab order (dual-pane mode uses Tab for pane switching). */
  disableTabFocus?: boolean;

  /** Current quick-bar provider for the browser. */
  searchProvider: SearchProvider;

  /** Increments whenever the quick bar is explicitly reopened. */
  searchActivationToken?: number;

  /** Controlled query value for filter mode. */
  searchQueryValue?: string;

  /** Controlled query change handler for filter mode. */
  onSearchQueryValueChange?: (value: string) => void;

  /** Disable dropdown behavior for list-backed filter mode. */
  disableSearchDropdown?: boolean;

  /** Move focus from the search input into the file list. */
  onSearchArrowDownToFileList?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const FileBrowserPane: React.FC<FileBrowserPaneProps> = ({
  pane,
  paneId,
  isActive,
  paneMode,
  connections,
  useCompactLayout,
  isUsingKeyboard,
  onPaneFocus,
  disableTabFocus,
  searchProvider,
  searchActivationToken,
  searchQueryValue,
  onSearchQueryValueChange,
  disableSearchDropdown,
  onSearchArrowDownToFileList,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDualMode = paneMode === "dual";

  /** Only show the selection highlight on the focused row when this pane is active. */
  const showSelectionHighlight = !isDualMode || isActive;

  const {
    connectionId,
    currentPath,
    loading,
    viewMode,
    currentDirectoryFilter,
    isCurrentDirectoryFilterActive,
    focusedIndex,
    selectedFiles,
    sortedAndFilteredFiles,
    // Dialogs
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
    // Refs
    parentRef,
    searchInputRef,
    listContainerRef,
    listContainerEl,
    // Virtualizer
    rowVirtualizer,
    // Handlers
    handleFileClick,
    handleOpenInAppForFile,
    handleRenameForFile,
    closeDeleteDialog,
    handleDeleteConfirm,
    closeRenameDialog,
    handleRenameConfirm,
    closeCreateDialog,
    handleCreateConfirm,
  } = pane;

  const currentConnection = useMemo(() => connections.find((connection) => connection.id === connectionId), [connections, connectionId]);

  // Connection display name for breadcrumbs
  const connectionName = currentConnection?.name ?? "";
  const connectionIsReadOnly = isConnectionReadOnly(currentConnection);
  const canRenameItems = !connectionIsReadOnly;
  const canOpenFocusedFileInApp = canOpenFileInApp(currentConnection);

  // ──────────────────────────────────────────────────────────────────────────
  // File Row Styles — depend on isUsingKeyboard (global) and theme
  // ──────────────────────────────────────────────────────────────────────────

  const fileRowStyles = useMemo(
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
        background: isUsingKeyboard && showSelectionHighlight ? theme.palette.action.selected : "transparent",
        "&:hover": {
          backgroundColor: isUsingKeyboard && showSelectionHighlight ? theme.palette.action.selected : "transparent",
        },
        "&:active": {
          backgroundColor: isUsingKeyboard && showSelectionHighlight ? theme.palette.action.selected : "transparent",
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
          backgroundColor: isUsingKeyboard ? theme.palette.action.selected : "transparent",
        },
        "&:active": {
          backgroundColor: isUsingKeyboard ? theme.palette.action.selected : "transparent",
        },
      },
      buttonMultiSelected: {
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
        borderLeft: `3px solid ${theme.palette.primary.main}`,
        borderRadius: 0,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
        background: alpha(theme.palette.primary.main, 0.16),
        color: theme.palette.primary.main,
        "&:hover": {
          backgroundColor: alpha(theme.palette.primary.main, 0.22),
        },
        "&:active": {
          backgroundColor: alpha(theme.palette.primary.main, 0.22),
        },
      },
      buttonFocusedMultiSelected: {
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
        borderLeft: `3px solid ${theme.palette.primary.main}`,
        borderRadius: 0,
        transition: "background-color 80ms ease-out",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
        background:
          isUsingKeyboard && showSelectionHighlight ? alpha(theme.palette.primary.main, 0.26) : alpha(theme.palette.primary.main, 0.16),
        color: theme.palette.primary.main,
        "&:hover": {
          backgroundColor: alpha(theme.palette.primary.main, 0.26),
        },
        "&:active": {
          backgroundColor: alpha(theme.palette.primary.main, 0.26),
        },
      },
    }),
    [theme, isUsingKeyboard, showSelectionHighlight]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Pane container styles
  // ──────────────────────────────────────────────────────────────────────────

  const paneContainerSx = useMemo(() => {
    const base: Record<string, unknown> = {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
    };

    if (isDualMode && !isActive) {
      base["cursor"] = "pointer";
    }

    return base;
  }, [isDualMode, isActive]);

  // ──────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle click on the pane container — makes this pane active. */
  const handlePaneClick = React.useCallback(() => {
    if (!isActive) {
      onPaneFocus();
    }
  }, [isActive, onPaneFocus]);

  const handlePaneFocus = React.useCallback(() => {
    if (!isActive) {
      onPaneFocus();
    }
  }, [isActive, onPaneFocus]);

  /** Navigate to a breadcrumb path segment. */
  const handleBreadcrumbNavigate = React.useCallback(
    (path: string) => {
      pane.navigateToPath(path, { blurActiveElement: true });
    },
    [pane]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────

  if (!connectionId) return null;

  return (
    <Box data-pane-id={paneId} sx={paneContainerSx} onClick={handlePaneClick} onFocusCapture={handlePaneFocus} onKeyDown={undefined}>
      {/* Breadcrumbs + View/Sort controls (desktop) */}
      {!useCompactLayout && (
        <Box
          display="flex"
          alignItems="center"
          sx={{
            mb: 2,
            px: 2,
            height: STATUS_BAR_HEIGHT,
            boxSizing: "border-box",
          }}
        >
          <BreadcrumbsNavigation
            currentPath={currentPath}
            connectionName={connectionName}
            onNavigate={handleBreadcrumbNavigate}
            onEscape={() => listContainerEl?.focus()}
            disableTabFocus={disableTabFocus}
            showActiveIndicator={isDualMode && isActive}
          />
          {connectionIsReadOnly && (
            <Chip
              size="small"
              variant="outlined"
              color="warning"
              label={t("settings.connectionDialog.accessMode.readOnlyLabel")}
              title={t("settings.connectionDialog.helpers.accessModeReadOnly")}
              sx={{ ml: 1, flexShrink: 0 }}
            />
          )}
        </Box>
      )}

      {/* Search bar (mobile compact layout) */}
      {useCompactLayout && (
        <>
          <UnifiedSearchBar
            provider={searchProvider}
            activationToken={searchActivationToken}
            inputRef={searchInputRef}
            useCompactLayout={useCompactLayout}
            onBlurToFileList={() => listContainerEl?.focus()}
            queryValue={searchQueryValue}
            onQueryValueChange={onSearchQueryValueChange}
            disableDropdown={disableSearchDropdown}
            onArrowDownToFileList={onSearchArrowDownToFileList}
          />
          {connectionIsReadOnly && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label={t("settings.connectionDialog.accessMode.readOnlyLabel")}
                title={t("settings.connectionDialog.helpers.accessModeReadOnly")}
              />
            </Box>
          )}
        </>
      )}

      {/* File list or loading indicator */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            gap: 2,
            flex: 1,
            minHeight: 0,
            mb: 0,
            flexDirection: "column",
          }}
        >
          <FileList
            files={sortedAndFilteredFiles}
            focusedIndex={focusedIndex}
            selectedFiles={selectedFiles}
            onFileClick={handleFileClick}
            rowVirtualizer={rowVirtualizer}
            parentRef={parentRef}
            listContainerRef={listContainerRef}
            fileRowStyles={fileRowStyles}
            viewMode={viewMode}
            onOpenInApp={canOpenFocusedFileInApp ? handleOpenInAppForFile : undefined}
            onRename={canRenameItems ? handleRenameForFile : undefined}
          />
        </Box>
      )}

      {/* Status Bar */}
      {!useCompactLayout && !loading && (sortedAndFilteredFiles.length > 0 || isCurrentDirectoryFilterActive) && (
        <StatusBar files={sortedAndFilteredFiles} focusedIndex={focusedIndex} activeFilter={currentDirectoryFilter} />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        itemName={deleteTarget?.name ?? ""}
        itemType={deleteTarget?.type ?? FileType.FILE}
        isDeleting={isDeleting}
        onClose={closeDeleteDialog}
        onConfirm={handleDeleteConfirm}
      />

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        itemName={renameTarget?.name ?? ""}
        itemType={renameTarget?.type ?? FileType.FILE}
        isRenaming={isRenaming}
        apiError={renameError}
        onClose={closeRenameDialog}
        onConfirm={handleRenameConfirm}
      />

      {/* Create Item Dialog */}
      <CreateItemDialog
        open={createDialogOpen}
        itemType={createItemType}
        isCreating={isCreating}
        apiError={createError}
        onClose={closeCreateDialog}
        onConfirm={handleCreateConfirm}
      />
    </Box>
  );
};

export default FileBrowserPane;
