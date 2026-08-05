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

import { Typography } from "@mui/material";
import type React from "react";
import { Trans } from "react-i18next";
import { FileType } from "../../types";
import { CREATE_ITEM_DIALOG_STRINGS } from "./createItemDialogStrings";
import { formatConnectionPath } from "./formatConnectionPath";
import { InlineItemName } from "./InlineItemName";
import NameInputDialog from "./NameInputDialog";

// ============================================================================
// Props
// ============================================================================

interface CreateItemDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Type of item to create */
  itemType: FileType;
  /** Target connection display name. */
  targetConnectionName: string;
  /** Target directory path. */
  targetPath: string;
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

const CreateItemDialog: React.FC<CreateItemDialogProps> = ({
  open,
  itemType,
  targetConnectionName,
  targetPath,
  isCreating,
  onClose,
  onConfirm,
  apiError,
}) => {
  const isDirectory = itemType === FileType.DIRECTORY;
  const title = isDirectory ? CREATE_ITEM_DIALOG_STRINGS.TITLE_DIRECTORY : CREATE_ITEM_DIALOG_STRINGS.TITLE_FILE;
  const targetDirectory = formatConnectionPath(targetConnectionName, targetPath);
  const description = (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      <Trans
        i18nKey={isDirectory ? "fileBrowser.createItem.promptDirectory" : "fileBrowser.createItem.promptFile"}
        values={{ directory: targetDirectory }}
        components={{ directory: <InlineItemName testId="create-item-prompt-directory" /> }}
      />
    </Typography>
  );

  return (
    <NameInputDialog
      open={open}
      title={title}
      description={description}
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
