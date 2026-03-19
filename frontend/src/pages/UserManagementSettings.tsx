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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info";
  }>({
    open: false,
    message: "",
    severity: "success",
  });

  const isEditing = Boolean(selectedUser);
  const isEditingSelf = Boolean(selectedUser && currentUserId && selectedUser.id === currentUserId);

  const showNotification = useCallback((message: string, severity: "success" | "error" | "info") => {
    setNotification({ open: true, message, severity });
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const [userList, currentUser] = await Promise.all([api.getUsers(), api.getCurrentUser()]);
      setUsers(userList);
      setCurrentUserId(currentUser.id ?? null);
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to load users");
      showNotification(message, "error");
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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
      setFormError("Username is required");
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
        showNotification("User updated successfully", "success");
      } else {
        const createPayload: AdminUserCreateInput = {
          username,
          role: formState.role,
          must_change_password: formState.mustChangePassword,
          password: formState.password.trim() ? formState.password : undefined,
        };
        const result: AdminUserCreateResult = await api.createUser(createPayload);
        showNotification("User created successfully", "success");
        if (result.temporary_password) {
          setCredentialsDialog({
            open: true,
            title: "Temporary Password Created",
            username: result.username,
            temporaryPassword: result.temporary_password,
            description: "Share this temporary password securely. The user will be required to change it after signing in.",
          });
        }
      }

      closeEditor();
      await loadUsers();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, isEditing ? "Failed to update user" : "Failed to create user");
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }, [closeEditor, formState, isEditing, loadUsers, selectedUser, showNotification]);

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
        title: "Temporary Password Reset",
        username: user.username,
        temporaryPassword: result.temporary_password,
        description: "The existing password was replaced and all current sessions were invalidated.",
      });
      showNotification(result.message, "success");
      await loadUsers();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to reset password");
      showNotification(message, "error");
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) {
      return;
    }

    try {
      await api.deleteUser(selectedUser.id);
      showNotification("User deleted successfully", "success");
      setDeleteDialogOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to delete user");
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
        Cancel
      </Button>
      <Button onClick={handleSave} variant="contained" disabled={submitting} sx={{ textTransform: "none" }}>
        {submitting ? <CircularProgress size={20} /> : isEditing ? "Save Changes" : "Create User"}
      </Button>
    </>
  );

  const editorContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: isDesktop ? 1 : 0 }}>
      <DialogContentText>
        {isEditing
          ? "Update account details and access level. Password resets are handled separately."
          : "Create a new account. Leave the password blank to generate a temporary password automatically."}
      </DialogContentText>
      {formError && <Alert severity="error">{formError}</Alert>}
      <TextField
        label="Username"
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
        <InputLabel id="user-role-label">Role</InputLabel>
        <Select
          labelId="user-role-label"
          label="Role"
          value={formState.role}
          disabled={isEditingSelf}
          onChange={(event) => setFormState((current) => ({ ...current, role: event.target.value as UserRole }))}
        >
          <MenuItem value="regular">Regular</MenuItem>
          <MenuItem value="admin">Admin</MenuItem>
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
          label="Account is active"
        />
      ) : (
        <>
          <TextField
            label="Initial Password"
            type="password"
            value={formState.password}
            onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
            helperText="Optional. If left blank, the server will generate a secure temporary password."
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
            label="Require password change after next sign-in"
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
        Close
      </Button>
    </>
  );

  const credentialsDialogContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: isDesktop ? 1 : 0 }}>
      <DialogContentText>{credentialsDialog.description}</DialogContentText>
      <TextField label="Username" value={credentialsDialog.username} InputProps={{ readOnly: true }} fullWidth variant="filled" />
      <TextField
        label="Temporary Password"
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
              Add User
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, pb: 2 }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Chip label={`${users.length} total users`} size="small" variant="outlined" sx={settingsMetadataChipSx} />
          <Chip label={`${activeAdminCount} active admins`} size="small" variant="outlined" sx={settingsMetadataChipSx} />
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
              No users found
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Create the first user account to start delegating access.
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
                      {isSelf && <Chip size="small" label="You" variant="outlined" sx={settingsMetadataChipSx} />}
                      <Chip
                        size="small"
                        icon={user.role === "admin" ? <AdminIcon /> : <PersonIcon />}
                        label={user.role === "admin" ? "Admin" : "Regular"}
                        variant="outlined"
                        sx={settingsMetadataChipSx}
                      />
                      <Chip size="small" label={user.is_active ? "Active" : "Disabled"} variant="outlined" sx={settingsMetadataChipSx} />
                      {user.must_change_password && (
                        <Chip size="small" label="Password reset pending" variant="outlined" sx={settingsMetadataChipSx} />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Created {new Date(user.created_at).toLocaleString()}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "stretch", sm: "center" } }}>
                    <Tooltip title="Edit user">
                      <span>
                        <IconButton
                          aria-label={`Edit ${user.username}`}
                          onClick={() => openEditDialog(user)}
                          sx={settingsUtilityIconButtonSx}
                        >
                          <EditIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Reset password">
                      <span>
                        <IconButton
                          aria-label={`Reset password for ${user.username}`}
                          onClick={() => handleResetPassword(user)}
                          sx={settingsUtilityIconButtonSx}
                        >
                          <LockResetIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={isSelf ? "You cannot delete your own account here" : "Delete user"}>
                      <span>
                        <IconButton
                          aria-label={`Delete ${user.username}`}
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
        <Fab color="primary" aria-label="Add user" onClick={openCreateDialog} sx={settingsPrimaryFabSx}>
          <AddIcon />
        </Fab>
      )}

      <ResponsiveFormDialog
        open={editorOpen}
        onClose={handleEditorClose}
        title={isEditing ? "Edit User" : "Create User"}
        actions={editorActions}
        onKeyDown={handleEditorKeyDown}
      >
        {editorContent}
      </ResponsiveFormDialog>

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        description={selectedUser ? `Delete ${selectedUser.username}? This immediately removes their access.` : "Delete this user?"}
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
