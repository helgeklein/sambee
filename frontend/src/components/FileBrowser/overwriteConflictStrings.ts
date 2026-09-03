//
// overwriteConflictStrings
//

/**
 * Centralized strings for the Overwrite Conflict Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const OVERWRITE_CONFLICT_STRINGS = {
  get TITLE() {
    return translate("fileBrowser.overwriteConflict.title");
  },

  get LABEL_SOURCE_PATH() {
    return translate("fileBrowser.overwriteConflict.labelSourcePath");
  },
  get LABEL_TARGET_NAME() {
    return translate("fileBrowser.overwriteConflict.labelTargetName");
  },
  get LABEL_TARGET_DIRECTORY() {
    return translate("fileBrowser.overwriteConflict.labelTargetDirectory");
  },

  get LABEL_EXISTING() {
    return translate("fileBrowser.overwriteConflict.labelExisting");
  },
  get LABEL_INCOMING() {
    return translate("fileBrowser.overwriteConflict.labelIncoming");
  },
  get LABEL_SIZE() {
    return translate("fileBrowser.overwriteConflict.labelSize");
  },
  get LABEL_MODIFIED() {
    return translate("fileBrowser.overwriteConflict.labelModified");
  },
  get METADATA_LABEL() {
    return translate("fileBrowser.overwriteConflict.metadataLabel");
  },

  get BUTTON_SKIP() {
    return translate("fileBrowser.overwriteConflict.resolutionSkip");
  },
  get BUTTON_OVERWRITE() {
    return translate("fileBrowser.overwriteConflict.resolutionOverwrite");
  },
  get BUTTON_OVERWRITE_ONLY_OLDER() {
    return translate("fileBrowser.overwriteConflict.resolutionOverwriteOnlyOlder");
  },
  get BUTTON_RENAME() {
    return translate("fileBrowser.overwriteConflict.resolutionRename");
  },
  get RESOLUTION_LABEL() {
    return translate("fileBrowser.overwriteConflict.resolutionLabel");
  },

  get APPLY_TO_ALL() {
    return translate("fileBrowser.overwriteConflict.applyToAll");
  },
  get ERROR_TARGET_NAME_UNCHANGED() {
    return translate("fileBrowser.overwriteConflict.targetNameUnchanged");
  },
  get ERROR_NO_RESOLUTION_AVAILABLE() {
    return translate("fileBrowser.overwriteConflict.noResolutionAvailable");
  },
  CANCEL_OPERATION(operation: "copy" | "move" | "extract") {
    return translate(
      operation === "copy"
        ? "fileBrowser.overwriteConflict.cancelCopy"
        : operation === "move"
          ? "fileBrowser.overwriteConflict.cancelMove"
          : "fileBrowser.overwriteConflict.cancelExtraction"
    );
  },
  get BUTTON_CONTINUE() {
    return translate("fileBrowser.overwriteConflict.continue");
  },

  PROGRESS_CONTEXT(current: number, total: number, conflicts: number) {
    return translate("fileBrowser.overwriteConflict.progressContext", { current, total, count: conflicts });
  },
};
