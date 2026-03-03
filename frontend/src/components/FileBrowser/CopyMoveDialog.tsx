//
// CopyMoveDialog
//

/**
 * Copy / Move Confirmation Dialog
 * ================================
 *
 * Shows a confirmation dialog when the user presses F5 (copy) or F6 (move)
 * in dual-pane mode. Displays the list of selected items, a read-only
 * destination path, and an editable file-name field for single-item
 * operations (allowing rename-on-copy/move).
 *
 * For multi-file operations, a pre-flight "overwrite strategy" selector
 * lets the user choose how to handle destination conflicts before the
 * operation begins:
 *   - Ask for each file (default / safest)
 *   - Replace all existing files
 *   - Skip all existing files
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
  FormControl,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileNamePillSx } from "../../theme/commonStyles";
import type { FileEntry } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { COPY_MOVE_STRINGS as S } from "./copyMoveDialogStrings";
import { FILENAME_FIELD_PROPS, FILENAME_INPUT_PROPS, FILENAME_INPUT_SX } from "./filenameFieldProps";
import { NoTransition } from "./transitions";

// ============================================================================
// Types
// ============================================================================

/** Whether the dialog is being used for a copy or move operation. */
export type CopyMoveMode = "copy" | "move";

/**
 * Pre-flight strategy for handling destination conflicts.
 *
 * - ``ask``         — pause on each conflict and prompt the user (default)
 * - ``replace-all`` — silently overwrite every conflicting destination
 * - ``skip-all``    — silently skip every conflicting file
 */
export type OverwriteStrategy = "ask" | "replace-all" | "skip-all";

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
  /** Called when the user confirms — receives the destination path, optional renamed file name, and overwrite strategy. */
  onConfirm: (destPath: string, destFileName: string | undefined, overwriteStrategy: OverwriteStrategy) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Whether an operation is currently in progress. */
  isProcessing: boolean;
  /** Progress info shown during batch processing. */
  progress?: { current: number; total: number };
  /** Byte-level transfer progress for cross-connection operations via WebSocket. */
  transferProgress?: { bytesTransferred: number; totalBytes: number | null; itemName: string } | null;
  /** Error message from a failed operation, if any. */
  error?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Build a human-readable "connection: /path" destination string. */
function formatDestination(connectionName: string, path: string): string {
  const displayPath = path === "" ? "/" : `/${path}`;
  return connectionName ? `${connectionName}: ${displayPath}` : displayPath;
}

/** Format byte count into a human-readable string (e.g. "1.5 MB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
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
  destPath,
  isSameConnection,
  onConfirm,
  onCancel,
  isProcessing,
  progress,
  transferProgress,
  error,
}) => {
  // Editable file name — only used for single-item operations
  const isSingleItem = files.length === 1;
  const originalFileName = isSingleItem ? (files[0]!.name ?? "") : "";
  const [destFileName, setDestFileName] = useState(originalFileName);
  const [overwriteStrategy, setOverwriteStrategy] = useState<OverwriteStrategy>("ask");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Reset state when the dialog opens with new values
  useEffect(() => {
    if (open) {
      setDestFileName(originalFileName);
      setOverwriteStrategy("ask");
      // Focus the filename input for single-item, or the confirm
      // button for multi-item.  requestAnimationFrame lets the MUI
      // Dialog finish its own focus-trap setup first.
      if (isSingleItem) {
        requestAnimationFrame(() => inputRef.current?.select());
      } else {
        requestAnimationFrame(() => confirmButtonRef.current?.focus());
      }
    }
  }, [open, originalFileName, isSingleItem]);

  const isCopy = mode === "copy";
  const title = isCopy ? S.TITLE_COPY : S.TITLE_MOVE;
  const destination = formatDestination(destConnectionName, destPath);
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

  // For single-item: same dir + same name is a no-op
  const sameFile = sameDirectory && isSingleItem && destFileName.trim() === originalFileName;

  // File name must not be empty for single-item operations
  const emptyFileName = isSingleItem && destFileName.trim() === "";

  // Can confirm only when we have a valid destination
  const canConfirm = !isProcessing && !sameFile && !emptyFileName && (!sameDirectory || isSingleItem);

  const handleConfirm = useCallback(() => {
    if (canConfirm) {
      // Pass renamed file name only if it was changed for single-item operations
      const renamedFileName = isSingleItem && destFileName.trim() !== originalFileName ? destFileName.trim() : undefined;
      onConfirm(destPath, renamedFileName, overwriteStrategy);
    }
  }, [canConfirm, destPath, destFileName, originalFileName, isSingleItem, onConfirm, overwriteStrategy]);

  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(canConfirm ? handleConfirm : undefined), [canConfirm, handleConfirm]);

  return (
    <Dialog
      open={open}
      onClose={isProcessing ? undefined : onCancel}
      onKeyDown={handleKeyDown}
      fullWidth
      maxWidth="sm"
      TransitionComponent={NoTransition}
    >
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        {/* Prompt with destination on a separate line */}
        <Typography variant="body1" sx={{ mb: 0.5 }}>
          {prompt}
        </Typography>
        <Box sx={{ ...fileNamePillSx, mb: 2 }}>{destination}</Box>

        {/* Editable file name (single-item only) */}
        {isSingleItem && (
          <TextField
            inputRef={inputRef}
            label={S.LABEL_FILENAME}
            value={destFileName}
            onChange={(e) => setDestFileName(e.target.value)}
            disabled={isProcessing}
            {...FILENAME_FIELD_PROPS}
            inputProps={{
              "aria-label": S.LABEL_FILENAME,
              ...FILENAME_INPUT_PROPS,
            }}
            sx={{ mt: 2, ...FILENAME_INPUT_SX }}
          />
        )}

        {/* Overwrite strategy (multi-file operations only) */}
        {!isSingleItem && (
          <FormControl sx={{ mt: 2 }} disabled={isProcessing}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {S.OVERWRITE_STRATEGY_LABEL}
            </Typography>
            <RadioGroup value={overwriteStrategy} onChange={(e) => setOverwriteStrategy(e.target.value as OverwriteStrategy)}>
              <FormControlLabel value="ask" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_ASK} />
              <FormControlLabel value="replace-all" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_REPLACE_ALL} />
              <FormControlLabel value="skip-all" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_SKIP_ALL} />
            </RadioGroup>
          </FormControl>
        )}

        {/* Warnings */}
        {isSameConnection && sameDirectory && !isSingleItem && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {S.WARN_SAME_DIRECTORY}
          </Alert>
        )}
        {isSameConnection && sameFile && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {S.WARN_SAME_DIRECTORY}
          </Alert>
        )}
        {emptyFileName && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {S.WARN_EMPTY_FILENAME}
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

        {/* Byte-level transfer progress (cross-connection) */}
        {isProcessing && transferProgress && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {transferProgress.itemName}:{" "}
              {transferProgress.totalBytes != null && transferProgress.totalBytes > 0
                ? `${formatBytes(transferProgress.bytesTransferred)} / ${formatBytes(transferProgress.totalBytes)}`
                : formatBytes(transferProgress.bytesTransferred)}
            </Typography>
            {transferProgress.totalBytes != null && transferProgress.totalBytes > 0 ? (
              <LinearProgress
                variant="determinate"
                value={Math.min(100, (transferProgress.bytesTransferred / transferProgress.totalBytes) * 100)}
              />
            ) : (
              <LinearProgress variant="indeterminate" />
            )}
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
          ref={confirmButtonRef}
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
