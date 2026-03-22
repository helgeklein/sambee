import { translate } from "../../i18n";
import type { ViewMode } from "../../pages/FileBrowser/types";

const VIEW_MODE_KEYS: Record<ViewMode, string> = {
  list: "fileBrowser.chrome.viewMode.options.list",
  details: "fileBrowser.chrome.viewMode.options.details",
};

export const VIEW_MODE_SELECTOR_STRINGS = {
  optionLabel(mode: ViewMode) {
    return translate(VIEW_MODE_KEYS[mode]);
  },
  get ARIA_LABEL() {
    return translate("fileBrowser.chrome.viewMode.ariaLabel");
  },
};
