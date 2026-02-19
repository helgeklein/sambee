//
// ConfirmDeleteDialog
//

/**
 * Confirm Delete Dialog
 * =====================
 *
 * Modal dialog asking the user to confirm deletion of a file or directory.
 * The Cancel button receives initial focus so that pressing Enter does NOT
 * accidentally trigger the destructive action.
 */

import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { FileType } from "../../types";
import { CONFIRM_DELETE_STRINGS } from "./confirmDeleteDialogStrings";
import { NoTransition } from "./transitions";

// ============================================================================
// Props
// ============================================================================

interface ConfirmDeleteDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Name of the file or directory */
  itemName: string;
  /** Type of the item (file or directory) */
  itemType: FileType;
  /** Whether a delete operation is in progress */
  isDeleting: boolean;
  /** Called when the user cancels */
  onClose: () => void;
  /** Called when the user confirms deletion */
  onConfirm: () => void;
}

// ============================================================================
// Component
// ============================================================================

//
// ConfirmDeleteDialog
//
const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ open, itemName, itemType, isDeleting, onClose, onConfirm }) => {
  const isDirectory = itemType === FileType.DIRECTORY;
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button immediately when dialog opens (no transition delay)
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => cancelRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const title = isDirectory ? CONFIRM_DELETE_STRINGS.TITLE_DIRECTORY : CONFIRM_DELETE_STRINGS.TITLE_FILE;

  const confirmPrompt = isDirectory ? CONFIRM_DELETE_STRINGS.CONFIRM_DIRECTORY : CONFIRM_DELETE_STRINGS.CONFIRM_FILE;

  //
  // handleCancelKeyDown
  //
  const handleCancelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      /** MUI text buttons only respond to Space by default; wire up Enter too. */

      if (e.key === "Enter" && !isDeleting) {
        e.preventDefault();
        onClose();
      }
    },
    [isDeleting, onClose]
  );

  //
  // handleDeleteKeyDown
  //
  const handleDeleteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      /** MUI contained buttons only respond to Space by default; wire up Enter too. */

      if (e.key === "Enter" && !isDeleting) {
        e.preventDefault();
        onConfirm();
      }
    },
    [isDeleting, onConfirm]
  );

  return (
    <Dialog
      open={open}
      onClose={isDeleting ? undefined : onClose}
      TransitionComponent={NoTransition}
      PaperProps={{
        sx: { bgcolor: "background.default" },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>
          {confirmPrompt} <strong>{itemName}</strong>?
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button ref={cancelRef} onClick={onClose} onKeyDown={handleCancelKeyDown} disabled={isDeleting}>
          {CONFIRM_DELETE_STRINGS.BUTTON_CANCEL}
        </Button>
        <Button
          onClick={onConfirm}
          onKeyDown={handleDeleteKeyDown}
          color="error"
          variant="contained"
          disabled={isDeleting}
          startIcon={isDeleting ? <CircularProgress size={16} /> : undefined}
          sx={{
            "&.Mui-focusVisible": {
              outline: "2px solid",
              outlineColor: "warning.main",
              outlineOffset: 2,
              bgcolor: "error.main",
            },
          }}
        >
          {isDeleting ? CONFIRM_DELETE_STRINGS.BUTTON_DELETING : CONFIRM_DELETE_STRINGS.BUTTON_DELETE}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDeleteDialog;
