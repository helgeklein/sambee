//
// renameDialogStrings
//

/**
 * Centralized strings for the Rename Dialog.
 * Shared validation strings live in nameDialogStrings.ts.
 * Kept in one place in preparation for future translation / i18n.
 */

export const RENAME_DIALOG_STRINGS = {
  // Dialog titles
  TITLE_FILE: "Rename file",
  TITLE_DIRECTORY: "Rename directory",

  // Input label
  INPUT_LABEL: "New name",

  // Rename-specific validation
  VALIDATION_SAME: "Name is unchanged",

  // Button labels
  BUTTON_RENAME: "Rename",
  BUTTON_RENAMING: "Renaming…",
} as const;
