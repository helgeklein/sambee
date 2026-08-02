import { Visibility, VisibilityOff } from "@mui/icons-material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  type SxProps,
  TextField,
  type Theme,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { TFunction } from "i18next";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import type { Connection, ConnectionAccessMode, ConnectionCreate, ConnectionScope, ConnectionVisibilityOption } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import {
  SettingsFormFieldLabel,
  SettingsFormGroup,
  SettingsFormRow,
  SettingsFormSection,
  SettingsFormSurface,
  settingsFormFieldControlSx,
  settingsFormOutlinedControlSx,
  settingsFormSelectControlSx,
} from "../Settings/SettingsFormLayout";
import { settingsPrimaryButtonSx, settingsUtilityButtonSx } from "../Settings/settingsButtonStyles";
import { CONNECTION_DIALOG_STRINGS } from "./connectionDialogConstants";
import {
  adminDialogActionButtonSx,
  adminDialogActionGroupSx,
  adminDialogSplitActionRowSx,
  adminDialogStandaloneSecondaryActionSx,
} from "./dialogActionStyles";
import { ResponsiveFormDialog } from "./ResponsiveFormDialog";

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (savedConnection: Connection, requestedScope: ConnectionScope) => void;
  connection?: Connection | null;
}

const REQUIRED_CONNECTION_FIELDS = [
  { name: "name", inputId: "connection-name" },
  { name: "host", inputId: "connection-host" },
  { name: "share_name", inputId: "connection-share-name" },
  { name: "username", inputId: "connection-username" },
  { name: "password", inputId: "connection-password" },
] as const;

type TestResult = {
  status: "success" | "error";
  message: string;
};

type ResultDialog = {
  title: string;
  message: string;
};

type SingleSxProp = Exclude<SxProps<Theme>, ReadonlyArray<unknown>>;

function combineSx(...styles: SxProps<Theme>[]): SingleSxProp[] {
  return styles.flatMap((style) => (Array.isArray(style) ? style : [style])) as SingleSxProp[];
}

function getFallbackVisibilityOptions(t: TFunction): ConnectionVisibilityOption[] {
  return [
    {
      value: "private",
      label: t("settings.connectionDialog.visibility.privateLabel"),
      description: t("settings.connectionDialog.visibility.privateDescription"),
      available: true,
      unavailable_reason: null,
    },
    {
      value: "shared",
      label: t("settings.connectionDialog.visibility.sharedLabel"),
      description: t("settings.connectionDialog.visibility.sharedDescription"),
      available: true,
      unavailable_reason: null,
    },
  ];
}

const ConnectionDialog: React.FC<ConnectionDialogProps> = ({ open, onClose, onSave, connection }) => {
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);
  const theme = useTheme();
  const usesDesktopFormLayout = useMediaQuery(theme.breakpoints.up("md"));
  const { t } = useTranslation();
  const [formData, setFormData] = useState<ConnectionCreate>({
    name: "",
    type: "smb",
    host: "",
    port: 445,
    share_name: "",
    username: "",
    password: "",
    path_prefix: "/",
    scope: "private",
    access_mode: "read_write",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [resultDialog, setResultDialog] = useState<ResultDialog | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [visibilityOptions, setVisibilityOptions] = useState<ConnectionVisibilityOption[]>(() => getFallbackVisibilityOptions(t));
  const closeDisabled = saving || testing;

  const handleDialogClose = () => {
    if (closeDisabled) {
      return;
    }

    onClose();
  };

  const dismissResultDialog = () => {
    setResultDialog(null);
  };

  useEffect(() => {
    let isCancelled = false;

    if (!open) {
      return () => {
        isCancelled = true;
      };
    }

    void api
      .getConnectionVisibilityOptions()
      .then((options) => {
        if (isCancelled) {
          return;
        }

        setVisibilityOptions(options);
        if (connection) {
          return;
        }

        const requestedOption = options.find((option) => option.value === formData.scope && option.available);
        if (requestedOption) {
          return;
        }

        const firstAvailableOption = options.find((option) => option.available);
        if (firstAvailableOption) {
          setFormData((current) => ({ ...current, scope: firstAvailableOption.value }));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setVisibilityOptions(getFallbackVisibilityOptions(t));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [connection, formData.scope, open, t]);

  useEffect(() => {
    if (connection) {
      // Edit mode - populate form
      setFormData({
        name: connection.name,
        type: connection.type,
        host: connection.host,
        port: connection.port,
        share_name: connection.share_name || "",
        username: connection.username,
        password: "", // Don't populate password for security
        path_prefix: connection.path_prefix || "/",
        scope: connection.scope,
        access_mode: connection.access_mode,
      });
    } else {
      // Add mode - reset form
      setFormData({
        name: "",
        type: "smb",
        host: "",
        port: 445,
        share_name: "",
        username: "",
        password: "",
        path_prefix: "/",
        scope: "private",
        access_mode: "read_write",
      });
    }
    setErrors({});
    setTestResult(null);
    setResultDialog(null);
    setShowPassword(false); // Reset password visibility
  }, [connection]);

  const handleChange = (field: keyof ConnectionCreate, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors["name"] = CONNECTION_DIALOG_STRINGS.ERROR_NAME_REQUIRED;
    }
    if (!formData.host.trim()) {
      newErrors["host"] = CONNECTION_DIALOG_STRINGS.ERROR_HOST_REQUIRED;
    }
    if (!formData.share_name.trim()) {
      newErrors["share_name"] = CONNECTION_DIALOG_STRINGS.ERROR_SHARE_NAME_REQUIRED;
    }
    if (!formData.username.trim()) {
      newErrors["username"] = CONNECTION_DIALOG_STRINGS.ERROR_USERNAME_REQUIRED;
    }
    if (!connection && !formData.password.trim()) {
      // Password required for new connections
      newErrors["password"] = CONNECTION_DIALOG_STRINGS.ERROR_PASSWORD_REQUIRED;
    }

    setErrors(newErrors);
    const firstInvalidField = REQUIRED_CONNECTION_FIELDS.find(({ name }) => newErrors[name]);
    if (firstInvalidField) {
      requestAnimationFrame(() => document.getElementById(firstInvalidField.inputId)?.focus());
    }
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validate()) {
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      let result: TestResult;
      if (connection) {
        // Test the current draft, using the stored password when it remains blank.
        result = (await api.testConnection(connection.id, {
          host: formData.host,
          port: formData.port,
          share_name: formData.share_name,
          username: formData.username,
          ...(formData.password ? { password: formData.password } : {}),
          path_prefix: formData.path_prefix,
        })) as TestResult;
      } else {
        result = (await api.testConnectionConfig(formData)) as TestResult;
      }

      setTestResult(result);
      if (result.status === "error") {
        setResultDialog({
          title: t("settings.connectionDialog.results.errorDialogTitle"),
          message: result.message,
        });
      }
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.connectionManagement.notifications.testFailed"));
      setTestResult({
        status: "error",
        message,
      });
      setResultDialog({
        title: t("settings.connectionDialog.results.errorDialogTitle"),
        message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) {
      return;
    }

    setSaving(true);
    try {
      let savedConnection: Connection;

      if (connection) {
        // Edit mode - only send changed fields
        const updateData: Partial<ConnectionCreate> = {};
        if (formData.name !== connection.name) updateData.name = formData.name;
        if (formData.host !== connection.host) updateData.host = formData.host;
        if (formData.share_name !== connection.share_name) updateData.share_name = formData.share_name;
        if (formData.username !== connection.username) updateData.username = formData.username;
        if (formData.password.trim()) updateData.password = formData.password;
        if (formData.path_prefix !== connection.path_prefix) updateData.path_prefix = formData.path_prefix;
        if (formData.scope !== connection.scope) updateData.scope = formData.scope;
        if (formData.access_mode !== connection.access_mode) updateData.access_mode = formData.access_mode;

        savedConnection = await api.updateConnection(connection.id, updateData);
      } else {
        // Add mode - port will use default 445
        savedConnection = await api.createConnection(formData);
      }
      onSave(savedConnection, formData.scope);
      onClose();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.connectionManagement.notifications.saveFailed"));
      setResultDialog({
        title: t("settings.connectionManagement.notifications.saveFailed"),
        message,
      });
    } finally {
      setSaving(false);
    }
  };

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

  // Form content (shared between Dialog and Drawer)
  const formContent = (
    <SettingsFormSurface testId="connection-dialog-form-surface">
      <SettingsFormGroup testId="connection-dialog-fields">
        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_NAME,
            errors["name"] || CONNECTION_DIALOG_STRINGS.HELPER_NAME,
            "connection-name-description",
            "connection-name",
            true,
            undefined,
            !!errors["name"]
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-name"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_NAME}
              hiddenLabel={usesDesktopFormLayout}
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              error={!!errors["name"]}
              helperText={usesDesktopFormLayout ? undefined : errors["name"] || CONNECTION_DIALOG_STRINGS.HELPER_NAME}
              fullWidth
              required
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-name-description" : undefined,
                },
              }}
            />
          </Box>
        </SettingsFormRow>
        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_HOST,
            errors["host"] || CONNECTION_DIALOG_STRINGS.HELPER_HOST,
            "connection-host-description",
            "connection-host",
            true,
            undefined,
            !!errors["host"]
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-host"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_HOST}
              hiddenLabel={usesDesktopFormLayout}
              value={formData.host}
              onChange={(e) => handleChange("host", e.target.value)}
              error={!!errors["host"]}
              helperText={usesDesktopFormLayout ? undefined : errors["host"] || CONNECTION_DIALOG_STRINGS.HELPER_HOST}
              fullWidth
              required
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-host-description" : undefined,
                },
              }}
            />
          </Box>
        </SettingsFormRow>
        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_SHARE_NAME,
            errors["share_name"] || CONNECTION_DIALOG_STRINGS.HELPER_SHARE_NAME,
            "connection-share-name-description",
            "connection-share-name",
            true,
            undefined,
            !!errors["share_name"]
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-share-name"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_SHARE_NAME}
              hiddenLabel={usesDesktopFormLayout}
              value={formData.share_name}
              onChange={(e) => handleChange("share_name", e.target.value)}
              error={!!errors["share_name"]}
              helperText={usesDesktopFormLayout ? undefined : errors["share_name"] || CONNECTION_DIALOG_STRINGS.HELPER_SHARE_NAME}
              fullWidth
              required
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-share-name-description" : undefined,
                },
              }}
            />
          </Box>
        </SettingsFormRow>
        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_USERNAME,
            errors["username"] || CONNECTION_DIALOG_STRINGS.HELPER_USERNAME,
            "connection-username-description",
            "connection-username",
            true,
            undefined,
            !!errors["username"]
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-username"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_USERNAME}
              hiddenLabel={usesDesktopFormLayout}
              value={formData.username}
              onChange={(e) => handleChange("username", e.target.value)}
              error={!!errors["username"]}
              helperText={usesDesktopFormLayout ? undefined : errors["username"] || CONNECTION_DIALOG_STRINGS.HELPER_USERNAME}
              fullWidth
              required
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-username-description" : undefined,
                },
              }}
            />
          </Box>
        </SettingsFormRow>

        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_PASSWORD,
            errors["password"] ||
              (connection ? CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_EDIT : CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_ADD),
            "connection-password-description",
            "connection-password",
            !connection,
            undefined,
            !!errors["password"]
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-password"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_PASSWORD}
              hiddenLabel={usesDesktopFormLayout}
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => handleChange("password", e.target.value)}
              error={!!errors["password"]}
              helperText={
                usesDesktopFormLayout
                  ? undefined
                  : errors["password"] ||
                    (connection ? CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_EDIT : CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_ADD)
              }
              fullWidth
              required={!connection}
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-password-description" : undefined,
                },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={CONNECTION_DIALOG_STRINGS.ARIA_TOGGLE_PASSWORD}
                        onClick={() => setShowPassword(!showPassword)}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
        </SettingsFormRow>

        <SettingsFormRow>
          {renderDesktopLabel(
            CONNECTION_DIALOG_STRINGS.LABEL_PATH_PREFIX,
            CONNECTION_DIALOG_STRINGS.HELPER_PATH_PREFIX,
            "connection-path-prefix-description",
            "connection-path-prefix"
          )}
          <Box sx={settingsFormFieldControlSx}>
            <TextField
              id="connection-path-prefix"
              label={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.LABEL_PATH_PREFIX}
              hiddenLabel={usesDesktopFormLayout}
              value={formData.path_prefix}
              onChange={(e) => handleChange("path_prefix", e.target.value)}
              helperText={usesDesktopFormLayout ? undefined : CONNECTION_DIALOG_STRINGS.HELPER_PATH_PREFIX}
              fullWidth
              variant="outlined"
              size={usesDesktopFormLayout ? "small" : "medium"}
              sx={settingsFormOutlinedControlSx}
              slotProps={{
                htmlInput: {
                  "aria-describedby": usesDesktopFormLayout ? "connection-path-prefix-description" : undefined,
                },
              }}
            />
          </Box>
        </SettingsFormRow>
      </SettingsFormGroup>
      <SettingsFormSection title={t("settings.connectionDialog.sections.access")} />
      <SettingsFormGroup>
        <SettingsFormRow>
          {renderDesktopLabel(
            t("settings.connectionDialog.labels.visibility"),
            CONNECTION_DIALOG_STRINGS.HELPER_VISIBILITY,
            "connection-scope-description",
            undefined,
            false,
            "connection-scope-external-label"
          )}
          <FormControl
            fullWidth={!usesDesktopFormLayout}
            variant="outlined"
            size={usesDesktopFormLayout ? "small" : "medium"}
            sx={usesDesktopFormLayout ? [settingsFormOutlinedControlSx, settingsFormSelectControlSx] : settingsFormOutlinedControlSx}
          >
            {!usesDesktopFormLayout && (
              <InputLabel id="connection-scope-label">{t("settings.connectionDialog.labels.visibility")}</InputLabel>
            )}
            <Select
              id="connection-scope"
              labelId={usesDesktopFormLayout ? "connection-scope-external-label" : "connection-scope-label"}
              aria-describedby={usesDesktopFormLayout ? "connection-scope-description" : undefined}
              label={usesDesktopFormLayout ? undefined : t("settings.connectionDialog.labels.visibility")}
              value={formData.scope}
              size={usesDesktopFormLayout ? "small" : "medium"}
              onChange={(event) => handleChange("scope", event.target.value as ConnectionScope)}
              renderValue={(selected) => visibilityOptions.find((option) => option.value === selected)?.label ?? selected}
            >
              {visibilityOptions.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={!option.available}>
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", py: 0.25 }}>
                    <Typography variant="body1">{option.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.available ? option.description : option.unavailable_reason || option.description}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
            {!usesDesktopFormLayout && <FormHelperText>{CONNECTION_DIALOG_STRINGS.HELPER_VISIBILITY}</FormHelperText>}
          </FormControl>
        </SettingsFormRow>

        <SettingsFormRow>
          {renderDesktopLabel(
            t("settings.connectionDialog.labels.accessMode"),
            formData.access_mode === "read_only"
              ? t("settings.connectionDialog.helpers.accessModeReadOnly")
              : t("settings.connectionDialog.helpers.accessModeReadWrite"),
            "connection-access-mode-description",
            undefined,
            false,
            "connection-access-mode-external-label"
          )}
          <FormControl
            fullWidth={!usesDesktopFormLayout}
            variant="outlined"
            size={usesDesktopFormLayout ? "small" : "medium"}
            sx={usesDesktopFormLayout ? [settingsFormOutlinedControlSx, settingsFormSelectControlSx] : settingsFormOutlinedControlSx}
          >
            {!usesDesktopFormLayout && (
              <InputLabel id="connection-access-mode-label">{t("settings.connectionDialog.labels.accessMode")}</InputLabel>
            )}
            <Select
              id="connection-access-mode"
              labelId={usesDesktopFormLayout ? "connection-access-mode-external-label" : "connection-access-mode-label"}
              aria-describedby={usesDesktopFormLayout ? "connection-access-mode-description" : undefined}
              label={usesDesktopFormLayout ? undefined : t("settings.connectionDialog.labels.accessMode")}
              value={formData.access_mode}
              size={usesDesktopFormLayout ? "small" : "medium"}
              onChange={(event) => handleChange("access_mode", event.target.value as ConnectionAccessMode)}
            >
              <MenuItem value="read_write">{t("settings.connectionDialog.accessMode.readWriteLabel")}</MenuItem>
              <MenuItem value="read_only">{t("settings.connectionDialog.accessMode.readOnlyLabel")}</MenuItem>
            </Select>
            {!usesDesktopFormLayout && (
              <FormHelperText>
                {formData.access_mode === "read_only"
                  ? t("settings.connectionDialog.helpers.accessModeReadOnly")
                  : t("settings.connectionDialog.helpers.accessModeReadWrite")}
              </FormHelperText>
            )}
          </FormControl>
        </SettingsFormRow>
      </SettingsFormGroup>
    </SettingsFormSurface>
  );

  // Action buttons (shared between Dialog and Drawer)
  const actionButtons = (
    <Box sx={adminDialogSplitActionRowSx}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" } }}>
        <Button
          onClick={handleTestConnection}
          disabled={testing || saving}
          variant="outlined"
          startIcon={testing ? <CircularProgress size={18} color="inherit" /> : undefined}
          endIcon={
            !usesDesktopFormLayout && testResult ? (
              testResult.status === "success" ? (
                <CheckCircleOutlineIcon color="success" />
              ) : (
                <ErrorOutlineIcon color="error" />
              )
            ) : undefined
          }
          sx={combineSx(settingsUtilityButtonSx, adminDialogStandaloneSecondaryActionSx)}
        >
          {CONNECTION_DIALOG_STRINGS.BUTTON_TEST}
        </Button>
        {usesDesktopFormLayout && testResult && (
          <Box
            role={testResult.status === "error" ? "alert" : "status"}
            sx={{ display: "flex", alignItems: "center", gap: 0.5, color: `${testResult.status}.main`, whiteSpace: "nowrap" }}
          >
            {testResult.status === "success" ? <CheckCircleOutlineIcon fontSize="small" /> : <ErrorOutlineIcon fontSize="small" />}
            <Typography variant="body2">
              {testResult.status === "success"
                ? t("settings.connectionDialog.results.success")
                : t("settings.connectionDialog.results.error")}
            </Typography>
          </Box>
        )}
      </Box>
      <Box sx={adminDialogActionGroupSx}>
        <Button
          onClick={handleDialogClose}
          disabled={closeDisabled}
          variant="outlined"
          sx={combineSx(settingsUtilityButtonSx, adminDialogActionButtonSx)}
        >
          {CONNECTION_DIALOG_STRINGS.BUTTON_CANCEL}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || testing}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}
          sx={combineSx(settingsPrimaryButtonSx, adminDialogActionButtonSx)}
        >
          {CONNECTION_DIALOG_STRINGS.BUTTON_SAVE}
        </Button>
      </Box>
    </Box>
  );

  return (
    <>
      <ResponsiveFormDialog
        open={open}
        onClose={handleDialogClose}
        disableClose={closeDisabled}
        title={connection ? CONNECTION_DIALOG_STRINGS.TITLE_EDIT : CONNECTION_DIALOG_STRINGS.TITLE_ADD}
        actions={actionButtons}
        maxWidth="sm"
        contentSx={usesDesktopFormLayout ? undefined : { p: 2 }}
        onKeyDown={handleKeyDown}
      >
        {formContent}
      </ResponsiveFormDialog>
      <Dialog
        open={Boolean(resultDialog)}
        onClose={(_event, reason) => {
          if (reason === "escapeKeyDown") {
            dismissResultDialog();
          }
        }}
        aria-labelledby="connection-result-dialog-title"
        aria-describedby="connection-result-dialog-description"
        sx={{ zIndex: (currentTheme) => currentTheme.zIndex.modal + 2 }}
      >
        <DialogTitle id="connection-result-dialog-title">{resultDialog?.title}</DialogTitle>
        <DialogContent>
          <Typography id="connection-result-dialog-description">{resultDialog?.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={dismissResultDialog}>
            {t("common.actions.close")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ConnectionDialog;
