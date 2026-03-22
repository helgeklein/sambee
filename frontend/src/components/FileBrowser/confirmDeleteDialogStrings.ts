//
// confirmDeleteDialogStrings
//

/**
 * Centralized strings for the Confirm Delete Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const CONFIRM_DELETE_STRINGS = {
  // Dialog titles
  get TITLE_FILE() {
    return translate("fileBrowser.confirmDelete.titleFile");
  },
  get TITLE_DIRECTORY() {
    return translate("fileBrowser.confirmDelete.titleDirectory");
  },

  // Confirmation prompt (itemName is interpolated by the component)
  get CONFIRM_FILE() {
    return translate("fileBrowser.confirmDelete.confirmFile");
  },
  get CONFIRM_DIRECTORY() {
    return translate("fileBrowser.confirmDelete.confirmDirectory");
  },

  // Button labels
  get BUTTON_CANCEL() {
    return translate("common.actions.cancel");
  },
  get BUTTON_DELETE() {
    return translate("common.actions.delete");
  },
  get BUTTON_DELETING() {
    return translate("fileBrowser.confirmDelete.buttonDeleting");
  },
};
