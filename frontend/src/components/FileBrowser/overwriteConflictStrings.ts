//
// overwriteConflictStrings
//

/**
 * Centralized strings for the Overwrite Conflict Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const OVERWRITE_CONFLICT_STRINGS = {
  // Dialog title
  TITLE(isDirectory: boolean) {
    return translate(isDirectory ? "fileBrowser.overwriteConflict.titleDirectory" : "fileBrowser.overwriteConflict.titleFile");
  },

  // Info text
  ALREADY_EXISTS(isDirectory: boolean) {
    return translate(
      isDirectory ? "fileBrowser.overwriteConflict.alreadyExistsDirectory" : "fileBrowser.overwriteConflict.alreadyExistsFile"
    );
  },

  // Section header for metadata comparison
  get LABEL_OPERATION() {
    return translate("fileBrowser.overwriteConflict.labelOperation");
  },

  // Column headers
  get LABEL_EXISTING() {
    return translate("fileBrowser.overwriteConflict.labelExisting");
  },
  get LABEL_INCOMING() {
    return translate("fileBrowser.overwriteConflict.labelIncoming");
  },

  // Buttons
  get BUTTON_SKIP() {
    return translate("common.actions.skip");
  },
  get BUTTON_REPLACE() {
    return translate("common.actions.replace");
  },

  // "Apply to all" checkbox
  get APPLY_TO_ALL() {
    return translate("fileBrowser.overwriteConflict.applyToAll");
  },

  // Progress context
  PROGRESS_CONTEXT(current: number, total: number, conflicts: number) {
    return translate("fileBrowser.overwriteConflict.progressContext", { current, total, count: conflicts });
  },
};
