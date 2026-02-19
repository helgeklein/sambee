//
// nameDialogStrings
//

/**
 * Shared strings for name input dialogs (rename, create).
 * Kept in one place in preparation for future translation / i18n.
 */

export const NAME_DIALOG_STRINGS = {
  // Validation messages (shared between rename and create)
  VALIDATION_EMPTY: "Name must not be empty",
  VALIDATION_INVALID_CHARS: "Name contains invalid characters",
  VALIDATION_DOT_NAMES: "Name must not be '.' or '..'",
  VALIDATION_TRAILING: "Name must not end with a space or period",

  // Button labels
  BUTTON_CANCEL: "Cancel",
} as const;

// Characters forbidden in SMB/NTFS file names
export const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * Validate a file/directory name for SMB/NTFS compatibility.
 *
 * Returns an error message string if invalid, or null if valid.
 * This is the shared base validation — callers may add extra checks
 * (e.g. "name is unchanged" for rename).
 */
export function validateItemName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return NAME_DIALOG_STRINGS.VALIDATION_EMPTY;
  if (trimmed === "." || trimmed === "..") return NAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES;
  if (INVALID_NAME_CHARS.test(trimmed)) return NAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS;
  if (trimmed.endsWith(" ") || trimmed.endsWith(".")) return NAME_DIALOG_STRINGS.VALIDATION_TRAILING;
  return null;
}
