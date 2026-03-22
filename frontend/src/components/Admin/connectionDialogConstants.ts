//
// connectionDialogConstants
//

import { translate } from "../../i18n";

/**
 * Centralized strings and labels for Connection Dialog
 * Used by both mobile and desktop versions to ensure consistency
 */

export const CONNECTION_DIALOG_STRINGS = {
  // Dialog titles
  get TITLE_ADD() {
    return translate("settings.connectionDialog.titles.add");
  },
  get TITLE_EDIT() {
    return translate("settings.connectionDialog.titles.edit");
  },

  // Field labels
  get LABEL_NAME() {
    return translate("settings.connectionDialog.labels.name");
  },
  get LABEL_HOST() {
    return translate("settings.connectionDialog.labels.host");
  },
  get LABEL_SHARE_NAME() {
    return translate("settings.connectionDialog.labels.shareName");
  },
  get LABEL_USERNAME() {
    return translate("settings.connectionDialog.labels.username");
  },
  get LABEL_PASSWORD() {
    return translate("settings.connectionDialog.labels.password");
  },
  get LABEL_PATH_PREFIX() {
    return translate("settings.connectionDialog.labels.pathPrefix");
  },

  // Helper text / descriptions
  get HELPER_HOST() {
    return translate("settings.connectionDialog.helpers.host");
  },
  get HELPER_SHARE_NAME() {
    return translate("settings.connectionDialog.helpers.shareName");
  },
  get HELPER_PASSWORD_EDIT() {
    return translate("settings.connectionDialog.helpers.passwordEdit");
  },
  get HELPER_PATH_PREFIX() {
    return translate("settings.connectionDialog.helpers.pathPrefix");
  },
  get HELPER_USERNAME() {
    return translate("settings.connectionDialog.helpers.username");
  },
  get HELPER_VISIBILITY_ADMIN() {
    return translate("settings.connectionDialog.helpers.visibilityAdmin");
  },
  get HELPER_VISIBILITY_REGULAR() {
    return translate("settings.connectionDialog.helpers.visibilityRegular");
  },

  // Error messages
  get ERROR_NAME_REQUIRED() {
    return translate("settings.connectionDialog.errors.nameRequired");
  },
  get ERROR_HOST_REQUIRED() {
    return translate("settings.connectionDialog.errors.hostRequired");
  },
  get ERROR_SHARE_NAME_REQUIRED() {
    return translate("settings.connectionDialog.errors.shareNameRequired");
  },
  get ERROR_USERNAME_REQUIRED() {
    return translate("settings.connectionDialog.errors.usernameRequired");
  },
  get ERROR_PASSWORD_REQUIRED() {
    return translate("settings.connectionDialog.errors.passwordRequired");
  },

  // Button labels
  get BUTTON_TEST() {
    return translate("settings.connectionManagement.menuTest");
  },
  get BUTTON_CANCEL() {
    return translate("common.actions.cancel");
  },
  get BUTTON_SAVE() {
    return translate("settings.connectionDialog.actions.save");
  },

  // ARIA labels
  get ARIA_TOGGLE_PASSWORD() {
    return translate("settings.connectionDialog.aria.togglePassword");
  },
  get ARIA_GO_BACK() {
    return translate("common.navigation.goBack");
  },
} as const;
