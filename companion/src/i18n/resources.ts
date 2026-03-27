type TranslationTree = {
  [key: string]: string | TranslationTree;
};

export const EN_TRANSLATIONS = {
  app: {
    title: "Sambee Companion",
    idleMessage: "Running in system tray. No active edit operations.",
  },
  common: {
    actions: {
      cancel: "Cancel",
      close: "Close",
      open: "Open",
    },
  },
  pairing: {
    idleMessage: "Waiting for a pairing request.",
    eyebrow: "Pair with Browser",
    title: "Confirm this pairing request",
    closeTitle: "Close",
    body: "Sambee in the browser wants to pair with this companion instance.",
    labels: {
      requestingOrigin: "Requesting origin",
      verificationCode: "Verification code",
    },
    hint: "Approve only if the same code is visible in the Sambee pairing dialog.",
    actions: {
      reject: "Reject",
      codesMatch: "Codes Match",
      close: "Close",
    },
    approved: {
      title: "Approval sent",
      body: "The codes matched for {{origin}}.",
      hint: "Waiting for Sambee to finish storing the pairing.",
    },
    success: {
      title: "Pairing successful",
      body: "This browser is now paired with Sambee Companion and can access local drives.",
      hint: "This window will close automatically.",
    },
  },
  doneEditing: {
    waitingForContext: "Waiting for edit context…",
    openedIn: "Opened in: {{appName}}",
    statusLabel: "Status:",
    modifiedAt: "Modified at {{time}}",
    unchanged: "Unchanged",
    parseConflictError: "Failed to parse conflict info",
    buttons: {
      doneUpload: "✓ Done Editing — Hold to Upload",
      doneClose: "✓ Done Editing — Hold to Close",
      uploading: "✓ Uploading…",
      closing: "✓ Closing…",
      discardHold: "Discard Changes — Hold",
    },
    aria: {
      confirmUpload: "Hold for {{seconds}} seconds to confirm upload",
      confirmClose: "Hold for {{seconds}} seconds to close and release lock",
      discardChanges: "Hold for {{seconds}} seconds to discard changes",
      uploadProgress: "Upload progress",
    },
  },
  conflictDialog: {
    title: "⚠ Conflict Detected",
    body: "This file was modified on the server by another user while you were editing it.",
    labels: {
      yourDownload: "Your download:",
      serverVersion: "Server version:",
    },
    actions: {
      overwrite: "Overwrite Server Version",
      saveCopy: "Save as Copy",
      cancel: "Cancel",
    },
  },
  largeFileWarning: {
    title: "⚠ Large File",
    body: "This file is {{sizeMb}} MB (limit: {{limitMb}} MB). Downloading and syncing large files may be slow and use significant disk space.",
    actions: {
      continue: "Continue Anyway",
      cancel: "Cancel",
    },
  },
  recovery: {
    title: "Unsaved Files Found",
    subtitle_one: "{{count}} file from a previous session needs attention.",
    subtitle_other: "{{count}} files from a previous session need attention.",
    detail: "{{remotePath}} — modified {{localModified}}",
    actions: {
      upload: "Upload",
      discard: "Discard",
      later: "Later",
      dismissAll: "Dismiss All",
    },
  },
  appPicker: {
    title: "Choose an app to open this .{{extension}} file",
    loading: "Loading available applications…",
    browseDialogTitle: "Browse for application",
    empty: "No registered applications found for .{{extension}} files.",
    defaultBadge: "(default)",
    alwaysUse: "Always use this app for .{{extension}} files",
    browseButton: "Browse for another app…",
    iconAlt: "{{appName}} icon",
  },
  preferences: {
    loading: "Loading preferences…",
    title: "Preferences",
    closeTitle: "Close",
    sections: {
      pairedBrowsers: "Paired Browsers",
      localization: "Localization",
      editingBehavior: "Editing Behavior",
      startup: "Startup",
      updates: "Updates",
      notifications: "Notifications",
      tempFileCleanup: "Temp File Cleanup",
    },
    pairedBrowsersHint: "These browser origins can access local drives through this companion. Removing one forces it to pair again.",
    pairedBrowsersEmpty: "No browsers are currently paired with this companion.",
    localizationStatusHint: "Shows the last localization synchronized from a paired Sambee browser.",
    localizationStatus: {
      syncedBadge: "Synced from browser",
      languageLabel: "Language",
      regionalLocaleLabel: "Regional locale",
      updatedAtLabel: "Last updated",
      sourceOriginLabel: "Source browser",
      empty: "No browser localization has been synchronized yet.",
    },
    unpairTitle: "Unpair browser",
    unpairButton: "Unpair",
    conflictResolutionLabel: "Upload conflict resolution",
    conflictResolutionHint: "What to do when the file on the server changed while you were editing.",
    conflictActions: {
      ask: "Ask me every time",
      overwrite: "Always overwrite server copy",
      saveCopy: "Always save as new copy",
    },
    startupLabel: "Start Sambee Companion when I sign in",
    startupHint: "Recommended for Local Drives. Browser access to local drives only works while the companion is running.",
    updateChannelLabel: "Update channel",
    updateChannelHint: "Controls which promoted feed this companion uses for automatic updates.",
    updateChannels: {
      stable: "Stable",
      beta: "Beta",
      test: "Test",
    },
    preReleaseWarning: "{{channel}} builds may contain unfinished features or regressions.",
    confirmUpdateChannel: {
      title: "Switch update channel?",
      body: "Switching from Stable to {{channel}} may install preview builds that are less tested.",
      confirm: "Switch channel",
    },
    updateActions: {
      checkNow: "Check for updates",
      checking: "Checking…",
      install: "Install update",
      installing: "Installing…",
    },
    updateStatus: {
      statusLabel: "Update status",
      lastChecked: "Last checked: {{time}}",
      currentVersionLabel: "Current version",
      latestVersionLabel: "Available version",
      publishedAtLabel: "Published",
      notesLabel: "Release notes",
      errorLabel: "Details",
      upToDate: "You are up to date on the {{channel}} channel.",
      updateAvailable: "Update {{version}} is available on the {{channel}} channel.",
      installing: "Installing update {{version}} from the {{channel}} channel.",
      installed: "Update {{version}} has been installed. Restart the app if it does not relaunch automatically.",
      checkFailed: "Could not check for updates on the {{channel}} channel.",
      unknownVersion: "Unknown",
      unknownError: "Unknown error",
    },
    notificationsLabel: "Show desktop notifications",
    notificationsHint: "Display system notifications for edit events such as upload success or failure.",
    retentionLabel: "Keep temp files for (days)",
    retentionHint: "Recycled temp files older than this are automatically deleted on startup (1–90).",
    savedIndicator: "Saved ✓",
    confirmUnpair: {
      title: "Unpair browser?",
      body: "{{origin}} will lose access to local drives until it pairs with this companion again.",
      unpairing: "Unpairing…",
    },
  },
} satisfies TranslationTree;

const PSEUDO_MAP: Record<string, string> = {
  A: "Å",
  B: "Ɓ",
  C: "Ć",
  D: "Ď",
  E: "É",
  F: "Ƒ",
  G: "Ğ",
  H: "Ħ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ĺ",
  M: "Ḿ",
  N: "Ń",
  O: "Ó",
  P: "Ṕ",
  Q: "Q",
  R: "Ŕ",
  S: "Š",
  T: "Ť",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẍ",
  Y: "Ý",
  Z: "Ž",
  a: "å",
  b: "ƀ",
  c: "ć",
  d: "ď",
  e: "é",
  f: "ƒ",
  g: "ğ",
  h: "ħ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ĺ",
  m: "ḿ",
  n: "ń",
  o: "ó",
  p: "ṕ",
  q: "q",
  r: "ŕ",
  s: "š",
  t: "ť",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẍ",
  y: "ý",
  z: "ž",
};

function createPseudoLocaleTranslations(tree: TranslationTree): TranslationTree {
  return Object.fromEntries(
    Object.entries(tree).map(([key, value]) => {
      if (typeof value !== "string") {
        return [key, createPseudoLocaleTranslations(value)];
      }

      return [key, pseudoLocalize(value)];
    })
  );
}

function pseudoLocalize(input: string): string {
  const placeholders: string[] = [];
  const maskedInterpolation = input.replace(/{{\s*[^}]+\s*}}/g, (match) => {
    const index = placeholders.push(match) - 1;
    return `⟪${index}⟫`;
  });
  const transformed = maskedInterpolation.replace(/[A-Za-z]/g, (character) => PSEUDO_MAP[character] ?? character);

  return `[${transformed}]`.replace(/⟪(\d+)⟫/g, (_match, index) => placeholders[Number(index)] ?? "");
}

const PSEUDO_TRANSLATIONS = createPseudoLocaleTranslations(EN_TRANSLATIONS);

export type CompanionTranslations = typeof EN_TRANSLATIONS;

export const DEFAULT_LANGUAGE = "en";

export const resources = {
  en: {
    translation: EN_TRANSLATIONS,
  },
  "en-XA": {
    translation: PSEUDO_TRANSLATIONS,
  },
} as const;

export type SupportedLanguage = keyof typeof resources;

export const SUPPORTED_LANGUAGES = Object.keys(resources) as SupportedLanguage[];
