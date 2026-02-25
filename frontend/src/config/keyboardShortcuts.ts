import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";

/**
 * Centralized keyboard shortcut definitions for all viewers
 * Includes both the key bindings and tooltip labels in one place
 */

/**
 * Create a shortcut definition
 * This is a helper to ensure type safety and provide defaults
 */
type ShortcutDefinition = Omit<KeyboardShortcut, "handler" | "enabled">;

/**
 * Common shortcuts used across all viewers
 */
export const COMMON_SHORTCUTS = {
  //
  // Open, close, download
  //
  OPEN: {
    id: "open",
    keys: "Enter",
    description: "Open",
    label: "Enter",
  },
  CLOSE: {
    id: "close",
    keys: "Escape",
    description: "Close",
    label: "Esc",
    allowInInput: true,
  },
  DOWNLOAD: {
    id: "download",
    keys: "d",
    description: "Download",
    label: "D",
  },

  //
  // Search
  //
  SEARCH: {
    id: "search",
    keys: "f",
    description: "Search",
    label: "Ctrl+F",
    ctrl: true,
    allowInInput: true,
  },
  NEXT_MATCH: {
    id: "next-match",
    keys: "F3",
    description: "Next match",
    label: "F3",
    allowInInput: true,
  },
  PREVIOUS_MATCH: {
    id: "previous-match",
    keys: "F3",
    description: "Previous match",
    label: "Shift+F3",
    shift: true,
    allowInInput: true,
  },

  //
  // Page navigation
  //
  FIRST_PAGE: {
    id: "first-page",
    keys: "Home",
    description: "First page",
    label: "Home",
  },
  LAST_PAGE: {
    id: "last-page",
    keys: "End",
    description: "Last page",
    label: "End",
  },
  PAGE_DOWN: {
    id: "page-down",
    keys: "PageDown",
    description: "Next page",
    label: "Page Down",
  },
  PAGE_UP: {
    id: "page-up",
    keys: "PageUp",
    description: "Previous page",
    label: "Page Up",
  },

  //
  // Navigation - Arrow keys
  //
  NEXT_ARROW: {
    id: "next-arrow",
    keys: "ArrowRight",
    description: "Next",
    label: "Right",
  },
  PREVIOUS_ARROW: {
    id: "previous-arrow",
    keys: "ArrowLeft",
    description: "Previous",
    label: "Left",
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Common viewer shortcuts shared across viewers
 */
export const VIEWER_SHORTCUTS = {
  //
  // Zoom
  //
  ZOOM_IN: {
    id: "zoom-in",
    keys: ["+"],
    description: "Zoom in",
    label: "+",
  },
  ZOOM_OUT: {
    id: "zoom-out",
    keys: ["-"],
    description: "Zoom out",
    label: "-",
  },
  ZOOM_RESET: {
    id: "zoom-reset",
    keys: "0",
    description: "Reset zoom",
    label: "0",
  },

  //
  // Rotation
  //
  ROTATE_RIGHT: {
    id: "rotate-right",
    keys: "r",
    description: "Rotate right",
    label: "R",
  },
  ROTATE_LEFT: {
    id: "rotate-left",
    keys: "R",
    description: "Rotate left",
    label: "Shift+R",
  },

  //
  // Fullscreen
  //
  FULLSCREEN: {
    id: "fullscreen",
    keys: ["f", "F"],
    description: "Toggle fullscreen",
    label: "F",
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * File browser specific shortcuts
 */
export const BROWSER_SHORTCUTS = {
  //
  // Navigation
  //
  NAVIGATE_UP: {
    id: "navigate-up",
    keys: "Backspace",
    description: "Go up one directory",
    label: "Backspace",
  },
  ARROW_DOWN: {
    id: "arrow-down",
    keys: "ArrowDown",
    description: "Navigate down",
    label: "Down",
  },
  ARROW_UP: {
    id: "arrow-up",
    keys: "ArrowUp",
    description: "Navigate up",
    label: "Up",
  },

  //
  // Actions
  //
  QUICK_NAVIGATE: {
    id: "quick-navigate",
    keys: "k",
    description: "Quick navigate to directory",
    label: "Ctrl+K",
    ctrl: true,
  },
  SHOW_HELP: {
    id: "show-help",
    keys: "?",
    description: "Show keyboard shortcuts",
    label: "?",
  },
  REFRESH: {
    id: "refresh",
    keys: "r",
    description: "Refresh file list",
    label: "Ctrl+R",
    ctrl: true,
  },
  DELETE_ITEM: {
    id: "delete-item",
    keys: "Delete",
    description: "Delete file or directory",
    label: "Del",
  },
  RENAME_ITEM: {
    id: "rename-item",
    keys: "F2",
    description: "Rename file or directory",
    label: "F2",
  },
  OPEN_IN_APP: {
    id: "open-in-app",
    keys: "Enter",
    description: "Open in companion app",
    label: "Ctrl+Enter",
    ctrl: true,
  },
  NEW_DIRECTORY: {
    id: "new-directory",
    keys: "F7",
    description: "Create new directory",
    label: "F7",
  },
  NEW_FILE: {
    id: "new-file",
    keys: "F7",
    description: "Create new file",
    label: "Shift+F7",
    shift: true,
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Selection shortcuts (Norton Commander style multi-select)
 */
export const SELECTION_SHORTCUTS = {
  TOGGLE_SELECTION: {
    id: "toggle-selection",
    keys: ["Insert", " "],
    description: "Toggle selection & move down",
    label: "Ins / Space",
  },
  SELECT_DOWN: {
    id: "select-down",
    keys: "ArrowDown",
    description: "Select & move down",
    label: "Shift+Down",
    shift: true,
  },
  SELECT_UP: {
    id: "select-up",
    keys: "ArrowUp",
    description: "Select & move up",
    label: "Shift+Up",
    shift: true,
  },
  SELECT_ALL: {
    id: "select-all",
    keys: "a",
    description: "Select all files",
    label: "Ctrl+A",
    ctrl: true,
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Copy / Move shortcuts (Norton Commander style, dual-pane)
 */
export const COPY_MOVE_SHORTCUTS = {
  COPY_TO_OTHER_PANE: {
    id: "copy-to-other",
    keys: "F5",
    description: "Copy to other pane",
    label: "F5",
  },
  MOVE_TO_OTHER_PANE: {
    id: "move-to-other",
    keys: "F6",
    description: "Move to other pane",
    label: "F6",
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Dual-pane layout shortcuts (Norton Commander style)
 */
export const PANE_SHORTCUTS = {
  TOGGLE_DUAL_PANE: {
    id: "toggle-dual-pane",
    keys: "b",
    description: "Toggle dual-pane view",
    label: "Ctrl+B",
    ctrl: true,
  },
  FOCUS_LEFT_PANE: {
    id: "focus-left-pane",
    keys: "1",
    description: "Focus left pane",
    label: "Ctrl+1",
    ctrl: true,
  },
  FOCUS_RIGHT_PANE: {
    id: "focus-right-pane",
    keys: "2",
    description: "Focus right pane",
    label: "Ctrl+2",
    ctrl: true,
  },
  SWITCH_PANE: {
    id: "switch-pane",
    keys: "Tab",
    description: "Switch active pane",
    label: "Tab",
  },
} as const satisfies Record<string, ShortcutDefinition>;
