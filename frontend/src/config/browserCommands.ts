import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";
import { translate } from "../i18n";

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
  openConnectionsSettings: () => void;
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

interface BrowserCommandTemplate {
  id: string;
  titleKey: string;
  categoryKey: string;
  descriptionKey?: string;
  keywords?: string[];
  defaultShortcutIds?: string[];
  shortcutLabel?: string;
  selectionFocusTarget?: "file-list" | "quick-bar" | "none";
  isEnabled: (context: BrowserCommandContext) => boolean;
  run: (context: BrowserCommandContext) => void;
}

function createCommand(definition: BrowserCommandTemplate): BrowserCommandTemplate {
  return definition;
}

const BROWSER_COMMANDS = [
  createCommand({
    id: "browser.quickNav",
    titleKey: "fileBrowser.commands.items.quickNav.title",
    categoryKey: "fileBrowser.commands.categories.navigation",
    descriptionKey: "fileBrowser.commands.items.quickNav.description",
    keywords: ["smart", "navigation", "directory", "jump", "path"],
    defaultShortcutIds: ["quick-navigate"],
    shortcutLabel: "Ctrl+K",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => context.connectionSelected && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openQuickNav(),
  }),
  createCommand({
    id: "browser.filterCurrentDirectory",
    titleKey: "fileBrowser.commands.items.filterCurrentDirectory.title",
    categoryKey: "fileBrowser.commands.categories.navigation",
    descriptionKey: "fileBrowser.commands.items.filterCurrentDirectory.description",
    keywords: ["filter", "find", "current", "directory", "files"],
    defaultShortcutIds: ["filter-current-directory"],
    shortcutLabel: "Ctrl+Alt+F",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => context.connectionSelected && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openFilterMode(),
  }),
  createCommand({
    id: "browser.commandPalette",
    titleKey: "fileBrowser.commands.items.commandPalette.title",
    categoryKey: "fileBrowser.commands.categories.navigation",
    descriptionKey: "fileBrowser.commands.items.commandPalette.description",
    keywords: ["command", "palette", "actions", "f1", ">"],
    defaultShortcutIds: ["command-palette", "command-palette-alternate"],
    shortcutLabel: "Ctrl+P / F1",
    selectionFocusTarget: "quick-bar",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.openCommandMode(),
  }),
  createCommand({
    id: "browser.open",
    titleKey: "fileBrowser.commands.items.open.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["open", "enter"],
    defaultShortcutIds: ["open"],
    shortcutLabel: "Enter",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.openFocusedItem(),
  }),
  createCommand({
    id: "browser.navigateUp",
    titleKey: "fileBrowser.commands.items.navigateUp.title",
    categoryKey: "fileBrowser.commands.categories.navigation",
    keywords: ["parent", "up", "backspace"],
    defaultShortcutIds: ["navigate-up"],
    shortcutLabel: "Backspace",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.navigateUp(),
  }),
  createCommand({
    id: "browser.refresh",
    titleKey: "fileBrowser.commands.items.refresh.title",
    categoryKey: "fileBrowser.commands.categories.view",
    keywords: ["reload", "refresh"],
    defaultShortcutIds: ["refresh"],
    shortcutLabel: "Ctrl+R",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.refresh(),
  }),
  createCommand({
    id: "browser.rename",
    titleKey: "fileBrowser.commands.items.rename.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["rename", "f2"],
    defaultShortcutIds: ["rename-item"],
    shortcutLabel: "F2",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.renameFocusedItem(),
  }),
  createCommand({
    id: "browser.delete",
    titleKey: "fileBrowser.commands.items.delete.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["delete", "remove", "del"],
    defaultShortcutIds: ["delete-item"],
    shortcutLabel: "Del",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.deleteFocusedItem(),
  }),
  createCommand({
    id: "browser.newDirectory",
    titleKey: "fileBrowser.commands.items.newDirectory.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["mkdir", "folder", "directory"],
    defaultShortcutIds: ["new-directory"],
    shortcutLabel: "F7",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.newDirectory(),
  }),
  createCommand({
    id: "browser.newFile",
    titleKey: "fileBrowser.commands.items.newFile.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["file", "create"],
    defaultShortcutIds: ["new-file"],
    shortcutLabel: "Shift+F7",
    isEnabled: (context) => context.connectionSelected,
    run: (context) => context.newFile(),
  }),
  createCommand({
    id: "browser.openInApp",
    titleKey: "fileBrowser.commands.items.openInApp.title",
    categoryKey: "fileBrowser.commands.categories.files",
    keywords: ["companion", "open in app", "ctrl enter"],
    defaultShortcutIds: ["open-in-app"],
    shortcutLabel: "Ctrl+Enter",
    isEnabled: (context) => context.hasFocusedFile,
    run: (context) => context.openInApp(),
  }),
  createCommand({
    id: "browser.toggleDualPane",
    titleKey: "fileBrowser.commands.items.toggleDualPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["dual", "pane", "layout"],
    defaultShortcutIds: ["toggle-dual-pane"],
    shortcutLabel: "Ctrl+B",
    isEnabled: (context) => !context.useCompactLayout && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.toggleDualPane(),
  }),
  createCommand({
    id: "browser.focusLeftPane",
    titleKey: "fileBrowser.commands.items.focusLeftPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["left", "pane", "focus"],
    defaultShortcutIds: ["focus-left-pane"],
    shortcutLabel: "Ctrl+1",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.focusLeftPane(),
  }),
  createCommand({
    id: "browser.focusRightPane",
    titleKey: "fileBrowser.commands.items.focusRightPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["right", "pane", "focus"],
    defaultShortcutIds: ["focus-right-pane"],
    shortcutLabel: "Ctrl+2",
    isEnabled: (context) => !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.focusRightPane(),
  }),
  createCommand({
    id: "browser.switchPane",
    titleKey: "fileBrowser.commands.items.switchPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["tab", "pane", "switch"],
    defaultShortcutIds: ["switch-pane"],
    shortcutLabel: "Tab",
    isEnabled: (context) => context.isDualMode && !context.settingsOpen && !context.mobileSettingsOpen,
    run: (context) => context.switchPane(),
  }),
  createCommand({
    id: "browser.copyToOtherPane",
    titleKey: "fileBrowser.commands.items.copyToOtherPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["copy", "f5"],
    defaultShortcutIds: ["copy-to-other"],
    shortcutLabel: "F5",
    isEnabled: (context) => context.isDualMode,
    run: (context) => context.copyToOtherPane(),
  }),
  createCommand({
    id: "browser.moveToOtherPane",
    titleKey: "fileBrowser.commands.items.moveToOtherPane.title",
    categoryKey: "fileBrowser.commands.categories.panes",
    keywords: ["move", "f6"],
    defaultShortcutIds: ["move-to-other"],
    shortcutLabel: "F6",
    isEnabled: (context) => context.isDualMode,
    run: (context) => context.moveToOtherPane(),
  }),
  createCommand({
    id: "browser.openSettings",
    titleKey: "fileBrowser.commands.items.openSettings.title",
    categoryKey: "fileBrowser.commands.categories.settings",
    keywords: ["settings", "preferences", "config"],
    defaultShortcutIds: ["open-settings"],
    shortcutLabel: "Ctrl+,",
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openSettings(),
  }),
  createCommand({
    id: "browser.openConnectionsSettings",
    titleKey: "fileBrowser.commands.items.openConnectionsSettings.title",
    categoryKey: "fileBrowser.commands.categories.settings",
    keywords: ["connections", "connection settings", "shares", "companion", "local drive", "drives"],
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openConnectionsSettings(),
  }),
  createCommand({
    id: "browser.showHelp",
    titleKey: "fileBrowser.commands.items.showHelp.title",
    categoryKey: "fileBrowser.commands.categories.help",
    keywords: ["help", "shortcuts", "keyboard", "?"],
    defaultShortcutIds: ["show-help"],
    shortcutLabel: "?",
    selectionFocusTarget: "none",
    isEnabled: () => true,
    run: (context) => context.openHelp(),
  }),
] as const satisfies readonly BrowserCommandTemplate[];

function localizeCommand(definition: BrowserCommandTemplate): BrowserCommandDefinition {
  return {
    id: definition.id,
    title: translate(definition.titleKey),
    category: translate(definition.categoryKey),
    description: definition.descriptionKey ? translate(definition.descriptionKey) : undefined,
    keywords: definition.keywords,
    defaultShortcutIds: definition.defaultShortcutIds,
    shortcutLabel: definition.shortcutLabel,
    selectionFocusTarget: definition.selectionFocusTarget,
    isEnabled: definition.isEnabled,
    run: definition.run,
  };
}

export function getEnabledBrowserCommands(context: BrowserCommandContext): BrowserCommandDefinition[] {
  return BROWSER_COMMANDS.filter((command) => command.isEnabled(context)).map(localizeCommand);
}

export type BrowserCommand = BrowserCommandDefinition;

export function toShortcutMap(shortcuts: KeyboardShortcut[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const shortcut of shortcuts) {
    map.set(shortcut.id, shortcut.label ?? shortcut.keys.toString());
  }
  return map;
}
