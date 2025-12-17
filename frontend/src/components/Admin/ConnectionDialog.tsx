import { Visibility, VisibilityOff } from "@mui/icons-material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  InputAdornment,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import api from "../../services/api";
import type { Connection, ConnectionCreate } from "../../types";
import { isApiError } from "../../types";
import { CONNECTION_DIALOG_STRINGS } from "./connectionDialogConstants";

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  connection?: Connection | null;
}

const ConnectionDialog: React.FC<ConnectionDialogProps> = ({ open, onClose, onSave, connection }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [formData, setFormData] = useState<ConnectionCreate>({
    name: "",
    type: "smb",
    host: "",
    port: 445,
    share_name: "",
    username: "",
    password: "",
    path_prefix: "/",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      newErrors.name = CONNECTION_DIALOG_STRINGS.ERROR_NAME_REQUIRED;
    }
    if (!formData.host.trim()) {
      newErrors.host = CONNECTION_DIALOG_STRINGS.ERROR_HOST_REQUIRED;
    }
    if (!formData.share_name.trim()) {
      newErrors.share_name = CONNECTION_DIALOG_STRINGS.ERROR_SHARE_NAME_REQUIRED;
    }
    if (!formData.username.trim()) {
      newErrors.username = CONNECTION_DIALOG_STRINGS.ERROR_USERNAME_REQUIRED;
    }
    if (!connection && !formData.password.trim()) {
      // Password required for new connections
      newErrors.password = CONNECTION_DIALOG_STRINGS.ERROR_PASSWORD_REQUIRED;
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
        // For new connections, we'll create a temporary connection to test
        // In production, you might want a separate test endpoint that doesn't save
        const tempConnection = await api.createConnection(formData);
        const result = await api.testConnection(tempConnection.id);
        // Delete the temp connection
        await api.deleteConnection(tempConnection.id);
        setTestResult(result as { status: "success" | "error"; message: string });
      }
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to test connection" : "Failed to test connection";
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
      if (connection) {
        // Edit mode - only send changed fields
        const updateData: Partial<ConnectionCreate> = {};
        if (formData.name !== connection.name) updateData.name = formData.name;
        if (formData.host !== connection.host) updateData.host = formData.host;
        if (formData.share_name !== connection.share_name) updateData.share_name = formData.share_name;
        if (formData.username !== connection.username) updateData.username = formData.username;
        if (formData.password.trim()) updateData.password = formData.password;
        if (formData.path_prefix !== connection.path_prefix) updateData.path_prefix = formData.path_prefix;

        await api.updateConnection(connection.id, updateData);
      } else {
        // Add mode - port will use default 445
        await api.createConnection(formData);
      }
      onSave();
      onClose();
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to save connection" : "Failed to save connection";
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
        error={!!errors.name}
        helperText={errors.name}
        fullWidth
        required
        variant="filled"
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_HOST}
        value={formData.host}
        onChange={(e) => handleChange("host", e.target.value)}
        error={!!errors.host}
        helperText={errors.host || CONNECTION_DIALOG_STRINGS.HELPER_HOST}
        fullWidth
        required
        variant="filled"
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_SHARE_NAME}
        value={formData.share_name}
        onChange={(e) => handleChange("share_name", e.target.value)}
        error={!!errors.share_name}
        helperText={errors.share_name || CONNECTION_DIALOG_STRINGS.HELPER_SHARE_NAME}
        fullWidth
        required
        variant="filled"
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_USERNAME}
        value={formData.username}
        onChange={(e) => handleChange("username", e.target.value)}
        error={!!errors.username}
        helperText={errors.username || CONNECTION_DIALOG_STRINGS.HELPER_USERNAME}
        fullWidth
        required
        variant="filled"
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
        }}
      />

      <TextField
        label={CONNECTION_DIALOG_STRINGS.LABEL_PASSWORD}
        type={showPassword ? "text" : "password"}
        value={formData.password}
        onChange={(e) => handleChange("password", e.target.value)}
        error={!!errors.password}
        helperText={errors.password || (connection ? CONNECTION_DIALOG_STRINGS.HELPER_PASSWORD_EDIT : "")}
        fullWidth
        required={!connection}
        variant="filled"
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
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
        slotProps={{
          formHelperText: {
            sx: { fontSize: "0.875rem" },
          },
        }}
      />

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
            bgcolor: "action.hover",
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
            bgcolor: "action.hover",
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

  // Mobile: Full-screen drawer
  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: "100%",
            height: "100%",
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* AppBar */}
          <AppBar position="static">
            <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
              <IconButton edge="start" color="inherit" onClick={onClose} aria-label={CONNECTION_DIALOG_STRINGS.ARIA_GO_BACK}>
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
                {connection ? CONNECTION_DIALOG_STRINGS.TITLE_EDIT : CONNECTION_DIALOG_STRINGS.TITLE_ADD}
              </Typography>
            </Toolbar>
          </AppBar>

          {/* Content */}
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
              p: 2,
              bgcolor: "background.default",
              pb: 10, // Extra padding for fixed footer
            }}
          >
            {formContent}
          </Box>

          {/* Actions - Fixed Footer */}
          <Box
            sx={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              gap: 1,
              p: 2,
              borderTop: 1,
              borderColor: "divider",
              bgcolor: "background.default",
              zIndex: 1,
            }}
          >
            {actionButtons}
          </Box>
        </Box>
      </Drawer>
    );
  }

  // Desktop: Dialog
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle>{connection ? CONNECTION_DIALOG_STRINGS.TITLE_EDIT : CONNECTION_DIALOG_STRINGS.TITLE_ADD}</DialogTitle>
      <DialogContent sx={{ bgcolor: "background.default" }}>{formContent}</DialogContent>
      <DialogActions sx={{ bgcolor: "background.default" }}>{actionButtons}</DialogActions>
    </Dialog>
  );
};

export default ConnectionDialog;
