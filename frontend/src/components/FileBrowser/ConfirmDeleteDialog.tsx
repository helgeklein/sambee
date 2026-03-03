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

import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { fileNamePillSx } from "../../theme/commonStyles";
import { FileType } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
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

  /** ENTER activates the focused button; no default fallback (Cancel has focus). */
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);

  return (
    <Dialog
      open={open}
      onClose={isDeleting ? undefined : onClose}
      onKeyDown={handleKeyDown}
      TransitionComponent={NoTransition}
      PaperProps={{
        sx: { bgcolor: "background.default" },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>{confirmPrompt}</DialogContentText>
        <Box sx={{ ...fileNamePillSx, mt: 0.5 }}>{itemName}</Box>
      </DialogContent>
      <DialogActions>
        <Button ref={cancelRef} onClick={onClose} disabled={isDeleting}>
          {CONFIRM_DELETE_STRINGS.BUTTON_CANCEL}
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={isDeleting}
          startIcon={isDeleting ? <CircularProgress size={16} /> : undefined}
        >
          {isDeleting ? CONFIRM_DELETE_STRINGS.BUTTON_DELETING : CONFIRM_DELETE_STRINGS.BUTTON_DELETE}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDeleteDialog;
