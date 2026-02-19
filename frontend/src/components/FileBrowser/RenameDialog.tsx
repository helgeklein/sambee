//
// RenameDialog
//

/**
 * Rename Dialog
 * =============
 *
 * Modal dialog for renaming a file or directory.
 * The text field is pre-filled with the current name and auto-selects
 * the name portion (excluding the extension for files).
 */

import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileType } from "../../types";
import { RENAME_DIALOG_STRINGS } from "./renameDialogStrings";

// Characters forbidden in SMB/NTFS file names
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

// ============================================================================
// Props
// ============================================================================

interface RenameDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Current name of the file or directory */
  itemName: string;
  /** Type of the item (file or directory) */
  itemType: FileType;
  /** Whether a rename operation is in progress */
  isRenaming: boolean;
  /** Called when the user cancels */
  onClose: () => void;
  /** Called when the user confirms with the new name */
  onConfirm: (newName: string) => void;
  /** Error message from the API (e.g., "already exists") */
  apiError?: string | null;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate the new name and return an error message, or null if valid.
 */
function validateName(newName: string, originalName: string): string | null {
  const trimmed = newName.trim();
  if (!trimmed) return RENAME_DIALOG_STRINGS.VALIDATION_EMPTY;
  if (trimmed === originalName) return RENAME_DIALOG_STRINGS.VALIDATION_SAME;
  if (trimmed === "." || trimmed === "..") return RENAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES;
  if (INVALID_NAME_CHARS.test(trimmed)) return RENAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS;
  if (trimmed.endsWith(" ") || trimmed.endsWith(".")) return RENAME_DIALOG_STRINGS.VALIDATION_TRAILING;
  return null;
}

/**
 * Get the selection range for the name portion (excluding extension) for files,
 * or the full name for directories.
 */
function getNameSelectionRange(name: string, isDirectory: boolean): [number, number] {
  if (isDirectory) return [0, name.length];
  const dotIndex = name.lastIndexOf(".");
  // No extension, or dotfile (e.g., ".gitignore") → select all
  if (dotIndex <= 0) return [0, name.length];
  return [0, dotIndex];
}

// ============================================================================
// Component
// ============================================================================

const RenameDialog: React.FC<RenameDialogProps> = ({ open, itemName, itemType, isRenaming, onClose, onConfirm, apiError }) => {
  const isDirectory = itemType === FileType.DIRECTORY;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(itemName);
  const [validationError, setValidationError] = useState<string | null>(null);

  const title = isDirectory ? RENAME_DIALOG_STRINGS.TITLE_DIRECTORY : RENAME_DIALOG_STRINGS.TITLE_FILE;

  // Reset value when dialog opens with a new item
  useEffect(() => {
    if (open) {
      setValue(itemName);
      setValidationError(null);
    }
  }, [open, itemName]);

  // Auto-select the name portion when the dialog opens
  const selectNamePortion = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const [start, end] = getNameSelectionRange(input.value, isDirectory);
    input.setSelectionRange(start, end);
  }, [isDirectory]);

  const handleEntered = useCallback(() => {
    selectNamePortion();
  }, [selectNamePortion]);

  // Re-focus and select name when a *new* API error arrives
  const prevApiErrorRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    const isNewError = apiError && apiError !== prevApiErrorRef.current;
    prevApiErrorRef.current = apiError;
    if (isNewError && open) {
      selectNamePortion();
    }
  }, [apiError, open, selectNamePortion]);

  //
  // handleChange
  //
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      // Clear validation error as user types (but not API error — that clears on next submit)
      if (validationError) {
        setValidationError(null);
      }
    },
    [validationError]
  );

  //
  // handleSubmit
  //
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    const error = validateName(trimmed, itemName);
    if (error) {
      setValidationError(error);
      return;
    }
    onConfirm(trimmed);
  }, [value, itemName, onConfirm]);

  //
  // handleKeyDown
  //
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isRenaming) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [isRenaming, handleSubmit]
  );

  const hasError = validationError !== null || (apiError != null && apiError !== "");

  return (
    <Dialog
      open={open}
      onClose={isRenaming ? undefined : onClose}
      TransitionProps={{ onEntered: handleEntered }}
      PaperProps={{ sx: { bgcolor: "background.default" } }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          inputRef={inputRef}
          fullWidth
          label={RENAME_DIALOG_STRINGS.INPUT_LABEL}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isRenaming}
          error={hasError}
          helperText={validationError}
          variant="outlined"
          size="small"
          autoComplete="off"
          spellCheck={false}
          sx={{ mt: 1 }}
        />
        {apiError && !validationError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {apiError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isRenaming}>
          {RENAME_DIALOG_STRINGS.BUTTON_CANCEL}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isRenaming || hasError}
          startIcon={isRenaming ? <CircularProgress size={16} /> : undefined}
          sx={{
            "&.Mui-focusVisible": {
              outline: "2px solid",
              outlineColor: "warning.main",
              outlineOffset: 2,
            },
          }}
        >
          {isRenaming ? RENAME_DIALOG_STRINGS.BUTTON_RENAMING : RENAME_DIALOG_STRINGS.BUTTON_RENAME}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RenameDialog;
