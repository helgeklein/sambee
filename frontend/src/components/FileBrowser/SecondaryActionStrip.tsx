/**
 * SecondaryActionStrip — Centralized pane-level controls
 * =======================================================
 *
 * A thin, full-width bar rendered between the AppBar and the pane
 * content area. Contains view mode and sort controls that act on
 * whichever pane is currently active.
 *
 * Design rationale (Pattern B — secondary action strip):
 * - Eliminates duplicate controls from each pane
 * - Follows M3 "docked toolbar" guidelines: full-width, standard
 *   color, straight corners, low-emphasis background
 * - Controls on the right, following MS Command Bar anatomy
 *   (content left, commands right)
 * - Hidden on mobile — compact layout uses in-pane controls instead
 *
 * @see FileBrowser — parent orchestrator that passes active pane state
 * @see ViewModeSelector — view mode pill button
 * @see SortControls — sort field/direction pill button
 */

import { Box } from "@mui/material";
import type { CompanionStatus } from "../../hooks/useCompanion";
import type { SortField, ViewMode } from "../../pages/FileBrowser/types";
import type { Connection } from "../../types";
import { ConnectionSelector } from "./ConnectionSelector";
import { SortControls } from "./SortControls";
import { ViewModeSelector } from "./ViewModeSelector";

// ============================================================================
// Props
// ============================================================================

interface SecondaryActionStripProps {
  /** Available SMB connections. */
  connections: Connection[];
  /** Currently selected connection ID for the active pane. */
  selectedConnectionId: string;
  /** Callback to change the active pane's connection. */
  onConnectionChange: (connectionId: string) => void;
  /** Current view mode of the active pane. */
  viewMode: ViewMode;
  /** Callback to change the active pane's view mode. */
  onViewModeChange: (mode: ViewMode) => void;
  /** Current sort field of the active pane. */
  sortBy: SortField;
  /** Callback to change the active pane's sort field. */
  onSortChange: (field: SortField) => void;
  /** Current sort direction of the active pane. */
  sortDirection: "asc" | "desc";
  /** Callback to toggle the active pane's sort direction. */
  onDirectionChange: () => void;
  /** Whether the active pane has files to display (hides controls when empty). */
  hasFiles: boolean;
  /** Called after a control menu closes, to return focus to the file list. */
  onBlurToFileList?: () => void;
  /** Remove controls from Tab order (dual-pane mode uses Tab for pane switching). */
  disableTabFocus?: boolean;
  /** Companion pairing status — when unavailable or unpaired, shows management action in the selector. */
  companionStatus?: CompanionStatus;
  /** Callback to open local-drive settings. */
  onManageLocalDrives?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a compact action strip with view and sort controls.
 * Only shown on desktop; hidden when there are no files to act on.
 */
export function SecondaryActionStrip({
  connections,
  selectedConnectionId,
  onConnectionChange,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  sortDirection,
  onDirectionChange,
  hasFiles,
  onBlurToFileList,
  disableTabFocus,
  companionStatus,
  onManageLocalDrives,
}: SecondaryActionStripProps) {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        px: 2,
        py: 0.5,
        minHeight: 36,
        boxShadow: 2,
        zIndex: 1,
      }}
    >
      <Box display="flex" gap={1}>
        <ConnectionSelector
          connections={connections}
          selectedConnectionId={selectedConnectionId}
          onConnectionChange={onConnectionChange}
          onAfterChange={onBlurToFileList}
          disableTabFocus={disableTabFocus}
          companionStatus={companionStatus}
          onManageLocalDrives={onManageLocalDrives}
        />
      </Box>
      {hasFiles && (
        <Box display="flex" gap={1}>
          <ViewModeSelector
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            onAfterChange={onBlurToFileList}
            disableTabFocus={disableTabFocus}
          />
          <SortControls
            sortBy={sortBy}
            onSortChange={onSortChange}
            sortDirection={sortDirection}
            onDirectionChange={onDirectionChange}
            onAfterChange={onBlurToFileList}
            disableTabFocus={disableTabFocus}
          />
        </Box>
      )}
    </Box>
  );
}
