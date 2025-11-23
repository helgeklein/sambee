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
    keys: "s",
    description: "Download",
    label: "Ctrl+S",
    ctrl: true,
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * PDF Viewer specific shortcuts
 */
export const PDF_SHORTCUTS = {
  // Search
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

  // Navigation
  NEXT_PAGE_ARROW: {
    id: "next-page-arrow",
    keys: "ArrowRight",
    description: "Next page",
    label: "Right / D",
  },
  NEXT_PAGE_KEYS: {
    id: "next-page-keys",
    keys: ["d", "D"],
    description: "Next page",
    label: "Right / D",
  },
  PREVIOUS_PAGE_ARROW: {
    id: "previous-page-arrow",
    keys: "ArrowLeft",
    description: "Previous page",
    label: "Left / A",
  },
  PREVIOUS_PAGE_KEYS: {
    id: "previous-page-keys",
    keys: ["a", "A"],
    description: "Previous page",
    label: "Left / A",
  },
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

  // Zoom
  ZOOM_IN: {
    id: "zoom-in",
    keys: ["+", "="],
    description: "Zoom in",
    label: "+ / =",
  },
  ZOOM_OUT: {
    id: "zoom-out",
    keys: ["-", "_"],
    description: "Zoom out",
    label: "- / _",
  },

  // Rotation
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
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Image Viewer specific shortcuts
 */
export const IMAGE_SHORTCUTS = {
  // Navigation
  NEXT_IMAGE_ARROW: {
    id: "next-image-arrow",
    keys: "ArrowRight",
    description: "Next image",
    label: "Right / D",
  },
  NEXT_IMAGE_KEYS: {
    id: "next-image-keys",
    keys: ["d", "D"],
    description: "Next image",
    label: "Right / D",
  },
  PREVIOUS_IMAGE_ARROW: {
    id: "previous-image-arrow",
    keys: "ArrowLeft",
    description: "Previous image",
    label: "Left / A",
  },
  PREVIOUS_IMAGE_KEYS: {
    id: "previous-image-keys",
    keys: ["a", "A"],
    description: "Previous image",
    label: "Left / A",
  },

  // Zoom
  ZOOM_IN: {
    id: "zoom-in",
    keys: ["+", "="],
    description: "Zoom in",
    label: "+ / =",
  },
  ZOOM_OUT: {
    id: "zoom-out",
    keys: ["-", "_"],
    description: "Zoom out",
    label: "- / _",
  },
  ZOOM_RESET: {
    id: "zoom-reset",
    keys: "0",
    description: "Reset zoom",
    label: "0",
  },

  // Rotation
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
} as const satisfies Record<string, ShortcutDefinition>;
