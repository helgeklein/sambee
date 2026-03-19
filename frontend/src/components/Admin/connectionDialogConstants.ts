//
// connectionDialogConstants
//

/**
 * Centralized strings and labels for Connection Dialog
 * Used by both mobile and desktop versions to ensure consistency
 */

export const CONNECTION_DIALOG_STRINGS = {
  // Dialog titles
  TITLE_ADD: "Add Connection",
  TITLE_EDIT: "Edit Connection",

  // Field labels
  LABEL_NAME: "Connection name",
  LABEL_HOST: "Host",
  LABEL_SHARE_NAME: "Share name",
  LABEL_USERNAME: "User name",
  LABEL_PASSWORD: "Password",
  LABEL_PATH_PREFIX: "Path prefix",

  // Helper text / descriptions
  HELPER_HOST: "IP address or hostname of the SMB server",
  HELPER_SHARE_NAME: "Name of the share on the server",
  HELPER_PASSWORD_EDIT: "Leave blank to keep existing password",
  HELPER_PATH_PREFIX: "Base path within the share (optional)",
  HELPER_USERNAME: "Use DOMAIN\\USER format if needed",
  HELPER_VISIBILITY_ADMIN: "Admins can create shared connections for everyone or private connections for themselves.",
  HELPER_VISIBILITY_REGULAR:
    "Shared connections require admin access. If you choose shared without admin access, the server will save it as private.",

  // Error messages
  ERROR_NAME_REQUIRED: "Connection name is required",
  ERROR_HOST_REQUIRED: "Host is required",
  ERROR_SHARE_NAME_REQUIRED: "Share name is required",
  ERROR_USERNAME_REQUIRED: "Username is required",
  ERROR_PASSWORD_REQUIRED: "Password is required",

  // Button labels
  BUTTON_TEST: "Test Connection",
  BUTTON_CANCEL: "Cancel",
  BUTTON_SAVE: "Save",

  // ARIA labels
  ARIA_TOGGLE_PASSWORD: "toggle password visibility",
  ARIA_GO_BACK: "Go back",
} as const;
