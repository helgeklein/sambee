//
// renameDialogStrings
//

/**
 * Centralized strings for the Rename Dialog.
 * Shared validation strings live in nameDialogStrings.ts.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const RENAME_DIALOG_STRINGS = {
  // Dialog titles
  get TITLE_FILE() {
    return translate("fileBrowser.rename.titleFile");
  },
  get TITLE_DIRECTORY() {
    return translate("fileBrowser.rename.titleDirectory");
  },

  // Input label
  get INPUT_LABEL() {
    return translate("fileBrowser.rename.inputLabel");
  },

  // Rename-specific validation
  get VALIDATION_SAME() {
    return translate("fileBrowser.rename.validationSame");
  },

  // Button labels
  get BUTTON_RENAME() {
    return translate("common.actions.rename");
  },
  get BUTTON_RENAMING() {
    return translate("fileBrowser.rename.buttonRenaming");
  },
};
