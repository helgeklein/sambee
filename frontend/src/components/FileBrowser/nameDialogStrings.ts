//
// nameDialogStrings
//

/**
 * Shared strings for name input dialogs (rename, create).
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const NAME_DIALOG_STRINGS = {
  // Validation messages (shared between rename and create)
  get VALIDATION_EMPTY() {
    return translate("fileBrowser.nameDialog.validationEmpty");
  },
  get VALIDATION_INVALID_CHARS() {
    return translate("fileBrowser.nameDialog.validationInvalidChars");
  },
  get VALIDATION_DOT_NAMES() {
    return translate("fileBrowser.nameDialog.validationDotNames");
  },
  get VALIDATION_TRAILING() {
    return translate("fileBrowser.nameDialog.validationTrailing");
  },

  // Button labels
  get BUTTON_CANCEL() {
    return translate("common.actions.cancel");
  },
};

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
