import { Visibility, VisibilityOff } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import type { Connection, ConnectionCreate, ConnectionScope, ConnectionVisibilityOption } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { CONNECTION_DIALOG_STRINGS } from "./connectionDialogConstants";
import { ResponsiveFormDialog } from "./ResponsiveFormDialog";

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (savedConnection: Connection, requestedScope: ConnectionScope) => void;
  connection?: Connection | null;
}

function getFallbackVisibilityOptions(t: (key: string) => string): ConnectionVisibilityOption[] {
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
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
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
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [visibilityOptions, setVisibilityOptions] = useState<ConnectionVisibilityOption[]>(() => getFallbackVisibilityOptions(t));

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
      });
    }
    setErrors({});
    setTestResult(null);
    setShowPassword(false); // Reset password visibility
  }, [connection]);

  const handleChange = (field: keyof ConnectionCreate, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validate()) {
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      if (connection) {
        // For existing connections, use the test endpoint
        const result = await api.testConnection(connection.id);
        setTestResult(result as { status: "success" | "error"; message: string });
      } else {
        const result = await api.testConnectionConfig(formData);
        setTestResult(result as { status: "success" | "error"; message: string });
      }
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.connectionManagement.notifications.testFailed"));
      setTestResult({
        status: "error",
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

        savedConnection = await api.updateConnection(connection.id, updateData);
      } else {
        // Add mode - port will use default 445
        savedConnection = await api.createConnection(formData);
      }
      onSave(savedConnection, formData.scope);
      onClose();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.connectionManagement.notifications.saveFailed"));
      setTestResult({
        status: "error",
        message,
      });
    } finally {
      setSaving(false);
    }
  };

  // Form content (shared between Dialog and Drawer)
  const formContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: isMobile ? 0 : 1 }}>
      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_NAME}
        value={formData.name}
        onChange={(e) => handleChange("name", e.target.value)}
        error={!!errors["name"]}
        helperText={errors["name"]}
        fullWidth
        required
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_HOST}
        value={formData.host}
        onChange={(e) => handleChange("host", e.target.value)}
        error={!!errors["host"]}
        helperText={errors["host"] || CONNECTION_DIALOG_STRINGS.HELPER_HOST}
        fullWidth
        required
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_SHARE_NAME}
        value={formData.share_name}
        onChange={(e) => handleChange("share_name", e.target.value)}
        error={!!errors["share_name"]}
        helperText={errors["share_name"] || CONNECTION_DIALOG_STRINGS.HELPER_SHARE_NAME}
        fullWidth
        required
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_USERNAME}
        value={formData.username}
        onChange={(e) => handleChange("username", e.target.value)}
        error={!!errors["username"]}
        helperText={errors["username"] || CONNECTION_DIALOG_STRINGS.HELPER_USERNAME}
        fullWidth
        required
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_PASSWORD}
        type={showPassword ? "text" : "password"}
        value={formData.password}
        onChange={(e) => handleChange("password", e.target.value)}
        error={!!errors["password"]}
        helperText={errors["password"] || (connection ? CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_EDIT : "")}
        fullWidth
        required={!connection}
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
        InputProps={{
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
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_PATH_PREFIX}
        value={formData.path_prefix}
        onChange={(e) => handleChange("path_prefix", e.target.value)}
        helperText={CONNECTION_DIALOG_STRINGS.HELPER_PATH_PREFIX}
        fullWidth
        variant="filled"
        FormHelperTextProps={{
          sx: { fontSize: "0.875rem" },
        }}
      />

      <FormControl fullWidth variant="filled">
        <InputLabel id="connection-scope-label">{t("settings.connectionDialog.labels.visibility")}</InputLabel>
        <Select
          labelId="connection-scope-label"
          value={formData.scope}
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
      </FormControl>

      {testResult && <Alert severity={testResult.status}>{testResult.message}</Alert>}
    </Box>
  );

  // Action buttons (shared between Dialog and Drawer)
  const actionButtons = (
    <>
      <Button
        onClick={handleTestConnection}
        disabled={testing || saving}
        sx={{
          textTransform: "none",
          color: "text.secondary",
          "&:hover": {
            bgcolor: "action.selected",
          },
        }}
      >
        {testing ? <CircularProgress size={20} /> : CONNECTION_DIALOG_STRINGS.BUTTON_TEST}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button
        onClick={onClose}
        disabled={saving}
        sx={{
          textTransform: "none",
          color: "text.secondary",
          "&:hover": {
            bgcolor: "action.selected",
          },
        }}
      >
        {CONNECTION_DIALOG_STRINGS.BUTTON_CANCEL}
      </Button>
      <Button onClick={handleSave} variant="contained" disabled={saving || testing} sx={{ textTransform: "none" }}>
        {saving ? <CircularProgress size={20} /> : CONNECTION_DIALOG_STRINGS.BUTTON_SAVE}
      </Button>
    </>
  );

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      title={connection ? CONNECTION_DIALOG_STRINGS.TITLE_EDIT : CONNECTION_DIALOG_STRINGS.TITLE_ADD}
      actions={actionButtons}
      contentSx={{ p: isMobile ? 2 : undefined }}
      onKeyDown={handleKeyDown}
    >
      {formContent}
    </ResponsiveFormDialog>
  );
};

export default ConnectionDialog;
