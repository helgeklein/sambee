//
// RenameDialog
//

/**
 * Rename Dialog
 * =============
 *
 * Modal dialog for renaming a file or directory.
 * Wraps the shared NameInputDialog with rename-specific behavior:
 * - Pre-fills the text field with the current name
 * - Auto-selects the name portion (excluding extension for files)
 * - Adds "name unchanged" validation
 */

import type React from "react";
import { useMemo } from "react";
import { FileType } from "../../types";
import NameInputDialog from "./NameInputDialog";
import { RENAME_DIALOG_STRINGS } from "./renameDialogStrings";

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
// Helpers
// ============================================================================

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
  const title = isDirectory ? RENAME_DIALOG_STRINGS.TITLE_DIRECTORY : RENAME_DIALOG_STRINGS.TITLE_FILE;
  const autoSelectRange = useMemo(() => getNameSelectionRange(itemName, isDirectory), [itemName, isDirectory]);

  /** Extra validation: the name must differ from the original */
  const extraValidate = useMemo(
    () => (name: string) => {
      if (name === itemName) return RENAME_DIALOG_STRINGS.VALIDATION_SAME;
      return null;
    },
    [itemName]
  );

  return (
    <NameInputDialog
      open={open}
      title={title}
      inputLabel={RENAME_DIALOG_STRINGS.INPUT_LABEL}
      initialValue={itemName}
      submitLabel={RENAME_DIALOG_STRINGS.BUTTON_RENAME}
      submittingLabel={RENAME_DIALOG_STRINGS.BUTTON_RENAMING}
      isSubmitting={isRenaming}
      onClose={onClose}
      onConfirm={onConfirm}
      apiError={apiError}
      extraValidate={extraValidate}
      autoSelectRange={autoSelectRange}
    />
  );
};

export default RenameDialog;
