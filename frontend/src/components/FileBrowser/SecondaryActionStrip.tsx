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

import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import type React from "react";
import { PANE_SHORTCUTS } from "../../config/keyboardShortcuts";
import type { CompanionStatus } from "../../hooks/useCompanion";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { translate } from "../../i18n";
import type { SortField, ViewMode } from "../../pages/FileBrowser/types";
import {
  secondaryActionStripSx,
  secondaryStripButtonContentSx,
  secondaryStripButtonIconSx,
  secondaryStripButtonLabelSx,
  secondaryStripButtonSx,
} from "../../theme/commonStyles";
import type { Connection } from "../../types";
import { createEscapeHandler } from "../../utils/keyboardUtils";
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
  /** Whether the browser is displaying both panes. */
  isDualPane: boolean;
  /** Callback to toggle between single and dual-pane layouts. */
  onToggleDualPane: () => void;
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
  /** Callback to open the consolidated Connections settings page. */
  onOpenConnectionsSettings?: () => void;
  /** Ref to the connection selector trigger for page-level shortcuts. */
  connectionButtonRef?: React.Ref<HTMLButtonElement>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a compact action strip with view and sort controls.
 * Only shown on desktop when at least one connection is available.
 */
export function SecondaryActionStrip({
  connections,
  selectedConnectionId,
  onConnectionChange,
  viewMode,
  onViewModeChange,
  isDualPane,
  onToggleDualPane,
  sortBy,
  onSortChange,
  sortDirection,
  onDirectionChange,
  hasFiles,
  onBlurToFileList,
  disableTabFocus,
  companionStatus,
  onOpenConnectionsSettings,
  connectionButtonRef,
}: SecondaryActionStripProps) {
  if (connections.length === 0) {
    return null;
  }

  return (
    <Box
      sx={[
        secondaryActionStripSx,
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          flexWrap: "nowrap",
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": {
            display: "none",
          },
        },
      ]}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: "1 1 auto" }}>
        <ConnectionSelector
          connections={connections}
          selectedConnectionId={selectedConnectionId}
          onConnectionChange={onConnectionChange}
          onAfterChange={onBlurToFileList}
          disableTabFocus={disableTabFocus}
          companionStatus={companionStatus}
          onOpenConnectionsSettings={onOpenConnectionsSettings}
          buttonRef={connectionButtonRef}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, flex: "0 0 auto", ml: "auto" }}>
        <Tooltip title={withShortcut(PANE_SHORTCUTS.TOGGLE_DUAL_PANE)}>
          <Button
            onClick={onToggleDualPane}
            onKeyDown={createEscapeHandler(onBlurToFileList)}
            size="small"
            tabIndex={disableTabFocus ? -1 : undefined}
            aria-label={translate("fileBrowser.chrome.dualPaneToggle.ariaLabel")}
            aria-pressed={isDualPane}
            sx={{
              ...secondaryStripButtonSx,
              color: "text.secondary",
            }}
          >
            <Box sx={secondaryStripButtonContentSx}>
              <VerticalSplitIcon sx={secondaryStripButtonIconSx} />
              <Typography sx={secondaryStripButtonLabelSx}>{translate("fileBrowser.chrome.dualPaneToggle.label")}</Typography>
            </Box>
          </Button>
        </Tooltip>
        {hasFiles && (
          <>
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
          </>
        )}
      </Box>
    </Box>
  );
}
