//
// CopyMoveDialog
//

/**
 * Copy / Move Confirmation Dialog
 * ================================
 *
 * Shows a confirmation dialog when the user presses F5 (copy) or F6 (move)
 * in dual-pane mode. Shows the destination inline for single-item operations
 * and in a read-only field for multi-item operations. Single-item
 * operations also provide an editable new-name field.
 * Existing-target conflicts are resolved individually by the shared
 * overwrite-resolution dialog after they occur.
 *
 * The dialog calls the backend API for each item sequentially, showing
 * progress. Both panes refresh via WebSocket after completion.
 */

import { Alert, Box, Button, CircularProgress, LinearProgress, TextField, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "react-i18next";
import type { FileEntry } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { COPY_MOVE_STRINGS as S } from "./copyMoveDialogStrings";
import { FILENAME_FIELD_PROPS, FILENAME_INPUT_PROPS, FILENAME_INPUT_SX } from "./filenameFieldProps";
import { InlineItemName } from "./InlineItemName";
import { validateItemName } from "./nameDialogStrings";

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
  /** Provider-generated display label for the destination. */
  destinationLabel: string;
  /** Whether the source and destination locations are the same. */
  isSameDirectory: boolean;
  /** Called when the user confirms with an optional renamed file name. */
  onConfirm: (destFileName: string | undefined) => void;
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
  /** Warning message for a completed copy whose source could not be removed. */
  warning?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

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

/** Add a conventional copy suffix while preserving a file's final extension. */
function suggestCopyFileName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0) return `${fileName} (copy)`;
  return `${fileName.slice(0, extensionIndex)} (copy)${fileName.slice(extensionIndex)}`;
}

// ============================================================================
// Component
// ============================================================================

const CopyMoveDialog: React.FC<CopyMoveDialogProps> = ({
  open,
  mode,
  files,
  destinationLabel,
  isSameDirectory,
  onConfirm,
  onCancel,
  isProcessing,
  progress,
  transferProgress,
  error,
  warning,
}) => {
  // Editable file name — only used for single-item operations
  const isSingleItem = files.length === 1;
  const originalFileName = isSingleItem ? (files[0]!.name ?? "") : "";
  const isCopy = mode === "copy";
  const initialFileName = isSingleItem && isCopy && isSameDirectory ? suggestCopyFileName(originalFileName) : originalFileName;
  const [destFileName, setDestFileName] = useState(initialFileName);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Reset state when the dialog opens with new values
  useEffect(() => {
    if (open) {
      setDestFileName(initialFileName);
      // Focus the filename input for single-item, or the confirm
      // button for multi-item.  requestAnimationFrame lets the MUI
      // Dialog finish its own focus-trap setup first.
      if (isSingleItem) {
        requestAnimationFrame(() => inputRef.current?.select());
      } else {
        requestAnimationFrame(() => confirmButtonRef.current?.focus());
      }
    }
  }, [open, initialFileName, isSingleItem]);

  const title = isCopy ? S.TITLE_COPY : S.TITLE_MOVE;
  const prompt = isCopy ? S.PROMPT_COPY_MULTI(files.length) : S.PROMPT_MOVE_MULTI(files.length);
  const description = isSingleItem ? (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      <Trans
        i18nKey={isCopy ? "fileBrowser.copyMove.promptCopySingle" : "fileBrowser.copyMove.promptMoveSingle"}
        values={{ name: originalFileName, destination: destinationLabel }}
        components={{
          item: <InlineItemName testId="copy-move-prompt-item-name" />,
          destination: <InlineItemName testId="copy-move-prompt-destination" />,
        }}
      />
    </Typography>
  ) : (
    prompt
  );

  const confirmLabel = isProcessing ? (isCopy ? S.BUTTON_COPYING : S.BUTTON_MOVING) : isCopy ? S.BUTTON_COPY : S.BUTTON_MOVE;

  // A multi-item operation is a no-op in the same directory. A single item
  // is a no-op only when both its directory and file name are unchanged.
  const sameFile = isSameDirectory && isSingleItem && destFileName === originalFileName;
  const isNoOpDestination = isSingleItem ? sameFile : isSameDirectory;

  const nameValidationError = isSingleItem ? validateItemName(destFileName) : null;
  const fileNameError = nameValidationError ?? (sameFile ? S.ERROR_SAME_FILENAME : undefined);

  // Can confirm only when we have a valid destination
  const canConfirm = !isProcessing && !isNoOpDestination && !nameValidationError;

  const handleConfirm = useCallback(() => {
    if (canConfirm) {
      // Pass renamed file name only if it was changed for single-item operations
      const renamedFileName = isSingleItem && destFileName !== originalFileName ? destFileName : undefined;
      onConfirm(renamedFileName);
    }
  }, [canConfirm, destFileName, originalFileName, isSingleItem, onConfirm]);

  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(canConfirm ? handleConfirm : undefined), [canConfirm, handleConfirm]);

  const formContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {warning ? <Alert severity="warning">{warning}</Alert> : null}
      {isSingleItem ? (
        <SettingsFormSurface>
          <SettingsFormGroup>
            <SettingsFormRow sx={{ display: { md: "block" } }}>
              <TextField
                id="copy-move-filename"
                inputRef={inputRef}
                label={S.LABEL_FILENAME}
                value={destFileName}
                onChange={(event) => setDestFileName(event.target.value)}
                disabled={isProcessing}
                error={Boolean(fileNameError)}
                helperText={fileNameError ?? " "}
                {...FILENAME_FIELD_PROPS}
                slotProps={{ htmlInput: FILENAME_INPUT_PROPS }}
                sx={[settingsFormOutlinedControlSx, FILENAME_INPUT_SX]}
              />
            </SettingsFormRow>
          </SettingsFormGroup>
        </SettingsFormSurface>
      ) : (
        <SettingsFormSurface>
          <SettingsFormGroup>
            <SettingsFormRow sx={{ display: { md: "block" }, py: 0 }}>
              <DialogReadOnlyField ariaLabel={S.LABEL_DESTINATION} value={destinationLabel} showFormSurface />
            </SettingsFormRow>
          </SettingsFormGroup>
        </SettingsFormSurface>
      )}

      {!isSingleItem ? (
        <Alert
          aria-hidden={!isNoOpDestination}
          data-testid="copy-move-destination-error"
          severity="error"
          sx={{ visibility: isNoOpDestination ? "visible" : "hidden" }}
        >
          {S.ERROR_SAME_DIRECTORY}
        </Alert>
      ) : null}

      {isProcessing && progress ? (
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5, color: "text.secondary" }}>
            {isCopy ? S.PROGRESS_COPY(progress.current, progress.total) : S.PROGRESS_MOVE(progress.current, progress.total)}
          </Typography>
          <LinearProgress variant="determinate" value={(progress.current / progress.total) * 100} />
        </Box>
      ) : null}

      {isProcessing && transferProgress ? (
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5, color: "text.secondary" }}>
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
      ) : null}
    </Box>
  );

  const actions = (
    <>
      <Button onClick={onCancel}>{S.BUTTON_CANCEL}</Button>
      <Button
        ref={confirmButtonRef}
        onClick={handleConfirm}
        disabled={!canConfirm}
        variant="contained"
        startIcon={isProcessing ? <CircularProgress size={16} color="inherit" /> : undefined}
      >
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onCancel}
      disableClose={isProcessing}
      onKeyDown={handleKeyDown}
      title={title}
      description={description}
      actions={actions}
      maxWidth="sm"
    >
      {formContent}
    </ResponsiveFormDialog>
  );
};

export default CopyMoveDialog;
