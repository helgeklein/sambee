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

import { Button, CircularProgress } from "@mui/material";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { type FileEntry, FileType } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { CONFIRM_DELETE_STRINGS } from "./confirmDeleteDialogStrings";

// ============================================================================
// Props
// ============================================================================

interface ConfirmDeleteDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Files and directories to delete */
  items: FileEntry[];
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

const DELETE_LIST_MAX_VISIBLE_ROWS = 6;

//
// ConfirmDeleteDialog
//
const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ open, items, isDeleting, onClose, onConfirm }) => {
  const isSingleItem = items.length === 1;
  const item = items[0];
  const isDirectory = item?.type === FileType.DIRECTORY;
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button immediately when dialog opens (no transition delay)
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => cancelRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const title = isSingleItem
    ? isDirectory
      ? CONFIRM_DELETE_STRINGS.TITLE_DIRECTORY
      : CONFIRM_DELETE_STRINGS.TITLE_FILE
    : CONFIRM_DELETE_STRINGS.TITLE_MULTI;
  const description = isSingleItem
    ? isDirectory
      ? CONFIRM_DELETE_STRINGS.CONFIRM_DIRECTORY
      : CONFIRM_DELETE_STRINGS.CONFIRM_FILE
    : CONFIRM_DELETE_STRINGS.CONFIRM_MULTI(items.length);
  const itemNames = items.map((currentItem) => currentItem.name).join("\n");

  /** ENTER activates the focused button; no default fallback (Cancel has focus). */
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isDeleting}
      onKeyDown={handleKeyDown}
      title={title}
      description={description}
      maxWidth="sm"
      actions={
        <>
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
        </>
      }
    >
      <DialogReadOnlyField
        ariaLabel={isSingleItem ? CONFIRM_DELETE_STRINGS.ARIA_LABEL_ITEM : CONFIRM_DELETE_STRINGS.ARIA_LABEL_ITEMS}
        value={itemNames}
        multiline={!isSingleItem}
        minRows={isSingleItem ? undefined : Math.min(items.length, DELETE_LIST_MAX_VISIBLE_ROWS)}
        maxRows={isSingleItem ? undefined : DELETE_LIST_MAX_VISIBLE_ROWS}
        codeBlock={!isSingleItem}
        showFormSurface
      />
    </ResponsiveFormDialog>
  );
};

export default ConfirmDeleteDialog;
