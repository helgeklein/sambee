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

import { Box, Button, Checkbox, FormControlLabel, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ConflictInfo, FileType } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../../utils/localeFormatting";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { OVERWRITE_CONFLICT_STRINGS as S } from "./overwriteConflictStrings";

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
  if (kb < 1024) return `${formatLocalizedNumber(kb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${formatLocalizedNumber(mb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  const gb = mb / 1024;
  return `${formatLocalizedNumber(gb, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

/** Format an ISO date string with the active application locale. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatLocalizedDateTime(iso, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
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
    <ResponsiveFormDialog
      open={open}
      onClose={handleClose}
      onKeyDown={handleKeyDown}
      title={S.TITLE(isDirectory)}
      description={S.ALREADY_EXISTS(isDirectory)}
      maxWidth="sm"
      actions={
        <>
          <Button ref={skipButtonRef} onClick={handleSkip}>
            {S.BUTTON_SKIP}
          </Button>
          <Button onClick={handleReplace} variant="contained" color="error">
            {S.BUTTON_REPLACE}
          </Button>
        </>
      }
    >
      <DialogReadOnlyField label={S.LABEL_TARGET} value={fileName} sx={{ mb: 2 }} />
      <Typography variant="body1" sx={{ mb: 0.5 }}>
        {S.LABEL_OPERATION}
      </Typography>

      {conflict ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr auto 1fr" },
            gap: 1.5,
            mb: 2,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.selected",
          }}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5, color: "text.secondary" }}>
              {S.LABEL_INCOMING}
            </Typography>
            <Typography variant="body2">{formatBytes(conflict.incoming_file.size)}</Typography>
            <Typography variant="body2">{formatDate(conflict.incoming_file.modified_at)}</Typography>
          </Box>
          <Box
            aria-hidden="true"
            sx={{
              alignItems: "center",
              color: "text.secondary",
              display: { xs: "none", sm: "flex" },
              fontSize: "1.8rem",
              px: 0.5,
            }}
          >
            →
          </Box>
          <Box sx={{ borderTop: { xs: 1, sm: 0 }, borderColor: "divider", pt: { xs: 1.5, sm: 0 } }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, color: "text.secondary" }}>
              {S.LABEL_EXISTING}
            </Typography>
            <Typography variant="body2">{formatBytes(conflict.existing_file.size)}</Typography>
            <Typography variant="body2">{formatDate(conflict.existing_file.modified_at)}</Typography>
          </Box>
        </Box>
      ) : null}

      {progress && progress.total > 1 ? (
        <>
          <FormControlLabel
            control={<Checkbox checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} size="small" />}
            label={S.APPLY_TO_ALL}
            sx={{ mt: 0.5 }}
          />
          <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "text.secondary" }}>
            {S.PROGRESS_CONTEXT(progress.current, progress.total, progress.conflictsSoFar)}
          </Typography>
        </>
      ) : null}
    </ResponsiveFormDialog>
  );
};

export default OverwriteConflictDialog;
