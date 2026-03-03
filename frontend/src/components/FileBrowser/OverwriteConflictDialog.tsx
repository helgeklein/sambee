//
// OverwriteConflictDialog
//

/**
 * Overwrite Conflict Dialog
 * =========================
 *
 * Shown when a copy/move operation encounters a file that already exists
 * at the destination.  Displays metadata for both the existing and
 * incoming files so the user can make an informed decision.
 *
 * Actions:
 *   - **Skip**    – leave the existing file untouched and continue
 *   - **Replace** – overwrite the existing file with the incoming one
 *
 * An "Apply to all remaining conflicts" checkbox lets the user convert
 * their choice into a batch decision for all subsequent conflicts in
 * the current multi-file operation.
 */

import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileNamePillSx } from "../../theme/commonStyles";
import { type ConflictInfo, FileType } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { OVERWRITE_CONFLICT_STRINGS as S } from "./overwriteConflictStrings";
import { NoTransition } from "./transitions";

// ============================================================================
// Types
// ============================================================================

/** The user's decision for a single conflict. */
export type ConflictResolution = "skip" | "replace";

export interface OverwriteConflictDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Conflict metadata (existing + incoming file info). */
  conflict: ConflictInfo | null;
  /** Progress context for multi-file operations. */
  progress?: { current: number; total: number; conflictsSoFar: number };
  /** Called when the user makes a decision. */
  onResolve: (resolution: ConflictResolution, applyToAll: boolean) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/** Format byte count into a human-readable string (e.g. "1.5 MB"). */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/** Format an ISO date string as DD.MM.YYYY, HH:MM:SS. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}.${month}.${year}, ${hours}:${minutes}:${seconds}`;
  } catch {
    return iso;
  }
}

// ============================================================================
// Component
// ============================================================================

const OverwriteConflictDialog: React.FC<OverwriteConflictDialogProps> = ({ open, conflict, progress, onResolve }) => {
  const [applyToAll, setApplyToAll] = useState(false);
  const skipButtonRef = useRef<HTMLButtonElement>(null);

  // Reset checkbox when the dialog opens with a new conflict
  useEffect(() => {
    if (open) {
      setApplyToAll(false);
      // Focus the "Skip" button (the safe/non-destructive action)
      requestAnimationFrame(() => skipButtonRef.current?.focus());
    }
  }, [open]);

  const handleSkip = useCallback(() => {
    onResolve("skip", applyToAll);
  }, [onResolve, applyToAll]);

  const handleReplace = useCallback(() => {
    onResolve("replace", applyToAll);
  }, [onResolve, applyToAll]);

  /** ENTER activates the focused button, or triggers Replace by default. */
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(handleReplace), [handleReplace]);

  /** ESC closes the dialog with a "skip" decision. */
  const handleClose = useCallback(() => {
    onResolve("skip", false);
  }, [onResolve]);

  const fileName = conflict?.existing_file.name ?? "";
  const isDirectory = conflict?.existing_file.type === FileType.DIRECTORY;

  return (
    <Dialog open={open} onClose={handleClose} onKeyDown={handleKeyDown} fullWidth maxWidth="sm" TransitionComponent={NoTransition}>
      <DialogTitle>{S.TITLE(isDirectory)}</DialogTitle>

      <DialogContent>
        {/* File name that conflicts */}
        <Typography variant="body1" sx={{ mb: 0.5 }}>
          {S.ALREADY_EXISTS(isDirectory)}
        </Typography>
        <Box sx={{ ...fileNamePillSx, mb: 2 }}>{fileName}</Box>

        <Typography variant="body1" sx={{ mb: 0.5 }}>
          {S.LABEL_OPERATION}
        </Typography>

        {/* Side-by-side metadata comparison with arrow */}
        {conflict && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: 1.5,
              mb: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: "action.selected",
            }}
          >
            {/* Incoming file (source — on the left) */}
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                {S.LABEL_INCOMING}
              </Typography>
              <Typography variant="body2">{formatBytes(conflict.incoming_file.size)}</Typography>
              <Typography variant="body2">{formatDate(conflict.incoming_file.modified_at)}</Typography>
            </Box>

            {/* Arrow pointing from source → target */}
            <Box sx={{ display: "flex", alignItems: "center", px: 0.5, color: "text.secondary", fontSize: "1.8rem" }}>→</Box>

            {/* Existing file (destination — on the right) */}
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                {S.LABEL_EXISTING}
              </Typography>
              <Typography variant="body2">{formatBytes(conflict.existing_file.size)}</Typography>
              <Typography variant="body2">{formatDate(conflict.existing_file.modified_at)}</Typography>
            </Box>
          </Box>
        )}

        {/* "Apply to all" checkbox */}
        {progress && progress.total > 1 && (
          <>
            <FormControlLabel
              control={<Checkbox checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} size="small" />}
              label={S.APPLY_TO_ALL}
              sx={{ mt: 0.5 }}
            />

            {/* Progress context */}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {S.PROGRESS_CONTEXT(progress.current, progress.total, progress.conflictsSoFar)}
            </Typography>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button ref={skipButtonRef} onClick={handleSkip}>
          {S.BUTTON_SKIP}
        </Button>
        <Button onClick={handleReplace} variant="contained" color="error">
          {S.BUTTON_REPLACE}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OverwriteConflictDialog;
