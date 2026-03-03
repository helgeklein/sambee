//
// copyMoveDialogStrings
//

/**
 * Centralized strings for the Copy/Move Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

export const COPY_MOVE_STRINGS = {
  // Dialog titles
  TITLE_COPY: "Copy",
  TITLE_MOVE: "Move",

  // Prompts (action text — destination is shown separately)
  PROMPT_COPY_SINGLE: "Copy 1 item to:",
  PROMPT_COPY_MULTI: (count: number) => `Copy ${count} items to:`,
  PROMPT_MOVE_SINGLE: "Move 1 item to:",
  PROMPT_MOVE_MULTI: (count: number) => `Move ${count} items to:`,

  // Labels
  LABEL_FILENAME: "File name",

  // Overwrite strategy (pre-flight choice for multi-file operations)
  OVERWRITE_STRATEGY_LABEL: "If files already exist:",
  OVERWRITE_STRATEGY_ASK: "Ask for each file",
  OVERWRITE_STRATEGY_REPLACE_ALL: "Replace all",
  OVERWRITE_STRATEGY_SKIP_ALL: "Skip all",

  // Warnings
  WARN_SAME_DIRECTORY: "Source and destination are the same directory.",
  WARN_EMPTY_FILENAME: "File name cannot be empty.",

  // Buttons
  BUTTON_CANCEL: "Cancel",
  BUTTON_COPY: "Copy",
  BUTTON_MOVE: "Move",
  BUTTON_COPYING: "Copying…",
  BUTTON_MOVING: "Moving…",

  // Progress
  PROGRESS_COPY: (current: number, total: number) => `Copying ${current} of ${total}…`,
  PROGRESS_MOVE: (current: number, total: number) => `Moving ${current} of ${total}…`,

  // Errors
  ERROR_GENERIC: "Operation failed. Some items may not have been processed.",
} as const;
