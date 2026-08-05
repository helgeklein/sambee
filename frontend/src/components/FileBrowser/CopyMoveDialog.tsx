//
// CopyMoveDialog
//

/**
 * Copy / Move Confirmation Dialog
 * ================================
 *
 * Shows a confirmation dialog when the user presses F5 (copy) or F6 (move)
 * in dual-pane mode. Shows the destination inline for single-item operations
 * and in a read-only code-style field for multi-item operations. Single-item
 * operations also provide an editable new-name field.
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
import { Trans } from "react-i18next";
import type { FileEntry } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { COPY_MOVE_STRINGS as S } from "./copyMoveDialogStrings";
import { FILENAME_FIELD_PROPS, FILENAME_INPUT_PROPS, FILENAME_INPUT_SX } from "./filenameFieldProps";
import { formatConnectionPath } from "./formatConnectionPath";
import { InlineItemName } from "./InlineItemName";
import { validateItemName } from "./nameDialogStrings";

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
  const isCopy = mode === "copy";
  const sameDirectory = isSameConnection && destPath.replace(/\/+$/, "") === sourcePath.replace(/\/+$/, "");
  const initialFileName = isSingleItem && isCopy && sameDirectory ? suggestCopyFileName(originalFileName) : originalFileName;
  const [destFileName, setDestFileName] = useState(initialFileName);
  const [overwriteStrategy, setOverwriteStrategy] = useState<OverwriteStrategy>("ask");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Reset state when the dialog opens with new values
  useEffect(() => {
    if (open) {
      setDestFileName(initialFileName);
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
  }, [open, initialFileName, isSingleItem]);

  const title = isCopy ? S.TITLE_COPY : S.TITLE_MOVE;
  const destination = formatConnectionPath(destConnectionName, destPath);
  const prompt = isCopy ? S.PROMPT_COPY_MULTI(files.length) : S.PROMPT_MOVE_MULTI(files.length);
  const description = isSingleItem ? (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      <Trans
        i18nKey={isCopy ? "fileBrowser.copyMove.promptCopySingle" : "fileBrowser.copyMove.promptMoveSingle"}
        values={{ name: originalFileName, destination }}
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
  const sameFile = sameDirectory && isSingleItem && destFileName === originalFileName;
  const isNoOpDestination = isSingleItem ? sameFile : sameDirectory;

  const nameValidationError = isSingleItem ? validateItemName(destFileName) : null;
  const fileNameError = nameValidationError ?? (sameFile ? S.ERROR_SAME_FILENAME : undefined);

  // Can confirm only when we have a valid destination
  const canConfirm = !isProcessing && !isNoOpDestination && !nameValidationError;

  const handleConfirm = useCallback(() => {
    if (canConfirm) {
      // Pass renamed file name only if it was changed for single-item operations
      const renamedFileName = isSingleItem && destFileName !== originalFileName ? destFileName : undefined;
      onConfirm(destPath, renamedFileName, overwriteStrategy);
    }
  }, [canConfirm, destPath, destFileName, originalFileName, isSingleItem, onConfirm, overwriteStrategy]);

  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(canConfirm ? handleConfirm : undefined), [canConfirm, handleConfirm]);

  const formContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
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
        <>
          <SettingsFormSurface>
            <SettingsFormGroup>
              <SettingsFormRow sx={{ display: { md: "block" } }}>
                <DialogReadOnlyField ariaLabel={S.LABEL_DESTINATION} value={destination} codeBlock showFormSurface />
              </SettingsFormRow>
            </SettingsFormGroup>
          </SettingsFormSurface>
          <SettingsFormSurface>
            <SettingsFormGroup>
              <SettingsFormRow sx={{ display: { md: "block" } }}>
                <FormControl disabled={isProcessing}>
                  <Typography variant="body2" sx={{ mb: 1, color: "text.secondary" }}>
                    {S.OVERWRITE_STRATEGY_LABEL}
                  </Typography>
                  <RadioGroup
                    value={overwriteStrategy}
                    onChange={(event) => setOverwriteStrategy(event.target.value as OverwriteStrategy)}
                    sx={{
                      "& .MuiFormControlLabel-root": { minHeight: 28, my: 0 },
                      "& .MuiFormControlLabel-label": { fontSize: "0.875rem", lineHeight: 1.43 },
                      "& .MuiRadio-root": { p: 0.5 },
                    }}
                  >
                    <FormControlLabel value="ask" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_ASK} />
                    <FormControlLabel value="replace-all" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_REPLACE_ALL} />
                    <FormControlLabel value="skip-all" control={<Radio size="small" />} label={S.OVERWRITE_STRATEGY_SKIP_ALL} />
                  </RadioGroup>
                </FormControl>
              </SettingsFormRow>
            </SettingsFormGroup>
          </SettingsFormSurface>
        </>
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
      contentSx={{ px: { xs: 2, sm: 3 }, py: 2 }}
    >
      {formContent}
    </ResponsiveFormDialog>
  );
};

export default CopyMoveDialog;
