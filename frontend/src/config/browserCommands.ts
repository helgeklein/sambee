import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";

export interface BrowserCommandContext {
  isDualMode: boolean;
  useCompactLayout: boolean;
  settingsOpen: boolean;
  mobileSettingsOpen: boolean;
  helpOpen: boolean;
  quickBarMode: "smart" | "commands" | "filter";
  hasFiles: boolean;
  hasFocusedFile: boolean;
  connectionSelected: boolean;
  openQuickNav: () => void;
  openFilterMode: () => void;
  openCommandMode: () => void;
  openSettings: () => void;
  openLocalDriveSettings: () => void;
  openHelp: () => void;
  refresh: () => void;
  navigateUp: () => void;
  openFocusedItem: () => void;
  renameFocusedItem: () => void;
  deleteFocusedItem: () => void;
  newDirectory: () => void;
  newFile: () => void;
  openInApp: () => void;
  toggleDualPane: () => void;
  focusLeftPane: () => void;
  focusRightPane: () => void;
  switchPane: () => void;
  copyToOtherPane: () => void;
  moveToOtherPane: () => void;
}

export interface BrowserCommandDefinition {
  id: string;
  title: string;
  category: string;
  description?: string;
  keywords?: string[];
  defaultShortcutIds?: string[];
  shortcutLabel?: string;
  selectionFocusTarget?: "file-list" | "quick-bar" | "none";
  isEnabled: (context: BrowserCommandContext) => boolean;
  run: (context: BrowserCommandContext) => void;
}

function createCommand(definition: BrowserCommandDefinition): BrowserCommandDefinition {
  return definition;
}

export const BROWSER_COMMANDS = [
  createCommand({
    id: "browser.quickNav",
    title: "Open Smart Navigation",
    category: "Navigation",
    description: "Jump to directories from the smart navigation bar",
    keywords: ["smart", "navigation", "directory", "jump", "path"],
    defaultShortcutIds: ["quick-navigate"],
    shortcutLabel: "Ctrl+K",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => context.connectionSelected && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openQuickNav(),
  }),
  createCommand({
    id: "browser.filterCurrentDirectory",
    title: "Filter Current Directory",
    category: "Navigation",
    description: "Filter the active pane's file list",
    keywords: ["filter", "find", "current", "directory", "files"],
    defaultShortcutIds: ["filter-current-directory"],
    shortcutLabel: "Ctrl+Alt+F",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => context.connectionSelected && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openFilterMode(),
  }),
  createCommand({
    id: "browser.commandPalette",
    title: "Show Commands",
    category: "Navigation",
    description: "Open the file browser command palette",
    keywords: ["command", "palette", "actions", "f1", ">"],
    defaultShortcutIds: ["command-palette", "command-palette-alternate"],
    shortcutLabel: "Ctrl+P / F1",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openCommandMode(),
  }),
  createCommand({
    id: "browser.open",
    title: "Open Focused Item",
    category: "Files",
    keywords: ["open", "enter"],
    defaultShortcutIds: ["open"],
    shortcutLabel: "Enter",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.openFocusedItem(),
  }),
  createCommand({
    id: "browser.navigateUp",
    title: "Go Up One Directory",
    category: "Navigation",
    keywords: ["parent", "up", "backspace"],
    defaultShortcutIds: ["navigate-up"],
    shortcutLabel: "Backspace",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.navigateUp(),
  }),
  createCommand({
    id: "browser.refresh",
    title: "Refresh File List",
    category: "View",
    keywords: ["reload", "refresh"],
    defaultShortcutIds: ["refresh"],
    shortcutLabel: "Ctrl+R",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.refresh(),
  }),
  createCommand({
    id: "browser.rename",
    title: "Rename Focused Item",
    category: "Files",
    keywords: ["rename", "f2"],
    defaultShortcutIds: ["rename-item"],
    shortcutLabel: "F2",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.renameFocusedItem(),
  }),
  createCommand({
    id: "browser.delete",
    title: "Delete Focused Item",
    category: "Files",
    keywords: ["delete", "remove", "del"],
    defaultShortcutIds: ["delete-item"],
    shortcutLabel: "Del",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.deleteFocusedItem(),
  }),
  createCommand({
    id: "browser.newDirectory",
    title: "Create New Directory",
    category: "Files",
    keywords: ["mkdir", "folder", "directory"],
    defaultShortcutIds: ["new-directory"],
    shortcutLabel: "F7",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.newDirectory(),
  }),
  createCommand({
    id: "browser.newFile",
    title: "Create New File",
    category: "Files",
    keywords: ["file", "create"],
    defaultShortcutIds: ["new-file"],
    shortcutLabel: "Shift+F7",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.newFile(),
  }),
  createCommand({
    id: "browser.openInApp",
    title: "Open Focused File In Companion App",
    category: "Files",
    keywords: ["companion", "open in app", "ctrl enter"],
    defaultShortcutIds: ["open-in-app"],
    shortcutLabel: "Ctrl+Enter",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.openInApp(),
  }),
  createCommand({
    id: "browser.toggleDualPane",
    title: "Toggle Dual-Pane View",
    category: "Panes",
    keywords: ["dual", "pane", "layout"],
    defaultShortcutIds: ["toggle-dual-pane"],
    shortcutLabel: "Ctrl+B",
    isEnabled: (context) => !context.useCompactLayout && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.toggleDualPane(),
  }),
  createCommand({
    id: "browser.focusLeftPane",
    title: "Focus Left Pane",
    category: "Panes",
    keywords: ["left", "pane", "focus"],
    defaultShortcutIds: ["focus-left-pane"],
    shortcutLabel: "Ctrl+1",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.focusLeftPane(),
  }),
  createCommand({
    id: "browser.focusRightPane",
    title: "Focus Right Pane",
    category: "Panes",
    keywords: ["right", "pane", "focus"],
    defaultShortcutIds: ["focus-right-pane"],
    shortcutLabel: "Ctrl+2",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.focusRightPane(),
  }),
  createCommand({
    id: "browser.switchPane",
    title: "Switch Active Pane",
    category: "Panes",
    keywords: ["tab", "pane", "switch"],
    defaultShortcutIds: ["switch-pane"],
    shortcutLabel: "Tab",
    isEnabled: (context) => context.isDualMode && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.switchPane(),
  }),
  createCommand({
    id: "browser.copyToOtherPane",
    title: "Copy To Other Pane",
    category: "Panes",
    keywords: ["copy", "f5"],
    defaultShortcutIds: ["copy-to-other"],
    shortcutLabel: "F5",
    isEnabled: (context) => context.isDualMode,
    run: (context) => context.copyToOtherPane(),
  }),
  createCommand({
    id: "browser.moveToOtherPane",
    title: "Move To Other Pane",
    category: "Panes",
    keywords: ["move", "f6"],
    defaultShortcutIds: ["move-to-other"],
    shortcutLabel: "F6",
    isEnabled: (context) => context.isDualMode,
    run: (context) => context.moveToOtherPane(),
  }),
  createCommand({
    id: "browser.openSettings",
    title: "Open Settings",
    category: "Settings",
    keywords: ["settings", "preferences", "config"],
    defaultShortcutIds: ["open-settings"],
    shortcutLabel: "Ctrl+,",
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openSettings(),
  }),
  createCommand({
    id: "browser.openLocalDriveSettings",
    title: "Open Local Drive Settings",
    category: "Settings",
    keywords: ["companion", "local drive", "drives"],
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openLocalDriveSettings(),
  }),
  createCommand({
    id: "browser.showHelp",
    title: "Show Keyboard Shortcuts",
    category: "Help",
    keywords: ["help", "shortcuts", "keyboard", "?"],
    defaultShortcutIds: ["show-help"],
    shortcutLabel: "?",
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openHelp(),
  }),
] as const satisfies readonly BrowserCommandDefinition[];

export function getEnabledBrowserCommands(context: BrowserCommandContext): BrowserCommandDefinition[] {
  return BROWSER_COMMANDS.filter((command) => command.isEnabled(context));
}

export type BrowserCommand = (typeof BROWSER_COMMANDS)[number];

export function toShortcutMap(shortcuts: KeyboardShortcut[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const shortcut of shortcuts) {
    map.set(shortcut.id, shortcut.label ?? shortcut.keys.toString());
  }
  return map;
}
