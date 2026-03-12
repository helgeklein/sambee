export const LOCAL_DRIVES_MENU_ACTION_LABEL = "Manage Local Drives...";

export const LOCAL_DRIVES_PAGE_COPY = {
  intro: "Manage Sambee Companion pairing for this browser and verify local-drive access on this computer.",
  loadError: "Failed to load companion status.",
  pairingCreated: "Local drive pairing created.",
  pairingRemoved: "This browser has been unpaired.",
  pairingRemoveFailed: "Failed to remove pairing.",
  pairingTestFailed: "Pairing test failed. Pair this browser again to restore local drive access.",
  statusUnavailable: "Sambee Companion is not running. Start the companion app to manage local-drive access or create a new pairing.",
  statusPaired: "This browser is paired with Sambee Companion and can access local drives.",
  statusRecoverable:
    "This browser origin is known to the companion, but this browser no longer has its local pairing secret. Pair again to restore access.",
  statusUnpaired: "This browser is not currently paired with Sambee Companion.",
  refreshButton: "Refresh",
  testCurrentPairingButton: "Test Current Pairing",
  pairThisBrowserButton: "Pair This Browser",
  unpairThisBrowserButton: "Unpair This Browser",
  testingButton: "Testing...",
  unpairingButton: "Unpairing...",
} as const;

export const COMPANION_PAIRING_DIALOG_COPY = {
  title: "Pair with Companion",
  intro: "Pair this browser with the Sambee Companion app to browse local drives. Make sure the companion is running on this computer.",
  verifyCodePrompt: "Verify this code matches the one shown in the companion app:",
  verifyCodeHelp: "If the codes match, click Confirm below and approve the pairing on the companion.",
  confirming: "Waiting for companion confirmation...",
  success: "Pairing successful! Your local drives are now available.",
  startButton: "Start Pairing",
  confirmButton: "Codes Match - Confirm",
  cancelButton: "Cancel",
  doneButton: "Done",
  closeButton: "Close",
  retryButton: "Retry",
  initiateFailed: "Failed to initiate pairing. Is the companion app running?",
  confirmFailed: "Pairing failed. The companion may have rejected the request or the pairing expired.",
} as const;
