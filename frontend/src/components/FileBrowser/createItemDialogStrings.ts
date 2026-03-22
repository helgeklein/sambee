//
// createItemDialogStrings
//

/**
 * Centralized strings for the Create Item Dialog.
 * Shared validation strings live in nameDialogStrings.ts.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const CREATE_ITEM_DIALOG_STRINGS = {
  // Dialog titles
  get TITLE_FILE() {
    return translate("fileBrowser.createItem.titleFile");
  },
  get TITLE_DIRECTORY() {
    return translate("fileBrowser.createItem.titleDirectory");
  },

  // Input label
  get INPUT_LABEL() {
    return translate("fileBrowser.createItem.inputLabel");
  },

  // Button labels
  get BUTTON_CREATE() {
    return translate("common.actions.create");
  },
  get BUTTON_CREATING() {
    return translate("fileBrowser.createItem.buttonCreating");
  },
};
