//
// confirmDeleteDialogStrings
//

/**
 * Centralized strings for the Confirm Delete Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

export const CONFIRM_DELETE_STRINGS = {
  // Dialog titles
  TITLE_FILE: "Delete file",
  TITLE_DIRECTORY: "Delete directory",

  // Confirmation prompt (itemName is interpolated by the component)
  CONFIRM_FILE: "Are you sure you want to delete the file",
  CONFIRM_DIRECTORY: "Are you sure you want to delete the directory",

  // Button labels
  BUTTON_CANCEL: "Cancel",
  BUTTON_DELETE: "Delete",
  BUTTON_DELETING: "Deleting…",
} as const;
