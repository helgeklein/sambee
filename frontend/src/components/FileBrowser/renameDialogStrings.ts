//
// renameDialogStrings
//

/**
 * Centralized strings for the Rename Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

export const RENAME_DIALOG_STRINGS = {
  // Dialog titles
  TITLE_FILE: "Rename file",
  TITLE_DIRECTORY: "Rename directory",

  // Input label
  INPUT_LABEL: "New name",

  // Validation messages
  VALIDATION_EMPTY: "Name must not be empty",
  VALIDATION_SAME: "Name is unchanged",
  VALIDATION_INVALID_CHARS: "Name contains invalid characters",
  VALIDATION_DOT_NAMES: "Name must not be '.' or '..'",
  VALIDATION_TRAILING: "Name must not end with a space or period",

  // Button labels
  BUTTON_CANCEL: "Cancel",
  BUTTON_RENAME: "Rename",
  BUTTON_RENAMING: "Renaming…",
} as const;
