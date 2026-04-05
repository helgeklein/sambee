import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";
import { translate } from "../i18n";

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
    get description() {
      return translate("viewer.shortcuts.open");
    },
    label: "Enter",
    helpGroup: "fileActions",
  },
  CLOSE: {
    id: "close",
    keys: "Escape",
    get description() {
      return translate("viewer.shortcuts.close");
    },
    label: "Esc",
    helpGroup: "general",
  },
  DOWNLOAD: {
    id: "download",
    keys: "d",
    get description() {
      return translate("viewer.shortcuts.download");
    },
    label: "D",
    helpGroup: "fileActions",
  },
  EDIT: {
    id: "edit",
    keys: "e",
    get description() {
      return translate("viewer.shortcuts.edit");
    },
    label: "E",
    helpGroup: "editing",
  },
  SAVE: {
    id: "save",
    keys: "s",
    get description() {
      return translate("viewer.shortcuts.save");
    },
    label: "Ctrl+S",
    helpGroup: "editing",
    ctrl: true,
    allowInInput: true,
  },

  //
  // Search
  //
  SEARCH: {
    id: "search",
    keys: "f",
    get description() {
      return translate("viewer.shortcuts.search");
    },
    label: "Ctrl+F",
    helpGroup: "search",
    ctrl: true,
    allowInInput: true,
  },
  NEXT_MATCH: {
    id: "next-match",
    keys: "F3",
    get description() {
      return translate("viewer.shortcuts.nextMatch");
    },
    label: "F3",
    helpGroup: "search",
    allowInInput: true,
  },
  PREVIOUS_MATCH: {
    id: "previous-match",
    keys: "F3",
    get description() {
      return translate("viewer.shortcuts.previousMatch");
    },
    label: "Shift+F3",
    helpGroup: "search",
    shift: true,
    allowInInput: true,
  },

  //
  // Page navigation
  //
  FIRST_PAGE: {
    id: "first-page",
    keys: "Home",
    get description() {
      return translate("viewer.shortcuts.firstPage");
    },
    label: "Home",
    helpGroup: "navigation",
  },
  LAST_PAGE: {
    id: "last-page",
    keys: "End",
    get description() {
      return translate("viewer.shortcuts.lastPage");
    },
    label: "End",
    helpGroup: "navigation",
  },
  PAGE_DOWN: {
    id: "page-down",
    keys: "PageDown",
    get description() {
      return translate("viewer.shortcuts.nextPage");
    },
    label: "Page Down",
    helpGroup: "navigation",
  },
  PAGE_UP: {
    id: "page-up",
    keys: "PageUp",
    get description() {
      return translate("viewer.shortcuts.previousPage");
    },
    label: "Page Up",
    helpGroup: "navigation",
  },

  //
  // Navigation - Arrow keys
  //
  NEXT_ARROW: {
    id: "next-arrow",
    keys: "ArrowRight",
    get description() {
      return translate("viewer.shortcuts.next");
    },
    label: "Right",
    helpGroup: "navigation",
  },
  PREVIOUS_ARROW: {
    id: "previous-arrow",
    keys: "ArrowLeft",
    get description() {
      return translate("viewer.shortcuts.previous");
    },
    label: "Left",
    helpGroup: "navigation",
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
    get description() {
      return translate("viewer.shortcuts.zoomIn");
    },
    label: "+",
    helpGroup: "view",
  },
  ZOOM_OUT: {
    id: "zoom-out",
    keys: ["-"],
    get description() {
      return translate("viewer.shortcuts.zoomOut");
    },
    label: "-",
    helpGroup: "view",
  },
  ZOOM_RESET: {
    id: "zoom-reset",
    keys: "0",
    get description() {
      return translate("viewer.shortcuts.resetZoom");
    },
    label: "0",
    helpGroup: "view",
  },

  //
  // Rotation
  //
  ROTATE_RIGHT: {
    id: "rotate-right",
    keys: "r",
    get description() {
      return translate("viewer.shortcuts.rotateRight");
    },
    label: "R",
    helpGroup: "view",
  },
  ROTATE_LEFT: {
    id: "rotate-left",
    keys: "R",
    get description() {
      return translate("viewer.shortcuts.rotateLeft");
    },
    label: "Shift+R",
    helpGroup: "view",
  },

  //
  // Fullscreen
  //
  FULLSCREEN: {
    id: "fullscreen",
    keys: ["f", "F"],
    get description() {
      return translate("viewer.shortcuts.toggleFullscreen");
    },
    label: "F",
    helpGroup: "view",
  },
} as const satisfies Record<string, ShortcutDefinition>;

export const MARKDOWN_EDITOR_SHORTCUTS = {
  CREATE_LINK: {
    id: "markdown-create-link",
    keys: ["k", "K"],
    ctrl: true,
    allowInInput: true,
    get description() {
      return translate("viewer.shortcuts.createLink");
    },
    label: "Ctrl+K",
    helpGroup: "editing",
  },
  INSERT_TABLE: {
    id: "markdown-insert-table",
    keys: ["t", "T"],
    ctrl: true,
    alt: true,
    allowInInput: true,
    get description() {
      return translate("viewer.shortcuts.insertTable");
    },
    label: "Ctrl+Alt+T",
    helpGroup: "editing",
  },
  INSERT_THEMATIC_BREAK: {
    id: "markdown-insert-thematic-break",
    keys: ["h", "H"],
    ctrl: true,
    alt: true,
    allowInInput: true,
    get description() {
      return translate("viewer.shortcuts.insertThematicBreak");
    },
    label: "Ctrl+Alt+H",
    helpGroup: "editing",
  },
  INLINE_CODE: {
    id: "markdown-inline-code",
    keys: ["e", "E"],
    ctrl: true,
    allowInInput: true,
    get description() {
      return translate("viewer.shortcuts.inlineCode");
    },
    label: "Ctrl+E",
    helpGroup: "editing",
  },
  CODE_BLOCK: {
    id: "markdown-code-block",
    keys: ["e", "E"],
    ctrl: true,
    shift: true,
    allowInInput: true,
    priority: 1,
    get description() {
      return translate("viewer.shortcuts.insertCodeBlock");
    },
    label: "Ctrl+Shift+E",
    helpGroup: "editing",
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
    get description() {
      return translate("fileBrowser.shortcuts.navigateUp");
    },
    label: "Backspace",
    helpGroup: "navigation",
  },
  ARROW_DOWN: {
    id: "arrow-down",
    keys: "ArrowDown",
    get description() {
      return translate("fileBrowser.shortcuts.navigateDown");
    },
    label: "Down",
    helpGroup: "navigation",
  },
  ARROW_UP: {
    id: "arrow-up",
    keys: "ArrowUp",
    get description() {
      return translate("fileBrowser.shortcuts.navigateUpRow");
    },
    label: "Up",
    helpGroup: "navigation",
  },

  //
  // Actions
  //
  QUICK_NAVIGATE: {
    id: "quick-navigate",
    keys: "k",
    get description() {
      return translate("fileBrowser.shortcuts.openSmartNavigation");
    },
    label: "Ctrl+K",
    helpGroup: "search",
    ctrl: true,
    allowInInput: true,
  },
  QUICK_NAVIGATE_LEGACY: {
    id: "quick-navigate-legacy",
    keys: "k",
    get description() {
      return translate("fileBrowser.shortcuts.openQuickNavigation");
    },
    label: "Ctrl+K",
    helpGroup: "search",
    ctrl: true,
    allowInInput: true,
  },
  FILTER_CURRENT_DIRECTORY: {
    id: "filter-current-directory",
    keys: "f",
    get description() {
      return translate("fileBrowser.shortcuts.filterCurrentDirectory");
    },
    label: "Ctrl+Alt+F",
    helpGroup: "search",
    ctrl: true,
    alt: true,
    allowInInput: true,
  },
  COMMAND_PALETTE: {
    id: "command-palette",
    keys: "p",
    get description() {
      return translate("fileBrowser.shortcuts.showCommands");
    },
    label: "Ctrl+P",
    helpGroup: "search",
    ctrl: true,
    allowInInput: true,
  },
  COMMAND_PALETTE_ALTERNATE: {
    id: "command-palette-alternate",
    keys: "F1",
    get description() {
      return translate("fileBrowser.shortcuts.showCommands");
    },
    label: "F1",
    helpGroup: "search",
    allowInInput: true,
  },
  FOCUS_CONNECTION_SELECTOR: {
    id: "focus-connection-selector",
    keys: "ArrowDown",
    get description() {
      return translate("fileBrowser.shortcuts.openConnectionSelector");
    },
    label: "Ctrl+Down",
    helpGroup: "navigation",
    ctrl: true,
    allowInInput: true,
  },
  OPEN_SETTINGS: {
    id: "open-settings",
    keys: ",",
    get description() {
      return translate("fileBrowser.shortcuts.openSettings");
    },
    label: "Ctrl+,",
    helpGroup: "general",
    ctrl: true,
    allowInInput: true,
  },
  SHOW_HELP: {
    id: "show-help",
    keys: "?",
    get description() {
      return translate("fileBrowser.shortcuts.showHelp");
    },
    label: "?",
    helpGroup: "general",
  },
  REFRESH: {
    id: "refresh",
    keys: "r",
    get description() {
      return translate("fileBrowser.shortcuts.refresh");
    },
    label: "Ctrl+R",
    helpGroup: "general",
    ctrl: true,
  },
  DELETE_ITEM: {
    id: "delete-item",
    keys: "Delete",
    get description() {
      return translate("fileBrowser.shortcuts.deleteItem");
    },
    label: "Del",
    helpGroup: "fileActions",
  },
  RENAME_ITEM: {
    id: "rename-item",
    keys: "F2",
    get description() {
      return translate("fileBrowser.shortcuts.renameItem");
    },
    label: "F2",
    helpGroup: "fileActions",
  },
  OPEN_IN_APP: {
    id: "open-in-app",
    keys: "Enter",
    get description() {
      return translate("fileBrowser.shortcuts.openInCompanion");
    },
    label: "Ctrl+Enter",
    helpGroup: "fileActions",
    ctrl: true,
  },
  NEW_DIRECTORY: {
    id: "new-directory",
    keys: "F7",
    get description() {
      return translate("fileBrowser.shortcuts.createDirectory");
    },
    label: "F7",
    helpGroup: "fileActions",
  },
  NEW_FILE: {
    id: "new-file",
    keys: "F7",
    get description() {
      return translate("fileBrowser.shortcuts.createFile");
    },
    label: "Shift+F7",
    helpGroup: "fileActions",
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
    get description() {
      return translate("fileBrowser.shortcuts.toggleSelectionAndMoveDown");
    },
    label: "Ins / Space",
    helpGroup: "selection",
  },
  SELECT_DOWN: {
    id: "select-down",
    keys: "ArrowDown",
    get description() {
      return translate("fileBrowser.shortcuts.selectAndMoveDown");
    },
    label: "Shift+Down",
    helpGroup: "selection",
    shift: true,
  },
  SELECT_UP: {
    id: "select-up",
    keys: "ArrowUp",
    get description() {
      return translate("fileBrowser.shortcuts.selectAndMoveUp");
    },
    label: "Shift+Up",
    helpGroup: "selection",
    shift: true,
  },
  SELECT_ALL: {
    id: "select-all",
    keys: "a",
    get description() {
      return translate("fileBrowser.shortcuts.selectAllFiles");
    },
    label: "Ctrl+A",
    helpGroup: "selection",
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
    get description() {
      return translate("fileBrowser.shortcuts.copyToOtherPane");
    },
    label: "F5",
    helpGroup: "panes",
  },
  MOVE_TO_OTHER_PANE: {
    id: "move-to-other",
    keys: "F6",
    get description() {
      return translate("fileBrowser.shortcuts.moveToOtherPane");
    },
    label: "F6",
    helpGroup: "panes",
  },
} as const satisfies Record<string, ShortcutDefinition>;

/**
 * Dual-pane layout shortcuts (Norton Commander style)
 */
export const PANE_SHORTCUTS = {
  TOGGLE_DUAL_PANE: {
    id: "toggle-dual-pane",
    keys: "b",
    get description() {
      return translate("fileBrowser.shortcuts.toggleDualPane");
    },
    label: "Ctrl+B",
    helpGroup: "panes",
    ctrl: true,
    allowInInput: true,
  },
  FOCUS_LEFT_PANE: {
    id: "focus-left-pane",
    keys: "1",
    get description() {
      return translate("fileBrowser.shortcuts.focusLeftPane");
    },
    label: "Ctrl+1",
    helpGroup: "panes",
    ctrl: true,
  },
  FOCUS_RIGHT_PANE: {
    id: "focus-right-pane",
    keys: "2",
    get description() {
      return translate("fileBrowser.shortcuts.focusRightPane");
    },
    label: "Ctrl+2",
    helpGroup: "panes",
    ctrl: true,
  },
  SWITCH_PANE: {
    id: "switch-pane",
    keys: "Tab",
    get description() {
      return translate("fileBrowser.shortcuts.switchActivePane");
    },
    label: "Tab",
    helpGroup: "panes",
  },
} as const satisfies Record<string, ShortcutDefinition>;
