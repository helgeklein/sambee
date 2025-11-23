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

  //
  // Open/Select
  //
  OPEN: {
    id: "open",
    keys: "Enter",
    description: "Open",
    label: "Enter",
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
    keys: ["r", "R"],
    description: "Rotate right",
    label: "R",
  },
  ROTATE_LEFT: {
    id: "rotate-left",
    keys: ["r", "R"],
    description: "Rotate left",
    label: "Shift+R",
    shift: true,
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
  FOCUS_SEARCH: {
    id: "focus-search",
    keys: "/",
    description: "Focus search box",
    label: "/",
    allowInInput: true,
  },
  SHOW_HELP: {
    id: "show-help",
    keys: "?",
    description: "Show keyboard shortcuts",
    label: "?",
  },
  REFRESH: {
    id: "refresh",
    keys: "F5",
    description: "Refresh file list",
    label: "F5",
  },
  CLEAR_SELECTION: {
    id: "clear-selection",
    keys: "Escape",
    description: "Clear selection and search",
    label: "Esc",
  },
} as const satisfies Record<string, ShortcutDefinition>;
