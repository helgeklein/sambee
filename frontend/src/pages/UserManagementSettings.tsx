import {
  Add as AddIcon,
  AdminPanelSettings as AdminIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  LockReset as LockResetIcon,
  Person as PersonIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  DialogContentText,
  Fab,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Select,
  Snackbar,
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
import { ResponsiveFormDialog } from "../components/Admin/ResponsiveFormDialog";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import {
  settingsDestructiveIconButtonSx,
  settingsMetadataChipSx,
  settingsPrimaryButtonSx,
  settingsPrimaryFabSx,
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
import { formatLocalizedDateTime } from "../utils/localeFormatting";

interface UserFormState {
  username: string;
  role: UserRole;
  isActive: boolean;
  password: string;
  mustChangePassword: boolean;
}

interface UserManagementSettingsProps {
  dialogSafeHeader?: boolean;
}

const DEFAULT_USER_FORM: UserFormState = {
  username: "",
  role: "regular",
  isActive: true,
  password: "",
  mustChangePassword: true,
};

export function UserManagementSettings({ dialogSafeHeader = false }: UserManagementSettingsProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("sm"));
  const { t } = useTranslation();
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info";
  }>({
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
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [formState, setFormState] = useState<UserFormState>(DEFAULT_USER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
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
      role: user.role,
      isActive: user.is_active,
      password: "",
      mustChangePassword: user.must_change_password,
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
    if (!username) {
      setFormError(t("settings.userManagement.notifications.usernameRequired"));
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      if (selectedUser) {
        const updatePayload: AdminUserUpdateInput = {
          username,
          role: formState.role,
          is_active: formState.isActive,
        };
        await api.updateUser(selectedUser.id, updatePayload);
        showNotification(t("settings.userManagement.notifications.userUpdated"), "success");
      } else {
        const createPayload: AdminUserCreateInput = {
          username,
          role: formState.role,
          must_change_password: formState.mustChangePassword,
          password: formState.password.trim() ? formState.password : undefined,
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

  const handleResetPassword = async (user: AdminUser) => {
    try {
      const result: AdminUserPasswordResetResult = await api.resetUserPassword(user.id);
      setCredentialsDialog({
        open: true,
        title: t("settings.userManagement.credentialsDialog.resetTitle"),
        username: user.username,
        temporaryPassword: result.temporary_password,
        description: t("settings.userManagement.credentialsDialog.resetDescription"),
      });
      showNotification(result.message, "success");
      await refresh();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.userManagement.notifications.resetFailed"));
      showNotification(message, "error");
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) {
      return;
    }

    try {
      await api.deleteUser(selectedUser.id);
      showNotification(t("settings.userManagement.notifications.userDeleted"), "success");
      setDeleteDialogOpen(false);
      setSelectedUser(null);
      await refresh();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.userManagement.notifications.deleteFailed"));
      showNotification(message, "error");
    }
  };

  const editorActions = (
    <>
      <Box sx={{ flex: 1 }} />
      <Button
        onClick={closeEditor}
        disabled={submitting}
        sx={{
          textTransform: "none",
          color: "text.secondary",
          "&:hover": {
            bgcolor: "action.selected",
          },
        }}
      >
        {t("common.actions.cancel")}
      </Button>
      <Button onClick={handleSave} variant="contained" disabled={submitting} sx={{ textTransform: "none" }}>
        {submitting ? (
          <CircularProgress size={20} />
        ) : isEditing ? (
          t("settings.userManagement.actions.saveChanges")
        ) : (
          t("settings.userManagement.actions.createUser")
        )}
      </Button>
    </>
  );

  const editorContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: isDesktop ? 1 : 0 }}>
      <DialogContentText>
        {isEditing ? t("settings.userManagement.editor.descriptionEdit") : t("settings.userManagement.editor.descriptionCreate")}
      </DialogContentText>
      {formError && <Alert severity="error">{formError}</Alert>}
      <TextField
        label={t("settings.userManagement.editor.usernameLabel")}
        value={formState.username}
        onChange={(event) => setFormState((current) => ({ ...current, username: event.target.value }))}
        autoFocus
        fullWidth
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />
      <FormControl fullWidth variant="filled">
        <InputLabel id="user-role-label">{t("settings.userManagement.editor.roleLabel")}</InputLabel>
        <Select
          labelId="user-role-label"
          label={t("settings.userManagement.editor.roleLabel")}
          value={formState.role}
          disabled={isEditingSelf}
          onChange={(event) => setFormState((current) => ({ ...current, role: event.target.value as UserRole }))}
        >
          <MenuItem value="regular">{t("settings.userManagement.regularRole")}</MenuItem>
          <MenuItem value="admin">{t("settings.userManagement.adminRole")}</MenuItem>
        </Select>
      </FormControl>
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
            variant="filled"
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
    <>
      <Box sx={{ flex: 1 }} />
      <Button
        onClick={() => setCredentialsDialog((current) => ({ ...current, open: false }))}
        variant="contained"
        sx={{ textTransform: "none" }}
      >
        {t("settings.userManagement.actions.close")}
      </Button>
    </>
  );

  const credentialsDialogContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: isDesktop ? 1 : 0 }}>
      <DialogContentText>{credentialsDialog.description}</DialogContentText>
      <TextField
        label={t("settings.userManagement.credentialsDialog.usernameLabel")}
        value={credentialsDialog.username}
        InputProps={{ readOnly: true }}
        fullWidth
        variant="filled"
      />
      <TextField
        label={t("settings.userManagement.credentialsDialog.temporaryPasswordLabel")}
        value={credentialsDialog.temporaryPassword}
        InputProps={{ readOnly: true }}
        fullWidth
        variant="filled"
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
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : users.length === 0 ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="h6" color="text.secondary">
              {t("settings.userManagement.emptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("settings.userManagement.emptyDescription")}
            </Typography>
          </Box>
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
                      {user.username}
                    </Typography>
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
                        label={user.role === "admin" ? t("settings.userManagement.adminRole") : t("settings.userManagement.regularRole")}
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
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {t("settings.userManagement.createdAt", {
                        timestamp: formatLocalizedDateTime(user.created_at, {
                          year: "numeric",
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        }),
                      })}
                    </Typography>
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
                          onClick={() => handleResetPassword(user)}
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
        title={isEditing ? t("settings.userManagement.editor.titleEdit") : t("settings.userManagement.editor.titleCreate")}
        actions={editorActions}
        onKeyDown={handleEditorKeyDown}
      >
        {editorContent}
      </ResponsiveFormDialog>

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteUser}
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
        actions={credentialsDialogActions}
        maxWidth="xs"
      >
        {credentialsDialogContent}
      </ResponsiveFormDialog>

      <Snackbar
        open={notification.open}
        autoHideDuration={4000}
        onClose={() => setNotification((current) => ({ ...current, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={notification.severity} onClose={() => setNotification((current) => ({ ...current, open: false }))}>
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
