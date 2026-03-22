type TranslationTree = {
  [key: string]: string | TranslationTree;
};

export const EN_TRANSLATIONS = {
  common: {
    actions: {
      cancel: "Cancel",
      close: "Close",
      copy: "Copy",
      create: "Create",
      delete: "Delete",
      download: "Download",
      logout: "Logout",
      move: "Move",
      rename: "Rename",
      replace: "Replace",
      share: "Share",
      skip: "Skip",
    },
    labels: {
      connection: "Connection",
      root: "Root",
      settings: "Settings",
    },
    navigation: {
      goBack: "Go back",
    },
    search: {
      action: "Search",
      placeholder: "Search",
      clear: "Clear search",
      previousMatch: "Previous match",
      nextMatch: "Next match",
    },
  },
  themeSelector: {
    openButtonLabel: "Change theme",
    dialogTitle: "Choose Theme",
    previewPrimaryColor: "Primary color",
    modes: {
      light: "Light",
      dark: "Dark",
    },
    builtInThemes: {
      sambeeLight: {
        name: "Sambee light",
        description: "Application default light theme",
      },
      sambeeDark: {
        name: "Sambee dark",
        description: "Application default dark theme",
      },
    },
  },
  keyboardShortcutsHelp: {
    defaultTitle: "Keyboard Shortcuts",
    emptyState: "No keyboard shortcuts available",
    titles: {
      fileBrowser: "File browser shortcuts",
      pdfViewer: "PDF viewer shortcuts",
      imageViewer: "Image viewer shortcuts",
      markdownViewer: "Markdown viewer shortcuts",
    },
  },
  app: {
    loading: "Loading...",
    errorBoundary: {
      title: "Something went wrong",
      description: "An unexpected error occurred. The error has been logged.",
      tryAgain: "Try Again",
      reloadPage: "Reload Page",
      developmentDetails: "Error Details (Development Only)",
    },
  },
  auth: {
    login: {
      title: "Sambee Login",
      usernameLabel: "Username",
      passwordLabel: "Password",
      submit: "Sign In",
      invalidCredentials: "Invalid username or password",
    },
  },
  settings: {
    shell: {
      title: "Settings",
      closeAriaLabel: "Close settings",
      categoriesAriaLabel: "Settings categories",
      versionLabel: "Version",
      buildLabel: "Build",
      commitLabel: "Commit",
      unknownValue: "Unknown",
    },
    sections: {
      personal: "Personal",
      administration: "Administration",
    },
    categories: {
      preferences: {
        label: "Preferences",
        description: "Choose your theme and browser defaults.",
      },
      connections: {
        label: "Connections",
        description: "Manage SMB shares and local-drive access in one place.",
      },
      adminUsers: {
        label: "User Management",
        description: "Create accounts, assign roles, and issue password resets.",
      },
      adminSystem: {
        label: "System",
        description: "Manage system-wide SMB and preprocessing runtime settings.",
      },
    },
    preferencesPage: {
      appearanceTitle: "Appearance",
      appearanceDescription: "Choose the application theme and visual defaults.",
      browserTitle: "Browser",
      browserDescription: "Set defaults for how the file browser behaves.",
      quickNavigationTitle: "Quick navigation",
      includeDotDirectoriesLabel: "Include dot directories in quick nav",
      includeDotDirectoriesDescription: "Show folders like .git, .cache, and other dot-prefixed directories in quick navigation results.",
    },
    connectionsPage: {
      smbSectionTitle: "SMB connections",
      smbSectionDescription: "Browse shared connections and manage your private SMB share connections.",
      localDrivesSectionTitle: "Local drives",
      localDrivesSectionDescription: "Pair Sambee Companion and control local-drive access from this browser.",
    },
    localDrives: {
      menuActionLabel: "Manage Local Drives...",
      headerTitle: "Local Drives",
      headerDescription: "Pair Sambee Companion and control local-drive access from this browser.",
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
      pairingDialog: {
        title: "Pair with Companion",
        intro:
          "Pair this browser with the Sambee Companion app to browse local drives. Make sure the companion is running on this computer.",
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
      },
    },
    connectionManagement: {
      headerTitle: "SMB Connections",
      headerDescription: "Browse shared connections and manage your private SMB share connections.",
      addConnectionButton: "Add Connection",
      addConnectionFabAriaLabel: "Add connection",
      connectionActionsAriaLabel: "Connection actions",
      userLabel: "User:",
      pathLabel: "Path:",
      sharedSectionTitle: "Shared connections",
      sharedSectionDescription: "Admins can create these for everyone. You can browse them, but only admins can change them.",
      sharedSectionEmpty: "No shared connections are available.",
      privateSectionTitle: "My connections",
      privateSectionDescription: "These connections are visible only to your account.",
      privateSectionEmpty: "You have no private connections yet.",
      emptyTitle: "No connections configured",
      emptyAdminDescription: "Click the + button to create a shared or private SMB connection.",
      emptyRegularDescription: "Click the + button to create your first private SMB connection.",
      menuTest: "Test Connection",
      menuEdit: "Edit",
      menuDelete: "Delete",
      tooltipTest: "Test Connection",
      tooltipEdit: "Edit",
      tooltipDelete: "Delete",
      ariaTest: "Test connection",
      ariaEdit: "Edit connection",
      ariaDelete: "Delete connection",
      deleteDialogTitle: "Delete Connection",
      deleteDialogDescription: "Are you sure you want to delete the connection",
      notifications: {
        loadFailed: "Failed to load connections",
        savedPrivateInfo: "Connection saved as private. Shared visibility requires admin access.",
        createdSuccess: "Connection created successfully",
        updatedSuccess: "Connection updated successfully",
        deletedSuccess: "Connection deleted successfully",
        deleteFailed: "Failed to delete connection",
        testFailed: "Connection test failed",
        saveFailed: "Failed to save connection",
      },
      scope: {
        sharedChip: "SHARED",
        privateChip: "PRIVATE",
      },
    },
    connectionDialog: {
      titles: {
        add: "Add Connection",
        edit: "Edit Connection",
      },
      labels: {
        name: "Connection name",
        host: "Host",
        shareName: "Share name",
        username: "User name",
        password: "Password",
        pathPrefix: "Path prefix",
        visibility: "Visibility",
      },
      helpers: {
        host: "IP address or hostname of the SMB server",
        shareName: "Name of the share on the server",
        passwordEdit: "Leave blank to keep existing password",
        pathPrefix: "Base path within the share (optional)",
        username: "Use DOMAIN\\USER format if needed",
        visibilityAdmin: "Admins can create shared connections for everyone or private connections for themselves.",
        visibilityRegular:
          "Shared connections require admin access. If you choose shared without admin access, the server will save it as private.",
      },
      errors: {
        nameRequired: "Connection name is required",
        hostRequired: "Host is required",
        shareNameRequired: "Share name is required",
        usernameRequired: "Username is required",
        passwordRequired: "Password is required",
      },
      actions: {
        save: "Save",
      },
      aria: {
        togglePassword: "toggle password visibility",
      },
      visibility: {
        privateLabel: "Private to me",
        privateDescription: "Visible only to your account. You can fully manage it.",
        sharedLabel: "Shared with everyone",
        sharedDescription: "Visible to all users. Only admins can manage it.",
      },
    },
    userManagement: {
      addUserButton: "Add User",
      addUserFabAriaLabel: "Add user",
      totalUsers_one: "{{count}} total user",
      totalUsers_other: "{{count}} total users",
      activeAdmins_one: "{{count}} active admin",
      activeAdmins_other: "{{count}} active admins",
      emptyTitle: "No users found",
      emptyDescription: "Create the first user account to start delegating access.",
      currentUserChip: "You",
      adminRole: "Admin",
      regularRole: "Regular",
      activeStatus: "Active",
      disabledStatus: "Disabled",
      passwordResetPending: "Password reset pending",
      createdAt: "Created {{timestamp}}",
      actions: {
        editUser: "Edit user",
        resetPassword: "Reset password",
        deleteUser: "Delete user",
        deleteSelfDisabled: "You cannot delete your own account here",
        saveChanges: "Save Changes",
        createUser: "Create User",
        close: "Close",
      },
      aria: {
        editUser: "Edit {{username}}",
        resetPassword: "Reset password for {{username}}",
        deleteUser: "Delete {{username}}",
      },
      editor: {
        titleEdit: "Edit User",
        titleCreate: "Create User",
        descriptionEdit: "Update account details and access level. Password resets are handled separately.",
        descriptionCreate: "Create a new account. Leave the password blank to generate a temporary password automatically.",
        usernameLabel: "Username",
        roleLabel: "Role",
        accountActiveLabel: "Account is active",
        initialPasswordLabel: "Initial Password",
        initialPasswordHelp: "Optional. If left blank, the server will generate a secure temporary password.",
        requirePasswordChangeLabel: "Require password change after next sign-in",
      },
      credentialsDialog: {
        usernameLabel: "Username",
        temporaryPasswordLabel: "Temporary Password",
        createTitle: "Temporary Password Created",
        createDescription: "Share this temporary password securely. The user will be required to change it after signing in.",
        resetTitle: "Temporary Password Reset",
        resetDescription: "The existing password was replaced and all current sessions were invalidated.",
      },
      deleteDialog: {
        title: "Delete User",
        descriptionWithName: "Delete {{username}}? This immediately removes their access.",
        descriptionFallback: "Delete this user?",
      },
      notifications: {
        loadFailed: "Failed to load users",
        usernameRequired: "Username is required",
        userUpdated: "User updated successfully",
        userCreated: "User created successfully",
        updateFailed: "Failed to update user",
        createFailed: "Failed to create user",
        resetFailed: "Failed to reset password",
        userDeleted: "User deleted successfully",
        deleteFailed: "Failed to delete user",
      },
    },
    advanced: {
      saveChanges: "Save changes",
      saveSuccess: "Advanced settings saved",
      loadFailed: "Failed to load advanced settings",
      saveFailed: "Failed to save advanced settings",
      resetOverride: "Reset override",
      resetFailed: "Failed to reset setting override",
      resetSuccess: "{{label}} reset to inherited value",
      sections: {
        smbBackends: "SMB backends",
        preprocessors: "Preprocessors",
        imageMagick: "ImageMagick",
      },
      fields: {
        value: "Value",
        unit: "Unit",
        seconds: "seconds",
      },
      validation: {
        enterLabel: "Enter {{label}}",
        wholeNumber: "{{label}} must be a whole number",
        betweenRange: "{{label}} must be between {{min}} and {{max}}",
        betweenRangeWithUnit: "{{label}} must be between {{min}} and {{max}} {{unit}}",
      },
      helperText: {
        integer: "{{description}} Default: {{defaultValue}}. Range: {{minValue}} - {{maxValue}}.",
        byteSize: "{{description}} Default: {{defaultValue}}. Range: {{minValue}} to {{maxValue}}.",
      },
    },
    adminPanel: {
      title: "Admin Panel - SMB Share Management",
      accessDenied: "Access denied. Admin privileges required.",
      deleteDialogTitle: "Delete Connection",
      deleteDialogDescription: "Are you sure you want to delete the connection",
      columns: {
        port: "Port",
        type: "Type",
        actions: "Actions",
      },
      notifications: {
        loadFailed: "Failed to load connections",
        testFailed: "Failed to test connection",
        deleteFailed: "Failed to delete connection",
      },
    },
  },
  fileBrowser: {
    search: {
      modes: {
        navigate: "Navigate",
        quickNav: "Quick Nav",
        commands: "Commands",
        filter: "Filter",
      },
      placeholders: {
        directory: "Navigate to any directory",
        command: "Run a command",
        smart: "Go to any folder or type > for commands",
        filterCurrentDirectory: "Filter files in the current directory",
      },
      footer: {
        navigate: "navigate",
        open: "open",
        run: "run",
        commands: "commands",
        close: "close",
      },
      itemTypes: {
        directory: "Directory",
        file: "File",
      },
      results: {
        none: 'No results found for "{{query}}"',
        count_one: "{{count}} result",
        count_other: "{{count}} results",
        countTruncated: "{{count}}+ results",
        commandCount_one: "{{count}} command",
        commandCount_other: "{{count}} commands",
        directoriesIndexed_one: "{{count}} directory indexed",
        directoriesIndexed_other: "{{count}} directories indexed",
      },
      status: {
        indexing: "Indexing... ({{count}} directories found)",
        updating: "Updating index... ({{count}} directories)",
        startingIndex: "Starting index...",
      },
      belowMinimum: "Type at least {{count}} characters to search",
    },
    commands: {
      categories: {
        navigation: "Navigation",
        files: "Files",
        view: "View",
        panes: "Panes",
        settings: "Settings",
        help: "Help",
      },
      items: {
        quickNav: {
          title: "Open Smart Navigation",
          description: "Jump to directories from the smart navigation bar",
        },
        filterCurrentDirectory: {
          title: "Filter Current Directory",
          description: "Filter the active pane's file list",
        },
        commandPalette: {
          title: "Show Commands",
          description: "Open the file browser command palette",
        },
        open: {
          title: "Open Focused Item",
        },
        navigateUp: {
          title: "Go Up One Directory",
        },
        refresh: {
          title: "Refresh File List",
        },
        rename: {
          title: "Rename Focused Item",
        },
        delete: {
          title: "Delete Focused Item",
        },
        newDirectory: {
          title: "Create New Directory",
        },
        newFile: {
          title: "Create New File",
        },
        openInApp: {
          title: "Open Focused File In Companion App",
        },
        toggleDualPane: {
          title: "Toggle Dual-Pane View",
        },
        focusLeftPane: {
          title: "Focus Left Pane",
        },
        focusRightPane: {
          title: "Focus Right Pane",
        },
        switchPane: {
          title: "Switch Active Pane",
        },
        copyToOtherPane: {
          title: "Copy To Other Pane",
        },
        moveToOtherPane: {
          title: "Move To Other Pane",
        },
        openSettings: {
          title: "Open Settings",
        },
        openConnectionsSettings: {
          title: "Open Connections Settings",
        },
        showHelp: {
          title: "Show Keyboard Shortcuts",
        },
      },
    },
    list: {
      emptyDirectory: "This directory is empty",
    },
    row: {
      openInCompanionApp: "Open in companion app",
      itemTypes: {
        folder: "Folder",
        file: "File",
      },
      selectedSuffix: " (selected)",
    },
    shortcuts: {
      navigateUp: "Go up one directory",
      navigateDown: "Navigate down",
      navigateUpRow: "Navigate up",
      openSmartNavigation: "Open smart navigation",
      openQuickNavigation: "Open quick navigation",
      filterCurrentDirectory: "Filter the current directory",
      showCommands: "Show commands",
      openConnectionSelector: "Open connection selector",
      openSettings: "Open settings",
      showHelp: "Show keyboard shortcuts",
      refresh: "Refresh file list",
      deleteItem: "Delete file or directory",
      renameItem: "Rename file or directory",
      openInCompanion: "Open in companion app",
      createDirectory: "Create new directory",
      createFile: "Create new file",
      toggleSelectionAndMoveDown: "Toggle selection & move down",
      selectAndMoveDown: "Select & move down",
      selectAndMoveUp: "Select & move up",
      selectAllFiles: "Select all files",
      copyToOtherPane: "Copy to other pane",
      moveToOtherPane: "Move to other pane",
      toggleDualPane: "Toggle dual-pane view",
      focusLeftPane: "Focus left pane",
      focusRightPane: "Focus right pane",
      switchActivePane: "Switch active pane",
    },
    chrome: {
      breadcrumb: {
        navigateRoot: "Navigate to root directory",
        navigateTo: "Navigate to {{path}}",
      },
      connectionSelector: {
        placeholder: "Select connection",
      },
      mobileToolbar: {
        openMenu: "Open menu",
        navigateUpTitle: "Navigate up",
        navigateUpAriaLabel: "Navigate to parent directory",
      },
      sort: {
        ariaLabel: "Sort options",
        fields: {
          name: "Name",
          size: "Size",
          modified: "Modified",
          type: "Type",
        },
        direction: {
          ascending: "Ascending",
          descending: "Descending",
        },
      },
      viewMode: {
        ariaLabel: "View mode options",
        options: {
          list: "List",
          details: "Details",
        },
      },
      statusBar: {
        noSelection: "No selection",
        filteredBy: "Filtered by: {{filter}}",
        itemCount_one: "{{count}} item",
        itemCount_other: "{{count}} items",
      },
      alerts: {
        welcomeTitle: "Welcome to Sambee!",
        adminOnboardingPrefix: "Get started by ",
        adminOnboardingLink: "adding your first SMB network share",
        adminOnboardingSuffix: ". You'll be able to browse and view files from your network storage.",
        regularOnboarding:
          "Sambee lets you browse and view files from network shares. Please contact an administrator to set up network shares.",
        backendUnavailable:
          "Backend connection lost. The current UI remains available, but refreshes and live updates may fail until the connection returns.",
        backendReconnecting: "Reconnecting to backend. Live updates may be delayed for a moment.",
        loadingConnections: "Loading connections...",
      },
      mobileMenu: {
        selectConnectionAriaLabel: "Select connection",
        navigateRootAriaLabel: "Navigate to root directory",
        openSettingsAriaLabel: "Open settings",
        logoutAriaLabel: "Logout",
      },
      toolbar: {
        openSettings: "Open settings",
      },
    },
    confirmDelete: {
      titleFile: "Delete file",
      titleDirectory: "Delete directory",
      confirmFile: "Are you sure you want to delete the file",
      confirmDirectory: "Are you sure you want to delete the directory",
      buttonDeleting: "Deleting…",
    },
    rename: {
      titleFile: "Rename file",
      titleDirectory: "Rename directory",
      inputLabel: "New name",
      validationSame: "Name is unchanged",
      buttonRenaming: "Renaming…",
    },
    createItem: {
      titleFile: "New file",
      titleDirectory: "New directory",
      inputLabel: "Name",
      buttonCreating: "Creating…",
    },
    nameDialog: {
      validationEmpty: "Name must not be empty",
      validationInvalidChars: "Name contains invalid characters",
      validationDotNames: "Name must not be '.' or '..'",
      validationTrailing: "Name must not end with a space or period",
    },
    copyMove: {
      promptCopySingle: "Copy 1 item to:",
      promptCopyMulti_one: "Copy {{count}} item to:",
      promptCopyMulti_other: "Copy {{count}} items to:",
      promptMoveSingle: "Move 1 item to:",
      promptMoveMulti_one: "Move {{count}} item to:",
      promptMoveMulti_other: "Move {{count}} items to:",
      labelFilename: "File name",
      overwriteStrategyLabel: "If files already exist:",
      overwriteStrategyAsk: "Ask for each file",
      overwriteStrategyReplaceAll: "Replace all",
      overwriteStrategySkipAll: "Skip all",
      warnSameDirectory: "Source and destination are the same directory.",
      warnEmptyFilename: "File name cannot be empty.",
      buttonCopying: "Copying…",
      buttonMoving: "Moving…",
      progressCopy: "Copying {{current}} of {{total}}…",
      progressMove: "Moving {{current}} of {{total}}…",
      errorGeneric: "Operation failed. Some items may not have been processed.",
    },
    overwriteConflict: {
      titleFile: "File already exists",
      titleDirectory: "Folder already exists",
      alreadyExistsFile: "File already exists at the destination:",
      alreadyExistsDirectory: "Folder already exists at the destination:",
      labelOperation: "Operation:",
      labelExisting: "Target",
      labelIncoming: "Source",
      applyToAll: "Apply to all remaining conflicts",
      progressContext_one: "Item {{current}} of {{total}} • {{count}} conflict so far",
      progressContext_other: "Item {{current}} of {{total}} • {{count}} conflicts so far",
    },
  },
  viewer: {
    helpTitles: {
      pdf: "PDF viewer shortcuts",
      image: "Image viewer shortcuts",
      markdown: "Markdown viewer shortcuts",
    },
    fallback: {
      failedTitle: "Viewer unavailable",
      unsupportedTitle: "Viewer unsupported",
      closeAriaLabel: "Close viewer error",
      failedMessageWithError: "{{message}} The viewer code could not be loaded.",
      failedMessageGeneric: "The viewer code could not be loaded. This can happen if the backend or asset host is temporarily unavailable.",
      unsupportedMessage: "This file type does not have an available viewer in the current frontend runtime.",
      stillAvailable: "The file browser is still available. You can close this dialog and continue working elsewhere in the app.",
      retry: "Retry",
    },
    controls: {
      previous: "Previous",
      next: "Next",
      previousPage: "Previous page",
      nextPage: "Next page",
      previousImage: "Previous image",
      nextImage: "Next image",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      rotateLeft: "Rotate left",
      rotateRight: "Rotate right",
      shareUnavailable: "Sharing is not available on this device or browser",
      searchUnavailable: "Search unavailable - PDF contains no text layer (may be a scanned image)",
      pdfSearchPlaceholder: "Search in PDF...",
    },
    share: {
      preparing: "Preparing file to share...",
      failed: "Failed to share file",
      unsupported: "Sharing is not available on this device or browser",
    },
    shortcuts: {
      open: "Open",
      close: "Close",
      download: "Download",
      showHelp: "Show keyboard shortcuts",
      search: "Search",
      nextMatch: "Next match",
      previousMatch: "Previous match",
      firstPage: "First page",
      lastPage: "Last page",
      nextPage: "Next page",
      previousPage: "Previous page",
      next: "Next",
      previous: "Previous",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      resetZoom: "Reset zoom",
      rotateRight: "Rotate right",
      rotateLeft: "Rotate left",
      toggleFullscreen: "Toggle fullscreen",
    },
  },
} as const satisfies TranslationTree;

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
} satisfies TranslationTree;

const PSEUDO_TRANSLATIONS = createPseudoLocaleTranslations(EN_TRANSLATIONS);

export type FrontendTranslations = typeof EN_TRANSLATIONS;

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
