import {
  clampResizableDialogSize,
  getResizableDialogMaximumSize,
  RESIZABLE_DIALOG_VIEWPORT_GUTTER_PX,
  type ResizableDialogConfig,
  type ResizableDialogSize,
  type ResizableDialogViewport,
  readResizableDialogSize,
  writeResizableDialogSize,
} from "../ResizableDialog";

export const SETTINGS_DIALOG_SIZE_STORAGE_KEY = "settings-dialog-size";
export const SETTINGS_DIALOG_DEFAULT_MAX_HEIGHT_PX = 1200;
export const SETTINGS_DIALOG_GUTTER_PX = RESIZABLE_DIALOG_VIEWPORT_GUTTER_PX;
export const SETTINGS_DIALOG_RESIZE_CONFIG = {
  storageKey: SETTINGS_DIALOG_SIZE_STORAGE_KEY,
  minWidth: 900,
  minHeight: 600,
  maxWidth: 1200,
} satisfies ResizableDialogConfig;

export type SettingsDialogSize = ResizableDialogSize;
export type ViewportSize = ResizableDialogViewport;

export function getSettingsDialogMaximumSize(viewport: ViewportSize): SettingsDialogSize {
  return getResizableDialogMaximumSize(SETTINGS_DIALOG_RESIZE_CONFIG, viewport);
}

export function clampSettingsDialogSize(preferredSize: SettingsDialogSize, viewport: ViewportSize): SettingsDialogSize {
  return clampResizableDialogSize(SETTINGS_DIALOG_RESIZE_CONFIG, preferredSize, viewport);
}

export function readSettingsDialogSize(): SettingsDialogSize | null {
  return readResizableDialogSize(SETTINGS_DIALOG_SIZE_STORAGE_KEY);
}

export function writeSettingsDialogSize(size: SettingsDialogSize): void {
  writeResizableDialogSize(SETTINGS_DIALOG_SIZE_STORAGE_KEY, size);
}
