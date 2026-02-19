//
// createItemDialogStrings
//

/**
 * Centralized strings for the Create Item Dialog.
 * Shared validation strings live in nameDialogStrings.ts.
 * Kept in one place in preparation for future translation / i18n.
 */

export const CREATE_ITEM_DIALOG_STRINGS = {
  // Dialog titles
  TITLE_FILE: "New file",
  TITLE_DIRECTORY: "New directory",

  // Input label
  INPUT_LABEL: "Name",

  // Button labels
  BUTTON_CREATE: "Create",
  BUTTON_CREATING: "Creating…",
} as const;
