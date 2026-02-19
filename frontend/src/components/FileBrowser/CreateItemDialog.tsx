//
// CreateItemDialog
//

/**
 * Create Item Dialog
 * ==================
 *
 * Modal dialog for creating a new file or directory.
 * Wraps the shared NameInputDialog with create-specific behavior:
 * - Empty initial value
 * - "New file" / "New directory" title
 * - "Create" / "Creating…" button labels
 */

import type React from "react";
import { FileType } from "../../types";
import { CREATE_ITEM_DIALOG_STRINGS } from "./createItemDialogStrings";
import NameInputDialog from "./NameInputDialog";

// ============================================================================
// Props
// ============================================================================

interface CreateItemDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Type of item to create */
  itemType: FileType;
  /** Whether a create operation is in progress */
  isCreating: boolean;
  /** Called when the user cancels */
  onClose: () => void;
  /** Called when the user confirms with the new name */
  onConfirm: (name: string) => void;
  /** Error message from the API (e.g., "already exists") */
  apiError?: string | null;
}

// ============================================================================
// Component
// ============================================================================

const CreateItemDialog: React.FC<CreateItemDialogProps> = ({ open, itemType, isCreating, onClose, onConfirm, apiError }) => {
  const isDirectory = itemType === FileType.DIRECTORY;
  const title = isDirectory ? CREATE_ITEM_DIALOG_STRINGS.TITLE_DIRECTORY : CREATE_ITEM_DIALOG_STRINGS.TITLE_FILE;

  return (
    <NameInputDialog
      open={open}
      title={title}
      inputLabel={CREATE_ITEM_DIALOG_STRINGS.INPUT_LABEL}
      initialValue=""
      submitLabel={CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATE}
      submittingLabel={CREATE_ITEM_DIALOG_STRINGS.BUTTON_CREATING}
      isSubmitting={isCreating}
      onClose={onClose}
      onConfirm={onConfirm}
      apiError={apiError}
    />
  );
};

export default CreateItemDialog;
