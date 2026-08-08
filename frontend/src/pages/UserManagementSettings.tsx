import {
  Add as AddIcon,
  AdminPanelSettings as AdminIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  LockReset as LockResetIcon,
  MoreVert as MoreVertIcon,
  Person as PersonIcon,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  List,
  ListItem,
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DeleteDialog from "../components/Admin/DeleteDialog";
import { DialogReadOnlyField } from "../components/Admin/DialogReadOnlyField";
import { adminDialogActionButtonSx, adminDialogEndActionRowSx } from "../components/Admin/dialogActionStyles";
import { ResponsiveFormDialog } from "../components/Admin/ResponsiveFormDialog";
import { SettingsInlineAlert, SettingsNotificationSnackbar, type SettingsNotificationState } from "../components/Settings/SettingsFeedback";
import {
  SettingsFormFieldLabel,
  SettingsFormGroup,
  SettingsFormRow,
  SettingsFormSection,
  SettingsFormSurface,
  settingsFormFieldControlSx,
  settingsFormOutlinedControlSx,
  settingsFormSelectControlSx,
  settingsSelectMenuProps,
  settingsSelectSx,
} from "../components/Settings/SettingsFormLayout";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsPasswordVisibilityToggle } from "../components/Settings/SettingsPasswordVisibilityToggle";
import { SettingsSelectMenuItem } from "../components/Settings/SettingsSelectMenuItem";
import { SettingsEmptyState, SettingsLoadingState } from "../components/Settings/SettingsState";
import {
  settingsDestructiveIconButtonSx,
  settingsMetadataChipSx,
  settingsPrimaryButtonSx,
  settingsUtilityButtonSx,
  settingsUtilityIconButtonSx,
} from "../components/Settings/settingsButtonStyles";
import { loadUserManagementSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { settingsListItemTitleSx } from "../components/Settings/settingsTypographyStyles";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import api, { isControlledReauthenticationInProgress } from "../services/api";
import type {
  AdminUser,
  AdminUserCreateInput,
  AdminUserCreateResult,
  AdminUserPasswordResetResult,
  AdminUserUpdateInput,
  UserRole,
} from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";
import { dialogEnterKeyHandler } from "../utils/keyboardUtils";

interface UserFormState {
  username: string;
  name: string;
  email: string;
  role: UserRole;
  oidcRoleAssignment: UserRole | "";
  isActive: boolean;
  password: string;
  mustChangePassword: boolean;
  expiresAt: string;
}

interface ResetPasswordFormState {
  password: string;
  mustChangePassword: boolean;
}

interface UserManagementSettingsProps {
  dialogSafeHeader?: boolean;
}

type OidcMappingEditorMode = "create" | "change" | "move";

type UserEditorField = "username";
const OIDC_INHERITED_ROLE_VALUE = "inherited";

const USER_EDITOR_IDS = {
  username: "user-editor-username",
  usernameDescription: "user-editor-username-description",
  name: "user-editor-name",
  nameDescription: "user-editor-name-description",
  email: "user-editor-email",
  emailDescription: "user-editor-email-description",
  role: "user-editor-role",
  roleLabel: "user-editor-role-label",
  roleDescription: "user-editor-role-description",
  expiresAt: "user-editor-expires-at",
  expiresAtDescription: "user-editor-expires-at-description",
  isActive: "user-editor-is-active",
  isActiveLabel: "user-editor-is-active-label",
  isActiveDescription: "user-editor-is-active-description",
  password: "user-editor-password",
  passwordDescription: "user-editor-password-description",
  mustChangePassword: "user-editor-must-change-password",
  mustChangePasswordLabel: "user-editor-must-change-password-label",
  mustChangePasswordDescription: "user-editor-must-change-password-description",
} as const;

const DEFAULT_USER_FORM: UserFormState = {
  username: "",
  name: "",
  email: "",
  role: "editor",
  oidcRoleAssignment: "",
  isActive: true,
  password: "",
  mustChangePassword: true,
  expiresAt: "",
};

function toDateTimeLocalValue(value?: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function toIsoDateTimeValue(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  return new Date(value).toISOString();
}

const DEFAULT_RESET_PASSWORD_FORM: ResetPasswordFormState = {
  password: "",
  mustChangePassword: true,
};
const USER_ROW_COMPACT_MAX_WIDTH_PX = 640;
const USER_ROW_COMPACT_CONTAINER_QUERY = `@container (max-width: ${USER_ROW_COMPACT_MAX_WIDTH_PX}px)`;
const LOCAL_TIMESTAMP_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

function formatLocalTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, LOCAL_TIMESTAMP_FORMAT_OPTIONS).format(new Date(value));
}

export function UserManagementSettings({ dialogSafeHeader = false }: UserManagementSettingsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const usesDesktopFormLayout = useMediaQuery(theme.breakpoints.up("md"));
  const [notification, setNotification] = useState<SettingsNotificationState>({
    open: false,
    message: "",
    severity: "success",
  });
  const showNotification = useCallback((message: string, severity: "success" | "error" | "info") => {
    setNotification({ open: true, message, severity });
  }, []);
  const handleUsersLoadError = useCallback(
    (error: unknown) => {
      if (isControlledReauthenticationInProgress()) {
        return;
      }
      const message = getApiErrorMessage(error, t("settings.userManagement.notifications.loadFailed"));
      showNotification(message, "error");
    },
    [showNotification, t]
  );
  const {
    data: cachedUserManagementData,
    loading,
    refresh,
  } = useCachedAsyncData({
    cacheKey: SETTINGS_DATA_CACHE_KEYS.adminUsers,
    load: loadUserManagementSettingsData,
    onError: handleUsersLoadError,
  });
  const users = cachedUserManagementData?.users ?? [];
  const currentUserId = cachedUserManagementData?.currentUserId ?? null;
  const oidcConfiguration = cachedUserManagementData?.oidcConfiguration.configuration ?? null;
  const localPasswordManagementAvailable =
    cachedUserManagementData?.oidcConfiguration.auth_mode === "password_only" ||
    cachedUserManagementData?.oidcConfiguration.auth_mode === "oidc_or_password";
  const pendingOidcMappingsAllowed = oidcConfiguration !== null;
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordEditorOpen, setResetPasswordEditorOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [mappingEditor, setMappingEditor] = useState<{
    open: boolean;
    mode: OidcMappingEditorMode;
    user: AdminUser | null;
    expectedUsername: string;
    targetUserId: string;
  }>({ open: false, mode: "create", user: null, expectedUsername: "", targetUserId: "" });
  const [mappingSubmitting, setMappingSubmitting] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [advancedMappingMenu, setAdvancedMappingMenu] = useState<{
    anchor: HTMLElement | null;
    user: AdminUser | null;
  }>({ anchor: null, user: null });
  const [userActionsMenu, setUserActionsMenu] = useState<{
    anchor: HTMLElement | null;
    user: AdminUser | null;
  }>({ anchor: null, user: null });
  const [formState, setFormState] = useState<UserFormState>(DEFAULT_USER_FORM);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<UserEditorField, string>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [resetPasswordForm, setResetPasswordForm] = useState<ResetPasswordFormState>(DEFAULT_RESET_PASSWORD_FORM);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const resetPasswordInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [credentialsDialog, setCredentialsDialog] = useState<{
    open: boolean;
    title: string;
    username: string;
    temporaryPassword: string;
    description: string;
  }>({
    open: false,
    title: "",
    username: "",
    temporaryPassword: "",
    description: "",
  });

  const isEditing = Boolean(selectedUser);
  const isEditingSelf = Boolean(selectedUser && currentUserId && selectedUser.id === currentUserId);
  const hasOidcManagedIdentity = Boolean(selectedUser?.oidc);
  const hasOidcRoleAssignment = Boolean(selectedUser?.oidc || selectedUser?.pending_oidc);
  const inheritedOidcRole = selectedUser?.oidc?.inherited_role ?? null;
  const activeAdminCount = useMemo(() => users.filter((user) => user.role === "admin" && user.is_active !== false).length, [users]);

  const roleLabel = (role: UserRole) => {
    if (role === "admin") return t("settings.userManagement.adminRole");
    if (role === "viewer") return t("settings.userManagement.viewerRole");
    return t("settings.userManagement.editorRole");
  };

  const openMappingEditor = (user: AdminUser, mode: OidcMappingEditorMode) => {
    setMappingError(null);
    setMappingEditor({
      open: true,
      mode,
      user,
      expectedUsername: user.pending_oidc?.expected_username ?? "",
      targetUserId: "",
    });
  };

  const closeMappingEditor = () => {
    setMappingEditor({ open: false, mode: "create", user: null, expectedUsername: "", targetUserId: "" });
    setMappingError(null);
  };

  const handleMappingSubmit = async () => {
    const user = mappingEditor.user;
    if (!user || !oidcConfiguration) return;
    try {
      setMappingSubmitting(true);
      setMappingError(null);
      if (mappingEditor.mode === "move") {
        if (!user.oidc || !mappingEditor.targetUserId) {
          setMappingError("Select an available local account.");
          return;
        }
        await api.moveOidcIdentity(user.oidc.identity_id, oidcConfiguration.identity_mapping_revision, mappingEditor.targetUserId);
      } else {
        if (!pendingOidcMappingsAllowed) {
          setMappingError("Confirm that the provider username claim is stable and unique before creating pending mappings.");
          return;
        }
        const expectedUsername = mappingEditor.expectedUsername.trim();
        if (!expectedUsername) {
          setMappingError("Provider username is required.");
          return;
        }
        if (mappingEditor.mode === "change") {
          await api.changeOidcIdentity(user.id, oidcConfiguration.identity_mapping_revision, expectedUsername);
        } else {
          await api.putPendingOidcMappings(oidcConfiguration.identity_mapping_revision, [
            { target_user_id: user.id, expected_username: expectedUsername },
          ]);
        }
      }
      setMappingEditor({ open: false, mode: "create", user: null, expectedUsername: "", targetUserId: "" });
      setMappingError(null);
      showNotification("OIDC mapping updated.", "success");
      await refresh();
    } catch (error: unknown) {
      setMappingError(getApiErrorMessage(error, "The OIDC mapping could not be updated."));
    } finally {
      setMappingSubmitting(false);
    }
  };

  const handleCancelPendingMapping = async (user: AdminUser) => {
    if (!oidcConfiguration || !window.confirm(`Cancel the pending OIDC mapping for ${user.username}?`)) return;
    try {
      await api.cancelPendingOidcMapping(user.id, oidcConfiguration.identity_mapping_revision);
      showNotification("Pending OIDC mapping canceled.", "success");
      await refresh();
    } catch (error: unknown) {
      showNotification(getApiErrorMessage(error, "The pending OIDC mapping could not be canceled."), "error");
    }
  };

  const handleDetachIdentity = async (user: AdminUser) => {
    if (!oidcConfiguration || !window.confirm(`Detach the OIDC identity from ${user.username}? This does not revoke IdP access.`)) return;
    try {
      await api.detachOidcIdentity(user.id, oidcConfiguration.identity_mapping_revision);
      showNotification("OIDC identity detached.", "success");
      await refresh();
    } catch (error: unknown) {
      showNotification(getApiErrorMessage(error, "The OIDC identity could not be detached."), "error");
    }
  };

  const openCreateDialog = () => {
    setSelectedUser(null);
    setFormState(DEFAULT_USER_FORM);
    setFieldErrors({});
    setSubmissionError(null);
    setShowInitialPassword(false);
    setEditorOpen(true);
  };

  const openEditDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setFormState({
      username: user.username,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role,
      oidcRoleAssignment: user.oidc_role_assignment ?? "",
      isActive: user.is_active,
      password: "",
      mustChangePassword: user.must_change_password,
      expiresAt: toDateTimeLocalValue(user.expires_at),
    });
    setFieldErrors({});
    setSubmissionError(null);
    setShowInitialPassword(false);
    setEditorOpen(true);
  };

  const closeUserActionsMenu = () => {
    setUserActionsMenu({ anchor: null, user: null });
  };

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setSelectedUser(null);
    setFormState(DEFAULT_USER_FORM);
    setFieldErrors({});
    setSubmissionError(null);
    setShowInitialPassword(false);
  }, []);

  const handleSave = useCallback(async () => {
    const username = formState.username.trim();
    const name = formState.name.trim();
    const email = formState.email.trim().toLowerCase();
    if (!username) {
      setFieldErrors({ username: t("settings.userManagement.notifications.usernameRequired") });
      setSubmissionError(null);
      requestAnimationFrame(() => {
        document.getElementById(USER_EDITOR_IDS.username)?.focus();
      });
      return;
    }
    if (users.some((user) => user.id !== selectedUser?.id && user.username === username)) {
      setFieldErrors({ username: t("settings.userManagement.editor.usernameTaken") });
      setSubmissionError(null);
      requestAnimationFrame(() => {
        document.getElementById(USER_EDITOR_IDS.username)?.focus();
      });
      return;
    }

    const expiresAt = toIsoDateTimeValue(formState.expiresAt);

    try {
      setSubmitting(true);
      setFieldErrors({});
      setSubmissionError(null);

      if (selectedUser) {
        const updatePayload: AdminUserUpdateInput = {
          username,
          ...(!hasOidcManagedIdentity ? { name: name || undefined, email: email || undefined } : {}),
          role: formState.role,
          ...(hasOidcRoleAssignment ? { oidc_role_assignment: formState.oidcRoleAssignment || null } : {}),
          is_active: formState.isActive,
          expires_at: expiresAt ?? null,
        };
        await api.updateUser(selectedUser.id, updatePayload);
        showNotification(t("settings.userManagement.notifications.userUpdated"), "success");
      } else {
        const createPayload: AdminUserCreateInput = {
          username,
          name: name || undefined,
          email: email || undefined,
          role: formState.role,
          must_change_password: formState.mustChangePassword,
          password: formState.password.trim() ? formState.password : undefined,
          expires_at: expiresAt,
        };
        const result: AdminUserCreateResult = await api.createUser(createPayload);
        showNotification(t("settings.userManagement.notifications.userCreated"), "success");
        if (result.temporary_password) {
          setCredentialsDialog({
            open: true,
            title: t("settings.userManagement.credentialsDialog.createTitle"),
            username: result.username,
            temporaryPassword: result.temporary_password,
            description: t("settings.userManagement.credentialsDialog.createDescription"),
          });
        }
      }

      closeEditor();
      await refresh();
    } catch (error: unknown) {
      const message = getApiErrorMessage(
        error,
        isEditing ? t("settings.userManagement.notifications.updateFailed") : t("settings.userManagement.notifications.createFailed")
      );
      setSubmissionError(message);
    } finally {
      setSubmitting(false);
    }
  }, [closeEditor, formState, hasOidcManagedIdentity, hasOidcRoleAssignment, isEditing, refresh, selectedUser, showNotification, t, users]);

  const handleEditorKeyDown = useMemo(
    () =>
      dialogEnterKeyHandler(() => {
        void handleSave();
      }),
    [handleSave]
  );

  const handleEditorClose = useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  const openResetPasswordDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setResetPasswordForm(DEFAULT_RESET_PASSWORD_FORM);
    setResetPasswordError(null);
    setShowResetPassword(false);
    setResetPasswordEditorOpen(true);
  };

  const closeResetPasswordEditor = useCallback(() => {
    setResetPasswordEditorOpen(false);
    setResetPasswordForm(DEFAULT_RESET_PASSWORD_FORM);
    setResetPasswordError(null);
    setShowResetPassword(false);
    setSelectedUser(null);
  }, []);

  const handleResetPasswordEditorClose = useCallback(() => {
    closeResetPasswordEditor();
  }, [closeResetPasswordEditor]);

  const handleResetPassword = async () => {
    if (!selectedUser) {
      return;
    }

    if (!resetPasswordForm.password.trim()) {
      setResetPasswordError(t("settings.userManagement.resetPasswordEditor.passwordRequired"));
      return;
    }

    try {
      setResetPasswordSubmitting(true);
      setResetPasswordError(null);
      const result: AdminUserPasswordResetResult = await api.resetUserPassword(selectedUser.id, {
        new_password: resetPasswordForm.password,
        must_change_password: resetPasswordForm.mustChangePassword,
      });
      closeResetPasswordEditor();
      showNotification(result.message, "success");
      await refresh();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.userManagement.notifications.resetFailed"));
      setResetPasswordError(message);
    } finally {
      setResetPasswordSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) {
      return;
    }

    try {
      setDeleteSubmitting(true);
      await api.deleteUser(selectedUser.id);
      showNotification(t("settings.userManagement.notifications.userDeleted"), "success");
      setDeleteDialogOpen(false);
      setSelectedUser(null);
      await refresh();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.userManagement.notifications.deleteFailed"));
      showNotification(message, "error");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const editorActions = (
    <Box sx={adminDialogEndActionRowSx}>
      <Button onClick={closeEditor} disabled={submitting} variant="outlined" sx={[settingsUtilityButtonSx, adminDialogActionButtonSx]}>
        {t("common.actions.cancel")}
      </Button>
      <Button
        onClick={handleSave}
        variant="contained"
        disabled={submitting}
        startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
        sx={[settingsPrimaryButtonSx, adminDialogActionButtonSx]}
      >
        {isEditing ? t("settings.userManagement.actions.saveChanges") : t("settings.userManagement.actions.createUser")}
      </Button>
    </Box>
  );

  const mappingEditorActions = (
    <Box sx={adminDialogEndActionRowSx}>
      <Button
        onClick={closeMappingEditor}
        disabled={mappingSubmitting}
        variant="outlined"
        sx={[settingsUtilityButtonSx, adminDialogActionButtonSx]}
      >
        Cancel
      </Button>
      <Button
        onClick={() => void handleMappingSubmit()}
        disabled={mappingSubmitting}
        variant="contained"
        startIcon={mappingSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}
        sx={[settingsPrimaryButtonSx, adminDialogActionButtonSx]}
      >
        Confirm
      </Button>
    </Box>
  );

  const renderDesktopLabel = (
    label: string,
    description: string,
    descriptionId: string,
    htmlFor?: string,
    required = false,
    id?: string,
    hasError = false
  ) =>
    usesDesktopFormLayout ? (
      <SettingsFormFieldLabel
        label={label}
        description={description}
        descriptionId={descriptionId}
        htmlFor={htmlFor}
        required={required}
        id={id}
        hasError={hasError}
      />
    ) : null;

  const editorContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {submissionError && <SettingsInlineAlert sx={{ mb: 0 }}>{submissionError}</SettingsInlineAlert>}
      <SettingsFormSurface testId="user-editor-form-surface">
        <SettingsFormGroup testId="user-editor-identity-fields">
          <SettingsFormRow>
            {renderDesktopLabel(
              t("settings.userManagement.editor.usernameLabel"),
              fieldErrors.username || t("settings.userManagement.editor.usernameHelp"),
              USER_EDITOR_IDS.usernameDescription,
              USER_EDITOR_IDS.username,
              true,
              undefined,
              Boolean(fieldErrors.username)
            )}
            <Box sx={settingsFormFieldControlSx}>
              <TextField
                id={USER_EDITOR_IDS.username}
                label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.usernameLabel")}
                hiddenLabel={usesDesktopFormLayout}
                value={formState.username}
                onChange={(event) => {
                  const nextUsername = event.target.value;
                  setFormState((current) => ({ ...current, username: nextUsername }));
                  setFieldErrors(
                    users.some((user) => user.id !== selectedUser?.id && user.username === nextUsername.trim())
                      ? { username: t("settings.userManagement.editor.usernameTaken") }
                      : {}
                  );
                }}
                autoFocus
                error={Boolean(fieldErrors.username)}
                helperText={usesDesktopFormLayout ? undefined : fieldErrors.username || t("settings.userManagement.editor.usernameHelp")}
                fullWidth
                required
                variant="outlined"
                size={usesDesktopFormLayout ? "small" : "medium"}
                sx={settingsFormOutlinedControlSx}
                slotProps={{
                  htmlInput: { "aria-describedby": usesDesktopFormLayout ? USER_EDITOR_IDS.usernameDescription : undefined },
                }}
              />
            </Box>
          </SettingsFormRow>
          <SettingsFormRow>
            {renderDesktopLabel(
              t("settings.userManagement.editor.nameLabel"),
              hasOidcManagedIdentity ? t("settings.userManagement.editor.oidcNameHelp") : t("settings.userManagement.editor.nameHelp"),
              USER_EDITOR_IDS.nameDescription,
              USER_EDITOR_IDS.name
            )}
            <Box sx={settingsFormFieldControlSx}>
              {hasOidcManagedIdentity ? (
                <>
                  <DialogReadOnlyField
                    id={USER_EDITOR_IDS.name}
                    label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.nameLabel")}
                    ariaLabel={usesDesktopFormLayout ? t("settings.userManagement.editor.nameLabel") : undefined}
                    ariaDescribedBy={usesDesktopFormLayout ? USER_EDITOR_IDS.nameDescription : undefined}
                    value={formState.name}
                    sx={{ "& .MuiInputBase-root": { minHeight: usesDesktopFormLayout ? 40 : undefined } }}
                  />
                  {!usesDesktopFormLayout && <FormHelperText>{t("settings.userManagement.editor.oidcNameHelp")}</FormHelperText>}
                </>
              ) : (
                <TextField
                  id={USER_EDITOR_IDS.name}
                  label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.nameLabel")}
                  hiddenLabel={usesDesktopFormLayout}
                  value={formState.name}
                  onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                  helperText={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.nameHelp")}
                  fullWidth
                  variant="outlined"
                  size={usesDesktopFormLayout ? "small" : "medium"}
                  sx={settingsFormOutlinedControlSx}
                  slotProps={{ htmlInput: { "aria-describedby": usesDesktopFormLayout ? USER_EDITOR_IDS.nameDescription : undefined } }}
                />
              )}
            </Box>
          </SettingsFormRow>
          <SettingsFormRow>
            {renderDesktopLabel(
              t("settings.userManagement.editor.emailLabel"),
              hasOidcManagedIdentity ? t("settings.userManagement.editor.oidcEmailHelp") : t("settings.userManagement.editor.emailHelp"),
              USER_EDITOR_IDS.emailDescription,
              USER_EDITOR_IDS.email
            )}
            <Box sx={settingsFormFieldControlSx}>
              {hasOidcManagedIdentity ? (
                <>
                  <DialogReadOnlyField
                    id={USER_EDITOR_IDS.email}
                    label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.emailLabel")}
                    ariaLabel={usesDesktopFormLayout ? t("settings.userManagement.editor.emailLabel") : undefined}
                    ariaDescribedBy={usesDesktopFormLayout ? USER_EDITOR_IDS.emailDescription : undefined}
                    value={formState.email}
                    sx={{ "& .MuiInputBase-root": { minHeight: usesDesktopFormLayout ? 40 : undefined } }}
                  />
                  {!usesDesktopFormLayout && <FormHelperText>{t("settings.userManagement.editor.oidcEmailHelp")}</FormHelperText>}
                </>
              ) : (
                <TextField
                  id={USER_EDITOR_IDS.email}
                  label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.emailLabel")}
                  hiddenLabel={usesDesktopFormLayout}
                  type="email"
                  value={formState.email}
                  onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                  helperText={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.emailHelp")}
                  fullWidth
                  variant="outlined"
                  size={usesDesktopFormLayout ? "small" : "medium"}
                  sx={settingsFormOutlinedControlSx}
                  slotProps={{ htmlInput: { "aria-describedby": usesDesktopFormLayout ? USER_EDITOR_IDS.emailDescription : undefined } }}
                />
              )}
            </Box>
          </SettingsFormRow>
        </SettingsFormGroup>
        <SettingsFormSection title={t("settings.userManagement.editor.sections.access")} />
        <SettingsFormGroup>
          <SettingsFormRow>
            {renderDesktopLabel(
              t("settings.userManagement.editor.roleLabel"),
              hasOidcRoleAssignment ? t("settings.userManagement.editor.oidcRoleHelp") : t("settings.userManagement.editor.roleHelp"),
              USER_EDITOR_IDS.roleDescription,
              undefined,
              false,
              USER_EDITOR_IDS.roleLabel
            )}
            <FormControl
              fullWidth={!usesDesktopFormLayout}
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={usesDesktopFormLayout ? [settingsFormOutlinedControlSx, settingsFormSelectControlSx] : settingsFormOutlinedControlSx}
            >
              {!usesDesktopFormLayout && (
                <InputLabel id={USER_EDITOR_IDS.roleLabel}>{t("settings.userManagement.editor.roleLabel")}</InputLabel>
              )}
              <Select
                id={USER_EDITOR_IDS.role}
                labelId={USER_EDITOR_IDS.roleLabel}
                aria-describedby={usesDesktopFormLayout ? USER_EDITOR_IDS.roleDescription : undefined}
                label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.roleLabel")}
                value={hasOidcRoleAssignment ? formState.oidcRoleAssignment || OIDC_INHERITED_ROLE_VALUE : formState.role}
                size={usesDesktopFormLayout ? "small" : "medium"}
                sx={settingsSelectSx}
                MenuProps={settingsSelectMenuProps}
                disabled={isEditingSelf}
                onChange={(event) => {
                  const selectedRole = event.target.value as UserRole | typeof OIDC_INHERITED_ROLE_VALUE;
                  setFormState((current) => ({
                    ...current,
                    role: selectedRole === OIDC_INHERITED_ROLE_VALUE ? (inheritedOidcRole ?? current.role) : selectedRole,
                    oidcRoleAssignment: selectedRole === OIDC_INHERITED_ROLE_VALUE ? "" : selectedRole,
                  }));
                }}
                renderValue={(selected) => {
                  if (selected === OIDC_INHERITED_ROLE_VALUE) {
                    return inheritedOidcRole
                      ? t("settings.userManagement.editor.inheritedRole", { role: roleLabel(inheritedOidcRole) })
                      : t("settings.userManagement.editor.inheritedRoleUnknown");
                  }
                  return roleLabel(selected as UserRole);
                }}
              >
                {hasOidcRoleAssignment && (
                  <SettingsSelectMenuItem
                    value={OIDC_INHERITED_ROLE_VALUE}
                    label={
                      inheritedOidcRole
                        ? t("settings.userManagement.editor.inheritedRole", { role: roleLabel(inheritedOidcRole) })
                        : t("settings.userManagement.editor.inheritedRoleUnknown")
                    }
                    description={t("settings.userManagement.editor.inheritedRoleDescription")}
                  />
                )}
                <SettingsSelectMenuItem
                  value="editor"
                  label={
                    inheritedOidcRole === "editor"
                      ? `${t("settings.userManagement.editorRole")} (${t("settings.userManagement.editor.currentInheritedRole")})`
                      : t("settings.userManagement.editorRole")
                  }
                  description={
                    inheritedOidcRole === "editor"
                      ? t("settings.userManagement.editor.inheritedRoleDescription")
                      : t("settings.userManagement.editor.roleOptions.editor")
                  }
                />
                <SettingsSelectMenuItem
                  value="viewer"
                  label={
                    inheritedOidcRole === "viewer"
                      ? `${t("settings.userManagement.viewerRole")} (${t("settings.userManagement.editor.currentInheritedRole")})`
                      : t("settings.userManagement.viewerRole")
                  }
                  description={
                    inheritedOidcRole === "viewer"
                      ? t("settings.userManagement.editor.inheritedRoleDescription")
                      : t("settings.userManagement.editor.roleOptions.viewer")
                  }
                />
                <SettingsSelectMenuItem
                  value="admin"
                  label={
                    inheritedOidcRole === "admin"
                      ? `${t("settings.userManagement.adminRole")} (${t("settings.userManagement.editor.currentInheritedRole")})`
                      : t("settings.userManagement.adminRole")
                  }
                  description={
                    inheritedOidcRole === "admin"
                      ? t("settings.userManagement.editor.inheritedRoleDescription")
                      : t("settings.userManagement.editor.roleOptions.admin")
                  }
                />
              </Select>
              {!usesDesktopFormLayout && (
                <FormHelperText>
                  {hasOidcRoleAssignment ? t("settings.userManagement.editor.oidcRoleHelp") : t("settings.userManagement.editor.roleHelp")}
                </FormHelperText>
              )}
            </FormControl>
          </SettingsFormRow>
          <SettingsFormRow>
            {renderDesktopLabel(
              t("settings.userManagement.editor.expiresAtLabel"),
              t("settings.userManagement.editor.expiresAtHelp"),
              USER_EDITOR_IDS.expiresAtDescription,
              USER_EDITOR_IDS.expiresAt
            )}
            <Box sx={[settingsFormFieldControlSx, { maxWidth: { md: 260 } }]}>
              <TextField
                id={USER_EDITOR_IDS.expiresAt}
                label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.expiresAtLabel")}
                hiddenLabel={usesDesktopFormLayout}
                type="datetime-local"
                value={formState.expiresAt}
                onChange={(event) => setFormState((current) => ({ ...current, expiresAt: event.target.value }))}
                fullWidth
                variant="outlined"
                size={usesDesktopFormLayout ? "small" : "medium"}
                helperText={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.expiresAtHelp")}
                sx={settingsFormOutlinedControlSx}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { "aria-describedby": usesDesktopFormLayout ? USER_EDITOR_IDS.expiresAtDescription : undefined },
                }}
              />
            </Box>
          </SettingsFormRow>
          {isEditing && (
            <SettingsFormRow>
              {renderDesktopLabel(
                t("settings.userManagement.editor.accountActiveLabel"),
                t("settings.userManagement.editor.accountActiveHelp"),
                USER_EDITOR_IDS.isActiveDescription,
                USER_EDITOR_IDS.isActive,
                false,
                USER_EDITOR_IDS.isActiveLabel
              )}
              <Box sx={settingsFormFieldControlSx}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                  {!usesDesktopFormLayout && (
                    <Typography id={USER_EDITOR_IDS.isActiveLabel} variant="body2" sx={{ mr: "auto" }}>
                      {t("settings.userManagement.editor.accountActiveLabel")}
                    </Typography>
                  )}
                  <Typography component="span" variant="body2" aria-live="polite">
                    {formState.isActive ? t("settings.userManagement.editor.switchOn") : t("settings.userManagement.editor.switchOff")}
                  </Typography>
                  <Switch
                    checked={formState.isActive}
                    disabled={isEditingSelf}
                    onChange={(event) => setFormState((current) => ({ ...current, isActive: event.target.checked }))}
                    slotProps={{
                      input: {
                        id: USER_EDITOR_IDS.isActive,
                        "aria-label": `${t("settings.userManagement.editor.accountActiveLabel")}: ${
                          formState.isActive ? t("settings.userManagement.editor.switchOn") : t("settings.userManagement.editor.switchOff")
                        }`,
                        "aria-describedby": USER_EDITOR_IDS.isActiveDescription,
                      },
                    }}
                  />
                </Box>
                {!usesDesktopFormLayout && <FormHelperText>{t("settings.userManagement.editor.accountActiveHelp")}</FormHelperText>}
              </Box>
            </SettingsFormRow>
          )}
        </SettingsFormGroup>
        {!isEditing && (
          <>
            <SettingsFormSection title={t("settings.userManagement.editor.sections.credentials")} />
            <SettingsFormGroup>
              <SettingsFormRow>
                {renderDesktopLabel(
                  t("settings.userManagement.editor.initialPasswordLabel"),
                  t("settings.userManagement.editor.initialPasswordHelp"),
                  USER_EDITOR_IDS.passwordDescription,
                  USER_EDITOR_IDS.password
                )}
                <Box sx={settingsFormFieldControlSx}>
                  <TextField
                    id={USER_EDITOR_IDS.password}
                    label={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.initialPasswordLabel")}
                    hiddenLabel={usesDesktopFormLayout}
                    type={showInitialPassword ? "text" : "password"}
                    value={formState.password}
                    onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
                    helperText={usesDesktopFormLayout ? undefined : t("settings.userManagement.editor.initialPasswordHelp")}
                    fullWidth
                    variant="outlined"
                    size={usesDesktopFormLayout ? "small" : "medium"}
                    sx={settingsFormOutlinedControlSx}
                    slotProps={{
                      htmlInput: { "aria-describedby": usesDesktopFormLayout ? USER_EDITOR_IDS.passwordDescription : undefined },
                      input: {
                        endAdornment: (
                          <SettingsPasswordVisibilityToggle
                            visible={showInitialPassword}
                            onToggle={() => setShowInitialPassword((current) => !current)}
                            showLabel={t("settings.userManagement.editor.showInitialPassword")}
                            hideLabel={t("settings.userManagement.editor.hideInitialPassword")}
                          />
                        ),
                      },
                    }}
                  />
                </Box>
              </SettingsFormRow>
              <SettingsFormRow>
                {renderDesktopLabel(
                  t("settings.userManagement.editor.requirePasswordChangeLabel"),
                  t("settings.userManagement.editor.requirePasswordChangeHelp"),
                  USER_EDITOR_IDS.mustChangePasswordDescription,
                  USER_EDITOR_IDS.mustChangePassword,
                  false,
                  USER_EDITOR_IDS.mustChangePasswordLabel
                )}
                <Box sx={settingsFormFieldControlSx}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                    {!usesDesktopFormLayout && (
                      <Typography id={USER_EDITOR_IDS.mustChangePasswordLabel} variant="body2" sx={{ mr: "auto" }}>
                        {t("settings.userManagement.editor.requirePasswordChangeLabel")}
                      </Typography>
                    )}
                    <Typography component="span" variant="body2" aria-live="polite">
                      {formState.mustChangePassword
                        ? t("settings.userManagement.editor.switchOn")
                        : t("settings.userManagement.editor.switchOff")}
                    </Typography>
                    <Switch
                      checked={formState.mustChangePassword}
                      onChange={(event) => setFormState((current) => ({ ...current, mustChangePassword: event.target.checked }))}
                      slotProps={{
                        input: {
                          id: USER_EDITOR_IDS.mustChangePassword,
                          "aria-label": `${t("settings.userManagement.editor.requirePasswordChangeLabel")}: ${
                            formState.mustChangePassword
                              ? t("settings.userManagement.editor.switchOn")
                              : t("settings.userManagement.editor.switchOff")
                          }`,
                          "aria-describedby": USER_EDITOR_IDS.mustChangePasswordDescription,
                        },
                      }}
                    />
                  </Box>
                  {!usesDesktopFormLayout && (
                    <FormHelperText>{t("settings.userManagement.editor.requirePasswordChangeHelp")}</FormHelperText>
                  )}
                </Box>
              </SettingsFormRow>
            </SettingsFormGroup>
          </>
        )}
      </SettingsFormSurface>
    </Box>
  );

  const credentialsDialogActions = (
    <Box sx={adminDialogEndActionRowSx}>
      <Button
        onClick={() => setCredentialsDialog((current) => ({ ...current, open: false }))}
        variant="contained"
        sx={[settingsPrimaryButtonSx, adminDialogActionButtonSx]}
      >
        {t("settings.userManagement.actions.close")}
      </Button>
    </Box>
  );

  const credentialsDialogContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <TextField
        label={t("settings.userManagement.credentialsDialog.usernameLabel")}
        value={credentialsDialog.username}
        slotProps={{ input: { readOnly: true } }}
        fullWidth
        variant="outlined"
      />
      <TextField
        label={t("settings.userManagement.credentialsDialog.temporaryPasswordLabel")}
        value={credentialsDialog.temporaryPassword}
        slotProps={{ input: { readOnly: true } }}
        fullWidth
        variant="outlined"
      />
    </Box>
  );

  const resetPasswordEditorActions = (
    <Box sx={adminDialogEndActionRowSx}>
      <Button
        onClick={handleResetPasswordEditorClose}
        disabled={resetPasswordSubmitting}
        variant="outlined"
        sx={[settingsUtilityButtonSx, adminDialogActionButtonSx]}
      >
        {t("common.actions.cancel")}
      </Button>
      <Button
        onClick={() => {
          void handleResetPassword();
        }}
        variant="contained"
        disabled={resetPasswordSubmitting}
        startIcon={resetPasswordSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}
        sx={[settingsPrimaryButtonSx, adminDialogActionButtonSx]}
      >
        {t("settings.userManagement.resetPasswordEditor.submit")}
      </Button>
    </Box>
  );

  const resetPasswordEditorContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {resetPasswordError && <SettingsInlineAlert sx={{ mb: 0 }}>{resetPasswordError}</SettingsInlineAlert>}
      <SettingsFormSurface testId="reset-password-editor-form-surface">
        <SettingsFormGroup>
          <SettingsFormRow sx={{ gridTemplateColumns: { md: "minmax(0, 1fr)" } }}>
            <TextField
              label={t("settings.userManagement.resetPasswordEditor.passwordLabel")}
              type={showResetPassword ? "text" : "password"}
              value={resetPasswordForm.password}
              onChange={(event) => setResetPasswordForm((current) => ({ ...current, password: event.target.value }))}
              helperText={t("settings.userManagement.resetPasswordEditor.passwordHelp")}
              autoFocus
              inputRef={resetPasswordInputRef}
              fullWidth
              variant="outlined"
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                input: {
                  endAdornment: (
                    <SettingsPasswordVisibilityToggle
                      visible={showResetPassword}
                      onToggle={() => setShowResetPassword((current) => !current)}
                      showLabel={t("settings.userManagement.resetPasswordEditor.showPassword")}
                      hideLabel={t("settings.userManagement.resetPasswordEditor.hidePassword")}
                    />
                  ),
                },
              }}
            />
          </SettingsFormRow>
          <SettingsFormRow sx={{ gridTemplateColumns: { md: "minmax(0, 1fr)" } }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
              <Typography variant="body2" sx={{ mr: "auto" }}>
                {t("settings.userManagement.resetPasswordEditor.requirePasswordChangeLabel")}
              </Typography>
              <Typography component="span" variant="body2" aria-live="polite">
                {resetPasswordForm.mustChangePassword
                  ? t("settings.userManagement.editor.switchOn")
                  : t("settings.userManagement.editor.switchOff")}
              </Typography>
              <Switch
                checked={resetPasswordForm.mustChangePassword}
                onChange={(event) => setResetPasswordForm((current) => ({ ...current, mustChangePassword: event.target.checked }))}
                slotProps={{
                  input: {
                    "aria-label": `${t("settings.userManagement.resetPasswordEditor.requirePasswordChangeLabel")}: ${
                      resetPasswordForm.mustChangePassword
                        ? t("settings.userManagement.editor.switchOn")
                        : t("settings.userManagement.editor.switchOff")
                    }`,
                  },
                }}
              />
            </Box>
          </SettingsFormRow>
        </SettingsFormGroup>
      </SettingsFormSurface>
    </Box>
  );

  return (
    <SettingsPage
      category="admin-users"
      dialogSafeHeader={dialogSafeHeader}
      footerSecondaryActions={
        localPasswordManagementAvailable ? (
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreateDialog} sx={settingsUtilityButtonSx}>
            {t("settings.userManagement.addUserButton")}
          </Button>
        ) : undefined
      }
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Chip
            label={t("settings.userManagement.totalUsers", { count: users.length })}
            size="small"
            variant="outlined"
            sx={settingsMetadataChipSx}
          />
          <Chip
            label={t("settings.userManagement.activeAdmins", { count: activeAdminCount })}
            size="small"
            variant="outlined"
            sx={settingsMetadataChipSx}
          />
        </Stack>
        {loading ? (
          <SettingsLoadingState />
        ) : users.length === 0 ? (
          <SettingsEmptyState title={t("settings.userManagement.emptyTitle")} description={t("settings.userManagement.emptyDescription")} />
        ) : (
          <List sx={{ py: 0 }}>
            {users.map((user) => {
              const isSelf = Boolean(currentUserId && user.id === currentUserId);
              return (
                <ListItem
                  key={user.id}
                  sx={{
                    px: 0,
                    py: 2,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Box
                    data-testid="user-row"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      flexWrap: "wrap",
                      width: "100%",
                      containerType: "inline-size",
                    }}
                  >
                    <Box
                      sx={{
                        minWidth: 0,
                        flex: "1 1 0",
                      }}
                    >
                      <Typography component="div" variant="body1" sx={settingsListItemTitleSx}>
                        {user.name?.trim() ? user.name : user.username}
                      </Typography>
                      {(user.name || user.email) && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                          {[user.username, user.email].filter(Boolean).join(" • ")}
                        </Typography>
                      )}
                      <Stack
                        data-testid="user-metadata"
                        direction="row"
                        spacing={1}
                        useFlexGap
                        alignItems="center"
                        sx={{
                          flexWrap: "wrap",
                          rowGap: 1,
                          mt: 0.75,
                          mb: 1,
                          "& .MuiChip-root": { maxWidth: "100%" },
                          "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                        }}
                      >
                        {isSelf && (
                          <Chip
                            size="small"
                            label={t("settings.userManagement.currentUserChip")}
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                        <Chip
                          size="small"
                          icon={user.role === "admin" ? <AdminIcon /> : <PersonIcon />}
                          label={
                            user.role === "admin"
                              ? t("settings.userManagement.adminRole")
                              : user.role === "viewer"
                                ? t("settings.userManagement.viewerRole")
                                : t("settings.userManagement.editorRole")
                          }
                          variant="outlined"
                          sx={settingsMetadataChipSx}
                        />
                        <Chip
                          size="small"
                          label={user.is_active ? t("settings.userManagement.activeStatus") : t("settings.userManagement.disabledStatus")}
                          variant="outlined"
                          sx={settingsMetadataChipSx}
                        />
                        {localPasswordManagementAvailable && user.must_change_password && (
                          <Chip
                            size="small"
                            label={t("settings.userManagement.passwordResetPending")}
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                        {localPasswordManagementAvailable && user.has_local_password && (
                          <Chip size="small" label="Local password" variant="outlined" sx={settingsMetadataChipSx} />
                        )}
                        {user.oidc && <Chip size="small" label="OIDC linked" variant="outlined" sx={settingsMetadataChipSx} />}
                        {user.oidc?.last_login_at && (
                          <Chip
                            size="small"
                            label={`OIDC last login: ${formatLocalTimestamp(user.oidc.last_login_at)}`}
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                        {user.pending_oidc && (
                          <Chip
                            size="small"
                            label={`Waiting for first OIDC login: ${user.pending_oidc.expected_username}, created by ${
                              user.pending_oidc.created_by_username
                            } on ${new Date(user.pending_oidc.created_at).toLocaleString()}`}
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                        {(user.oidc || user.pending_oidc) && (
                          <Chip
                            size="small"
                            label={
                              user.oidc_role_assignment
                                ? `OIDC role: ${user.oidc_role_assignment} (individual)`
                                : `OIDC role: ${oidcConfiguration?.role_assignment_mode === "group_based" ? "group-based" : "uniform"}`
                            }
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                        {user.expires_at && (
                          <Chip
                            size="small"
                            label={t("settings.userManagement.expiresAt", { timestamp: user.expires_at })}
                            variant="outlined"
                            sx={settingsMetadataChipSx}
                          />
                        )}
                      </Stack>
                    </Box>

                    <Stack
                      data-testid="user-row-actions"
                      direction="row"
                      spacing={1}
                      sx={{
                        alignSelf: "center",
                        [USER_ROW_COMPACT_CONTAINER_QUERY]: { display: "none" },
                      }}
                    >
                      {oidcConfiguration && !user.oidc && !user.pending_oidc && (
                        <Tooltip
                          title={
                            pendingOidcMappingsAllowed
                              ? "Map OIDC account"
                              : "Confirm username claim uniqueness in Authentication settings before mapping accounts"
                          }
                        >
                          <span>
                            <IconButton
                              aria-label={`Map OIDC account for ${user.username}`}
                              disabled={!pendingOidcMappingsAllowed}
                              onClick={() => openMappingEditor(user, "create")}
                            >
                              <LinkIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      {oidcConfiguration && user.pending_oidc && (
                        <Tooltip title="Cancel pending OIDC mapping">
                          <IconButton
                            aria-label={`Cancel pending OIDC mapping for ${user.username}`}
                            onClick={() => void handleCancelPendingMapping(user)}
                          >
                            <LinkOffIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {oidcConfiguration && user.oidc && (
                        <Tooltip title="Advanced OIDC actions">
                          <IconButton
                            aria-label={`Advanced OIDC actions for ${user.username}`}
                            onClick={(event) => setAdvancedMappingMenu({ anchor: event.currentTarget, user })}
                          >
                            <MoreVertIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={t("settings.userManagement.actions.editUser")}>
                        <span>
                          <IconButton
                            aria-label={t("settings.userManagement.aria.editUser", { username: user.username })}
                            onClick={() => openEditDialog(user)}
                            sx={settingsUtilityIconButtonSx}
                          >
                            <EditIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      {localPasswordManagementAvailable && user.has_local_password && (
                        <Tooltip title={t("settings.userManagement.actions.resetPassword")}>
                          <span>
                            <IconButton
                              aria-label={t("settings.userManagement.aria.resetPassword", { username: user.username })}
                              onClick={() => openResetPasswordDialog(user)}
                              sx={settingsUtilityIconButtonSx}
                            >
                              <LockResetIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      <Tooltip
                        title={
                          isSelf ? t("settings.userManagement.actions.deleteSelfDisabled") : t("settings.userManagement.actions.deleteUser")
                        }
                      >
                        <span>
                          <IconButton
                            aria-label={t("settings.userManagement.aria.deleteUser", { username: user.username })}
                            disabled={isSelf}
                            onClick={() => {
                              setSelectedUser(user);
                              setDeleteDialogOpen(true);
                            }}
                            sx={settingsDestructiveIconButtonSx}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <Box
                      data-testid="user-row-action-menu"
                      sx={{
                        display: "none",
                        flexShrink: 0,
                        alignSelf: "flex-start",
                        [USER_ROW_COMPACT_CONTAINER_QUERY]: { display: "flex" },
                      }}
                    >
                      <Tooltip title="User actions">
                        <IconButton
                          aria-label={`User actions for ${user.username}`}
                          onClick={(event) => setUserActionsMenu({ anchor: event.currentTarget, user })}
                          sx={settingsUtilityIconButtonSx}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </ListItem>
              );
            })}
          </List>
        )}
      </Stack>

      <Menu
        anchorEl={advancedMappingMenu.anchor}
        open={Boolean(advancedMappingMenu.anchor)}
        onClose={() => setAdvancedMappingMenu({ anchor: null, user: null })}
      >
        <MenuItem
          disabled={!pendingOidcMappingsAllowed}
          onClick={() => {
            const user = advancedMappingMenu.user;
            setAdvancedMappingMenu({ anchor: null, user: null });
            if (user) openMappingEditor(user, "change");
          }}
        >
          Change OIDC account
        </MenuItem>
        <MenuItem
          onClick={() => {
            const user = advancedMappingMenu.user;
            setAdvancedMappingMenu({ anchor: null, user: null });
            if (user) openMappingEditor(user, "move");
          }}
        >
          Move identity to another local user
        </MenuItem>
        <MenuItem
          onClick={() => {
            const user = advancedMappingMenu.user;
            setAdvancedMappingMenu({ anchor: null, user: null });
            if (user) void handleDetachIdentity(user);
          }}
        >
          Detach OIDC identity
        </MenuItem>
      </Menu>

      <Menu anchorEl={userActionsMenu.anchor} open={Boolean(userActionsMenu.anchor)} onClose={closeUserActionsMenu}>
        {userActionsMenu.user && (
          <>
            {oidcConfiguration && !userActionsMenu.user.oidc && !userActionsMenu.user.pending_oidc && (
              <MenuItem
                disabled={!pendingOidcMappingsAllowed}
                onClick={() => {
                  const user = userActionsMenu.user;
                  closeUserActionsMenu();
                  if (user) openMappingEditor(user, "create");
                }}
              >
                <LinkIcon fontSize="small" sx={{ mr: 1.5 }} />
                Map OIDC account
              </MenuItem>
            )}
            {oidcConfiguration && userActionsMenu.user.pending_oidc && (
              <MenuItem
                onClick={() => {
                  const user = userActionsMenu.user;
                  closeUserActionsMenu();
                  if (user) void handleCancelPendingMapping(user);
                }}
              >
                <LinkOffIcon fontSize="small" sx={{ mr: 1.5 }} />
                Cancel pending OIDC mapping
              </MenuItem>
            )}
            {oidcConfiguration && userActionsMenu.user.oidc && (
              <>
                <MenuItem
                  disabled={!pendingOidcMappingsAllowed}
                  onClick={() => {
                    const user = userActionsMenu.user;
                    closeUserActionsMenu();
                    if (user) openMappingEditor(user, "change");
                  }}
                >
                  <LinkIcon fontSize="small" sx={{ mr: 1.5 }} />
                  Change OIDC account
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const user = userActionsMenu.user;
                    closeUserActionsMenu();
                    if (user) openMappingEditor(user, "move");
                  }}
                >
                  <MoreVertIcon fontSize="small" sx={{ mr: 1.5 }} />
                  Move identity to another local user
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const user = userActionsMenu.user;
                    closeUserActionsMenu();
                    if (user) void handleDetachIdentity(user);
                  }}
                >
                  <LinkOffIcon fontSize="small" sx={{ mr: 1.5 }} />
                  Detach OIDC identity
                </MenuItem>
              </>
            )}
            <MenuItem
              onClick={() => {
                const user = userActionsMenu.user;
                closeUserActionsMenu();
                if (user) openEditDialog(user);
              }}
            >
              <EditIcon fontSize="small" sx={{ mr: 1.5 }} />
              {t("settings.userManagement.actions.editUser")}
            </MenuItem>
            {localPasswordManagementAvailable && userActionsMenu.user.has_local_password && (
              <MenuItem
                onClick={() => {
                  const user = userActionsMenu.user;
                  closeUserActionsMenu();
                  if (user) openResetPasswordDialog(user);
                }}
              >
                <LockResetIcon fontSize="small" sx={{ mr: 1.5 }} />
                {t("settings.userManagement.actions.resetPassword")}
              </MenuItem>
            )}
            <MenuItem
              disabled={Boolean(currentUserId && userActionsMenu.user.id === currentUserId)}
              onClick={() => {
                const user = userActionsMenu.user;
                closeUserActionsMenu();
                if (user) {
                  setSelectedUser(user);
                  setDeleteDialogOpen(true);
                }
              }}
              sx={{ color: "error.main" }}
            >
              <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} />
              {t("settings.userManagement.actions.deleteUser")}
            </MenuItem>
          </>
        )}
      </Menu>

      <ResponsiveFormDialog
        open={mappingEditor.open}
        onClose={closeMappingEditor}
        disableClose={mappingSubmitting}
        title={
          mappingEditor.mode === "move"
            ? "Move OIDC identity"
            : mappingEditor.mode === "change"
              ? "Change OIDC account"
              : "Map OIDC account"
        }
        description="Mapping does not override provider admission or role policy."
        actions={mappingEditorActions}
        onKeyDown={dialogEnterKeyHandler(() => {
          void handleMappingSubmit();
        })}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mappingError && <SettingsInlineAlert sx={{ mb: 0 }}>{mappingError}</SettingsInlineAlert>}
          <SettingsFormSurface testId="oidc-mapping-editor-form-surface">
            <SettingsFormGroup>
              <SettingsFormRow sx={{ gridTemplateColumns: { md: "minmax(0, 1fr)" } }}>
                {mappingEditor.mode === "move" ? (
                  <FormControl fullWidth variant="outlined" sx={settingsFormOutlinedControlSx}>
                    <InputLabel id="oidc-move-target-label">Target local account</InputLabel>
                    <Select
                      autoFocus
                      labelId="oidc-move-target-label"
                      label="Target local account"
                      value={mappingEditor.targetUserId}
                      onChange={(event) => setMappingEditor((current) => ({ ...current, targetUserId: event.target.value }))}
                      sx={settingsSelectSx}
                      MenuProps={settingsSelectMenuProps}
                    >
                      {users
                        .filter((user) => user.is_active && !user.oidc && !user.pending_oidc && user.id !== mappingEditor.user?.id)
                        .map((user) => (
                          <MenuItem key={user.id} value={user.id}>
                            {user.username}
                          </MenuItem>
                        ))}
                    </Select>
                    <FormHelperText>Select the local account that will receive this identity.</FormHelperText>
                  </FormControl>
                ) : (
                  <TextField
                    autoFocus
                    fullWidth
                    label="Expected provider username"
                    value={mappingEditor.expectedUsername}
                    onChange={(event) => setMappingEditor((current) => ({ ...current, expectedUsername: event.target.value }))}
                    helperText="The first admitted, unmapped OIDC identity with this exact username will claim the account."
                    sx={settingsFormOutlinedControlSx}
                  />
                )}
              </SettingsFormRow>
            </SettingsFormGroup>
          </SettingsFormSurface>
        </Box>
      </ResponsiveFormDialog>

      <ResponsiveFormDialog
        open={editorOpen}
        onClose={handleEditorClose}
        disableClose={submitting}
        title={isEditing ? t("settings.userManagement.editor.titleEdit") : t("settings.userManagement.editor.titleCreate")}
        actions={editorActions}
        onKeyDown={handleEditorKeyDown}
      >
        {editorContent}
      </ResponsiveFormDialog>

      <ResponsiveFormDialog
        open={resetPasswordEditorOpen}
        onClose={handleResetPasswordEditorClose}
        disableClose={resetPasswordSubmitting}
        title={t("settings.userManagement.resetPasswordEditor.title")}
        description={
          selectedUser
            ? t("settings.userManagement.resetPasswordEditor.descriptionWithName", { username: selectedUser.username })
            : t("settings.userManagement.resetPasswordEditor.descriptionFallback")
        }
        actions={resetPasswordEditorActions}
        onKeyDown={dialogEnterKeyHandler(() => {
          void handleResetPassword();
        })}
        onTransitionEntered={() => resetPasswordInputRef.current?.focus()}
      >
        {resetPasswordEditorContent}
      </ResponsiveFormDialog>

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setSelectedUser(null);
        }}
        onConfirm={handleDeleteUser}
        submitting={deleteSubmitting}
        title={t("settings.userManagement.deleteDialog.title")}
        description={t("settings.userManagement.deleteDialog.descriptionFallback")}
        descriptionItemName={selectedUser?.username ?? null}
      />

      <ResponsiveFormDialog
        open={credentialsDialog.open}
        onClose={() => setCredentialsDialog((current) => ({ ...current, open: false }))}
        title={credentialsDialog.title}
        description={credentialsDialog.description}
        actions={credentialsDialogActions}
        maxWidth="xs"
      >
        {credentialsDialogContent}
      </ResponsiveFormDialog>

      <SettingsNotificationSnackbar
        notification={notification}
        onClose={() => setNotification((current) => ({ ...current, open: false }))}
      />
    </SettingsPage>
  );
}
