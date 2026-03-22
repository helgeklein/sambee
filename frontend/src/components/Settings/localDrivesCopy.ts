import { translate } from "../../i18n";

export const LOCAL_DRIVES_MENU_ACTION_LABEL = {
  toString() {
    return translate("settings.localDrives.menuActionLabel");
  },
  valueOf() {
    return translate("settings.localDrives.menuActionLabel");
  },
};

export const LOCAL_DRIVES_PAGE_COPY = {
  get headerTitle() {
    return translate("settings.localDrives.headerTitle");
  },
  get headerDescription() {
    return translate("settings.localDrives.headerDescription");
  },
  get intro() {
    return translate("settings.localDrives.intro");
  },
  get loadError() {
    return translate("settings.localDrives.loadError");
  },
  get pairingCreated() {
    return translate("settings.localDrives.pairingCreated");
  },
  get pairingRemoved() {
    return translate("settings.localDrives.pairingRemoved");
  },
  get pairingRemoveFailed() {
    return translate("settings.localDrives.pairingRemoveFailed");
  },
  get pairingTestFailed() {
    return translate("settings.localDrives.pairingTestFailed");
  },
  get statusUnavailable() {
    return translate("settings.localDrives.statusUnavailable");
  },
  get statusPaired() {
    return translate("settings.localDrives.statusPaired");
  },
  get statusRecoverable() {
    return translate("settings.localDrives.statusRecoverable");
  },
  get statusUnpaired() {
    return translate("settings.localDrives.statusUnpaired");
  },
  get refreshButton() {
    return translate("settings.localDrives.refreshButton");
  },
  get testCurrentPairingButton() {
    return translate("settings.localDrives.testCurrentPairingButton");
  },
  get pairThisBrowserButton() {
    return translate("settings.localDrives.pairThisBrowserButton");
  },
  get unpairThisBrowserButton() {
    return translate("settings.localDrives.unpairThisBrowserButton");
  },
  get testingButton() {
    return translate("settings.localDrives.testingButton");
  },
  get unpairingButton() {
    return translate("settings.localDrives.unpairingButton");
  },
};

export const COMPANION_PAIRING_DIALOG_COPY = {
  get title() {
    return translate("settings.localDrives.pairingDialog.title");
  },
  get intro() {
    return translate("settings.localDrives.pairingDialog.intro");
  },
  get verifyCodePrompt() {
    return translate("settings.localDrives.pairingDialog.verifyCodePrompt");
  },
  get verifyCodeHelp() {
    return translate("settings.localDrives.pairingDialog.verifyCodeHelp");
  },
  get confirming() {
    return translate("settings.localDrives.pairingDialog.confirming");
  },
  get success() {
    return translate("settings.localDrives.pairingDialog.success");
  },
  get startButton() {
    return translate("settings.localDrives.pairingDialog.startButton");
  },
  get confirmButton() {
    return translate("settings.localDrives.pairingDialog.confirmButton");
  },
  get cancelButton() {
    return translate("settings.localDrives.pairingDialog.cancelButton");
  },
  get doneButton() {
    return translate("settings.localDrives.pairingDialog.doneButton");
  },
  get closeButton() {
    return translate("settings.localDrives.pairingDialog.closeButton");
  },
  get retryButton() {
    return translate("settings.localDrives.pairingDialog.retryButton");
  },
  get initiateFailed() {
    return translate("settings.localDrives.pairingDialog.initiateFailed");
  },
  get confirmFailed() {
    return translate("settings.localDrives.pairingDialog.confirmFailed");
  },
};
