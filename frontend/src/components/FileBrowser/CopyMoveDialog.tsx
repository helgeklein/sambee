//
// CopyMoveDialog
//

/**
 * Copy / Move Confirmation Dialog
 * ================================
 *
 * Shows a confirmation dialog when the user presses F5 (copy) or F6 (move)
 * in dual-pane mode. Displays the list of selected items and an editable
 * destination path pre-filled from the other pane's current directory.
 *
 * The dialog calls the backend API for each item sequentially, showing
 * progress. Both panes refresh via WebSocket after completion.
 */

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  TextField,
  Typography,
} from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "../../types";
import { COPY_MOVE_STRINGS as S } from "./copyMoveDialogStrings";
import { NoTransition } from "./transitions";

// ============================================================================
// Types
// ============================================================================

/** Whether the dialog is being used for a copy or move operation. */
export type CopyMoveMode = "copy" | "move";

export interface CopyMoveDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Copy or move mode. */
  mode: CopyMoveMode;
  /** Files to copy/move. */
  files: FileEntry[];
  /** Source connection ID. */
  sourceConnectionId: string;
  /** Source directory path (the directory containing the selected files). */
  sourcePath: string;
  /** Target connection ID (from the other pane). */
  destConnectionId: string;
  /** Target connection display name (for UI). */
  destConnectionName: string;
  /** Pre-filled destination directory path (from the other pane). */
  destPath: string;
  /** Whether source and destination are on the same connection. */
  isSameConnection: boolean;
  /** Called when the user confirms — receives the (possibly edited) destination path. */
  onConfirm: (destPath: string) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Whether an operation is currently in progress. */
  isProcessing: boolean;
  /** Progress info shown during batch processing. */
  progress?: { current: number; total: number };
  /** Error message from a failed operation, if any. */
  error?: string | null;
}

// ============================================================================
// Component
// ============================================================================

const CopyMoveDialog: React.FC<CopyMoveDialogProps> = ({
  open,
  mode,
  files,
  sourcePath,
  destConnectionName,
  destPath: initialDestPath,
  isSameConnection,
  onConfirm,
  onCancel,
  isProcessing,
  progress,
  error,
}) => {
  const [destPath, setDestPath] = useState(initialDestPath);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset destination when the dialog opens with new values
  useEffect(() => {
    if (open) {
      setDestPath(initialDestPath);
      // Focus the destination input after a frame (dialog open animation)
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, initialDestPath]);

  const isCopy = mode === "copy";
  const title = isCopy ? S.TITLE_COPY : S.TITLE_MOVE;
  const prompt = isCopy
    ? files.length === 1
      ? S.PROMPT_COPY_SINGLE
      : S.PROMPT_COPY_MULTI(files.length)
    : files.length === 1
      ? S.PROMPT_MOVE_SINGLE
      : S.PROMPT_MOVE_MULTI(files.length);

  const confirmLabel = isProcessing ? (isCopy ? S.BUTTON_COPYING : S.BUTTON_MOVING) : isCopy ? S.BUTTON_COPY : S.BUTTON_MOVE;

  // Destination is the same directory as the source — would be a no-op
  const sameDirectory = destPath.replace(/\/+$/, "") === sourcePath.replace(/\/+$/, "");

  // Can confirm only when we have a valid destination
  const canConfirm = !isProcessing && isSameConnection && destPath.trim() !== "" && !sameDirectory;

  const handleConfirm = useCallback(() => {
    if (canConfirm) {
      onConfirm(destPath.trim());
    }
  }, [canConfirm, destPath, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canConfirm) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [canConfirm, handleConfirm]
  );

  // ── Max items to show in the file list before truncating ──────────────
  const MAX_VISIBLE_FILES = 8;
  const visibleFiles = files.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = files.length - MAX_VISIBLE_FILES;

  return (
    <Dialog open={open} onClose={isProcessing ? undefined : onCancel} fullWidth maxWidth="sm" TransitionComponent={NoTransition}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        {/* Prompt */}
        <Typography variant="body1" sx={{ mb: 2 }}>
          {prompt}
        </Typography>

        {/* File list */}
        <Box
          sx={{
            maxHeight: 200,
            overflow: "auto",
            mb: 2,
            pl: 2,
            borderLeft: 2,
            borderColor: "divider",
          }}
        >
          {visibleFiles.map((f) => (
            <Typography key={f.name} variant="body2" color="text.secondary" noWrap title={f.name}>
              {f.type === "directory" ? `${f.name}/` : f.name}
            </Typography>
          ))}
          {hiddenCount > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
              …and {hiddenCount} more
            </Typography>
          )}
        </Box>

        {/* Destination connection (read-only) */}
        {destConnectionName && (
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            {S.LABEL_DESTINATION_CONNECTION}: {destConnectionName}
          </Typography>
        )}

        {/* Destination path (editable) */}
        <TextField
          inputRef={inputRef}
          label={S.LABEL_DESTINATION}
          value={destPath}
          onChange={(e) => setDestPath(e.target.value)}
          onKeyDown={handleKeyDown}
          fullWidth
          size="small"
          disabled={isProcessing}
          autoComplete="off"
          inputProps={{ "aria-label": S.LABEL_DESTINATION }}
          sx={{ mt: 1 }}
        />

        {/* Warnings */}
        {!isSameConnection && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {S.WARN_CROSS_CONNECTION}
          </Alert>
        )}
        {isSameConnection && sameDirectory && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {S.WARN_SAME_DIRECTORY}
          </Alert>
        )}

        {/* Progress */}
        {isProcessing && progress && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {isCopy ? S.PROGRESS_COPY(progress.current, progress.total) : S.PROGRESS_MOVE(progress.current, progress.total)}
            </Typography>
            <LinearProgress variant="determinate" value={(progress.current / progress.total) * 100} />
          </Box>
        )}

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancel} disabled={isProcessing}>
          {S.BUTTON_CANCEL}
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!canConfirm}
          variant="contained"
          startIcon={isProcessing ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CopyMoveDialog;
