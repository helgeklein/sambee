import type { FileEntry } from "../types";

const WINDOWS_SHORTCUT_EXTENSION = ".lnk";

/** Identifies explicit local links and Windows shortcuts discovered from their filename. */
export function isShortcutFile(file: FileEntry): boolean {
  return file.link_kind !== undefined || file.name.toLowerCase().endsWith(WINDOWS_SHORTCUT_EXTENSION);
}
