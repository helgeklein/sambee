import { translate } from "../../i18n";
import type { LocalLinkTargetResolution } from "../../types";

export const STATUS_BAR_STRINGS = {
  get NO_SELECTION() {
    return translate("fileBrowser.chrome.statusBar.noSelection");
  },
  itemCount(count: number) {
    return translate("fileBrowser.chrome.statusBar.itemCount", { count });
  },
  get UNRESOLVABLE_SHORTCUT() {
    return translate("fileBrowser.chrome.statusBar.linkTargetUnresolvable");
  },
  linkTargetStatus(resolution: LocalLinkTargetResolution) {
    if (resolution.target?.type === "other") {
      return translate("fileBrowser.chrome.statusBar.linkTargetUnsupported");
    }

    switch (resolution.state) {
      case "missing":
        return translate("fileBrowser.chrome.statusBar.linkTargetMissing");
      case "access_denied":
        return translate("fileBrowser.chrome.statusBar.linkTargetAccessDenied");
      case "unresolvable":
        return translate("fileBrowser.chrome.statusBar.linkTargetUnresolvable");
      case "unmapped_drive":
        return translate("fileBrowser.chrome.statusBar.linkTargetUnmappedDrive");
      case "resolved":
        return null;
    }
  },
};
