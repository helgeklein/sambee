import { translate } from "../../i18n";

export const STATUS_BAR_STRINGS = {
  get NO_SELECTION() {
    return translate("fileBrowser.chrome.statusBar.noSelection");
  },
  itemCount(count: number) {
    return translate("fileBrowser.chrome.statusBar.itemCount", { count });
  },
};
