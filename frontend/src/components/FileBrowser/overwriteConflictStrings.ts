//
// overwriteConflictStrings
//

/**
 * Centralized strings for the Overwrite Conflict Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

export const OVERWRITE_CONFLICT_STRINGS = {
  // Dialog title
  TITLE: (isDirectory: boolean) => (isDirectory ? "Folder already exists" : "File already exists"),

  // Info text
  ALREADY_EXISTS: (isDirectory: boolean) =>
    isDirectory ? "Folder already exists at the destination:" : "File already exists at the destination:",

  // Section header for metadata comparison
  LABEL_OPERATION: "Operation:",

  // Column headers
  LABEL_EXISTING: "Target",
  LABEL_INCOMING: "Source",

  // Buttons
  BUTTON_SKIP: "Skip",
  BUTTON_REPLACE: "Replace",

  // "Apply to all" checkbox
  APPLY_TO_ALL: "Apply to all remaining conflicts",

  // Progress context
  PROGRESS_CONTEXT: (current: number, total: number, conflicts: number) =>
    `Item ${current} of ${total} • ${conflicts} conflict${conflicts !== 1 ? "s" : ""} so far`,
} as const;
