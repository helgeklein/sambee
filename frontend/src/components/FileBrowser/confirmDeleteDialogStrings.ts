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
  get TITLE_MULTI() {
    return translate("fileBrowser.confirmDelete.titleMulti");
  },

  get CONFIRM_FILE() {
    return translate("fileBrowser.confirmDelete.confirmFile");
  },
  get CONFIRM_DIRECTORY() {
    return translate("fileBrowser.confirmDelete.confirmDirectory");
  },
  CONFIRM_MULTI(count: number) {
    return translate("fileBrowser.confirmDelete.confirmMulti", { count });
  },
  get ARIA_LABEL_ITEM() {
    return translate("fileBrowser.confirmDelete.ariaLabelItem");
  },
  get ARIA_LABEL_ITEMS() {
    return translate("fileBrowser.confirmDelete.ariaLabelItems");
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
