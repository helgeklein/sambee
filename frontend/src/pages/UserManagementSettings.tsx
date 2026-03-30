import {
  Add as AddIcon,
  AdminPanelSettings as AdminIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  LockReset as LockResetIcon,
  Person as PersonIcon,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Fab,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
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
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DeleteDialog from "../components/Admin/DeleteDialog";
import { adminDialogActionButtonSx, adminDialogEndActionRowSx } from "../components/Admin/dialogActionStyles";
import { ResponsiveFormDialog } from "../components/Admin/ResponsiveFormDialog";
import { SettingsInlineAlert, SettingsNotificationSnackbar, type SettingsNotificationState } from "../components/Settings/SettingsFeedback";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { SettingsEmptyState, SettingsLoadingState } from "../components/Settings/SettingsState";
import {
  settingsDestructiveIconButtonSx,
  settingsMetadataChipSx,
  settingsPrimaryButtonSx,
  settingsPrimaryFabSx,
  settingsUtilityButtonSx,
  settingsUtilityIconButtonSx,
} from "../components/Settings/settingsButtonStyles";
import { loadUserManagementSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import api from "../services/api";
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

const DEFAULT_USER_FORM: UserFormState = {
  username: "",
  name: "",
  email: "",
  role: "editor",
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

export function UserManagementSettings({ dialogSafeHeader = false }: UserManagementSettingsProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("sm"));
  const { t } = useTranslation();
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordEditorOpen, setResetPasswordEditorOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [formState, setFormState] = useState<UserFormState>(DEFAULT_USER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetPasswordForm, setResetPasswordForm] = useState<ResetPasswordFormState>(DEFAULT_RESET_PASSWORD_FORM);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
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
  const activeAdminCount = useMemo(() => users.filter((user) => user.role === "admin" && user.is_active !== false).length, [users]);

  const openCreateDialog = () => {
    setSelectedUser(null);
    setFormState(DEFAULT_USER_FORM);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setFormState({
      username: user.username,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role,
      isActive: user.is_active,
      password: "",
      mustChangePassword: user.must_change_password,
      expiresAt: toDateTimeLocalValue(user.expires_at),
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setSelectedUser(null);
    setFormState(DEFAULT_USER_FORM);
    setFormError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const username = formState.username.trim();
    const name = formState.name.trim();
    const email = formState.email.trim().toLowerCase();
    if (!username) {
      setFormError(t("settings.userManagement.notifications.usernameRequired"));
      return;
    }

    const expiresAt = toIsoDateTimeValue(formState.expiresAt);

    try {
      setSubmitting(true);
      setFormError(null);

      if (selectedUser) {
        const updatePayload: AdminUserUpdateInput = {
          username,
          name: name || undefined,
          email: email || undefined,
          role: formState.role,
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
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }, [closeEditor, formState, isEditing, refresh, selectedUser, showNotification, t]);

  const handleEditorKeyDown = useMemo(
    () =>
      dialogEnterKeyHandler(() => {
        void handleSave();
      }),
    [handleSave]
  );

  const handleEditorClose = useCallback(() => {
    if (submitting) {
      return;
    }

    closeEditor();
  }, [closeEditor, submitting]);

  const openResetPasswordDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setResetPasswordForm(DEFAULT_RESET_PASSWORD_FORM);
    setResetPasswordError(null);
    setResetPasswordEditorOpen(true);
  };

  const closeResetPasswordEditor = useCallback(() => {
    setResetPasswordEditorOpen(false);
    setResetPasswordForm(DEFAULT_RESET_PASSWORD_FORM);
    setResetPasswordError(null);
    setSelectedUser(null);
  }, []);

  const handleResetPasswordEditorClose = useCallback(() => {
    if (resetPasswordSubmitting) {
      return;
    }

    closeResetPasswordEditor();
  }, [closeResetPasswordEditor, resetPasswordSubmitting]);

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

  const editorContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {formError && <SettingsInlineAlert sx={{ mb: 0 }}>{formError}</SettingsInlineAlert>}
      <TextField
        label={t("settings.userManagement.editor.usernameLabel")}
        value={formState.username}
        onChange={(event) => setFormState((current) => ({ ...current, username: event.target.value }))}
        autoFocus
        fullWidth
        variant="outlined"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />
      <TextField
        label={t("settings.userManagement.editor.nameLabel")}
        value={formState.name}
        onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
        fullWidth
        variant="outlined"
      />
      <TextField
        label={t("settings.userManagement.editor.emailLabel")}
        type="email"
        value={formState.email}
        onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
        fullWidth
        variant="outlined"
      />
      <FormControl fullWidth variant="outlined">
        <InputLabel id="user-role-label">{t("settings.userManagement.editor.roleLabel")}</InputLabel>
        <Select
          labelId="user-role-label"
          label={t("settings.userManagement.editor.roleLabel")}
          value={formState.role}
          disabled={isEditingSelf}
          onChange={(event) => setFormState((current) => ({ ...current, role: event.target.value as UserRole }))}
        >
          <MenuItem value="editor">{t("settings.userManagement.editorRole")}</MenuItem>
          <MenuItem value="viewer">{t("settings.userManagement.viewerRole")}</MenuItem>
          <MenuItem value="admin">{t("settings.userManagement.adminRole")}</MenuItem>
        </Select>
      </FormControl>
      <TextField
        label={t("settings.userManagement.editor.expiresAtLabel")}
        type="datetime-local"
        value={formState.expiresAt}
        onChange={(event) => setFormState((current) => ({ ...current, expiresAt: event.target.value }))}
        fullWidth
        variant="outlined"
        helperText={t("settings.userManagement.editor.expiresAtHelp")}
        InputLabelProps={{ shrink: true }}
      />
      {isEditing ? (
        <FormControlLabel
          control={
            <Switch
              checked={formState.isActive}
              disabled={isEditingSelf}
              onChange={(event) => setFormState((current) => ({ ...current, isActive: event.target.checked }))}
            />
          }
          label={t("settings.userManagement.editor.accountActiveLabel")}
        />
      ) : (
        <>
          <TextField
            label={t("settings.userManagement.editor.initialPasswordLabel")}
            type="password"
            value={formState.password}
            onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
            helperText={t("settings.userManagement.editor.initialPasswordHelp")}
            fullWidth
            variant="outlined"
            FormHelperTextProps={{
              sx: { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={formState.mustChangePassword}
                onChange={(event) => setFormState((current) => ({ ...current, mustChangePassword: event.target.checked }))}
              />
            }
            label={t("settings.userManagement.editor.requirePasswordChangeLabel")}
          />
        </>
      )}
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
        InputProps={{ readOnly: true }}
        fullWidth
        variant="outlined"
      />
      <TextField
        label={t("settings.userManagement.credentialsDialog.temporaryPasswordLabel")}
        value={credentialsDialog.temporaryPassword}
        InputProps={{ readOnly: true }}
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {resetPasswordError && <SettingsInlineAlert sx={{ mb: 0 }}>{resetPasswordError}</SettingsInlineAlert>}
      <TextField
        label={t("settings.userManagement.resetPasswordEditor.passwordLabel")}
        type="password"
        value={resetPasswordForm.password}
        onChange={(event) => setResetPasswordForm((current) => ({ ...current, password: event.target.value }))}
        helperText={t("settings.userManagement.resetPasswordEditor.passwordHelp")}
        autoFocus
        fullWidth
        variant="outlined"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={resetPasswordForm.mustChangePassword}
            onChange={(event) => setResetPasswordForm((current) => ({ ...current, mustChangePassword: event.target.checked }))}
          />
        }
        label={t("settings.userManagement.resetPasswordEditor.requirePasswordChangeLabel")}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("admin-users")}
        description={getSettingsCategoryDescription("admin-users")}
        dialogSafe={dialogSafeHeader}
        showTitle={isDesktop}
        actions={
          isDesktop ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog} sx={settingsPrimaryButtonSx}>
              {t("settings.userManagement.addUserButton")}
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, pb: 2 }}>
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
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 4 }}>
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
                    display: "flex",
                    alignItems: { xs: "flex-start", sm: "center" },
                    justifyContent: "space-between",
                    gap: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="h6" fontWeight="medium">
                      {user.name?.trim() ? user.name : user.username}
                    </Typography>
                    {(user.name || user.email) && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {[user.username, user.email].filter(Boolean).join(" • ")}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", mt: 0.75, mb: 1 }}>
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
                      {user.must_change_password && (
                        <Chip
                          size="small"
                          label={t("settings.userManagement.passwordResetPending")}
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

                  <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "stretch", sm: "center" } }}>
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
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>

      {!isDesktop && (
        <Fab
          color="primary"
          aria-label={t("settings.userManagement.addUserFabAriaLabel")}
          onClick={openCreateDialog}
          sx={settingsPrimaryFabSx}
        >
          <AddIcon />
        </Fab>
      )}

      <ResponsiveFormDialog
        open={editorOpen}
        onClose={handleEditorClose}
        disableClose={submitting}
        title={isEditing ? t("settings.userManagement.editor.titleEdit") : t("settings.userManagement.editor.titleCreate")}
        description={
          isEditing ? t("settings.userManagement.editor.descriptionEdit") : t("settings.userManagement.editor.descriptionCreate")
        }
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
        description={
          selectedUser
            ? t("settings.userManagement.deleteDialog.descriptionWithName", { username: selectedUser.username })
            : t("settings.userManagement.deleteDialog.descriptionFallback")
        }
        itemName={selectedUser?.username ?? null}
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
    </Box>
  );
}
