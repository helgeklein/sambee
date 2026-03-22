//
// copyMoveDialogStrings
//

/**
 * Centralized strings for the Copy/Move Dialog.
 * Kept in one place in preparation for future translation / i18n.
 */

import { translate } from "../../i18n";

export const COPY_MOVE_STRINGS = {
  // Dialog titles
  get TITLE_COPY() {
    return translate("common.actions.copy");
  },
  get TITLE_MOVE() {
    return translate("common.actions.move");
  },

  // Prompts (action text — destination is shown separately)
  get PROMPT_COPY_SINGLE() {
    return translate("fileBrowser.copyMove.promptCopySingle");
  },
  PROMPT_COPY_MULTI(count: number) {
    return translate("fileBrowser.copyMove.promptCopyMulti", { count });
  },
  get PROMPT_MOVE_SINGLE() {
    return translate("fileBrowser.copyMove.promptMoveSingle");
  },
  PROMPT_MOVE_MULTI(count: number) {
    return translate("fileBrowser.copyMove.promptMoveMulti", { count });
  },

  // Labels
  get LABEL_FILENAME() {
    return translate("fileBrowser.copyMove.labelFilename");
  },

  // Overwrite strategy (pre-flight choice for multi-file operations)
  get OVERWRITE_STRATEGY_LABEL() {
    return translate("fileBrowser.copyMove.overwriteStrategyLabel");
  },
  get OVERWRITE_STRATEGY_ASK() {
    return translate("fileBrowser.copyMove.overwriteStrategyAsk");
  },
  get OVERWRITE_STRATEGY_REPLACE_ALL() {
    return translate("fileBrowser.copyMove.overwriteStrategyReplaceAll");
  },
  get OVERWRITE_STRATEGY_SKIP_ALL() {
    return translate("fileBrowser.copyMove.overwriteStrategySkipAll");
  },

  // Warnings
  get WARN_SAME_DIRECTORY() {
    return translate("fileBrowser.copyMove.warnSameDirectory");
  },
  get WARN_EMPTY_FILENAME() {
    return translate("fileBrowser.copyMove.warnEmptyFilename");
  },

  // Buttons
  get BUTTON_CANCEL() {
    return translate("common.actions.cancel");
  },
  get BUTTON_COPY() {
    return translate("common.actions.copy");
  },
  get BUTTON_MOVE() {
    return translate("common.actions.move");
  },
  get BUTTON_COPYING() {
    return translate("fileBrowser.copyMove.buttonCopying");
  },
  get BUTTON_MOVING() {
    return translate("fileBrowser.copyMove.buttonMoving");
  },

  // Progress
  PROGRESS_COPY(current: number, total: number) {
    return translate("fileBrowser.copyMove.progressCopy", { current, total });
  },
  PROGRESS_MOVE(current: number, total: number) {
    return translate("fileBrowser.copyMove.progressMove", { current, total });
  },

  // Errors
  get ERROR_GENERIC() {
    return translate("fileBrowser.copyMove.errorGeneric");
  },
};
