import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { Connection, ConnectionCreate } from "../../types";
import api from "../../services/api";

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  connection?: Connection | null;
}

const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  open,
  onClose,
  onSave,
  connection,
}) => {
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
  }, [connection, open]);

  const handleChange = (
    field: keyof ConnectionCreate,
    value: string | number
  ) => {
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
      newErrors.name = "Connection name is required";
    }
    if (!formData.host.trim()) {
      newErrors.host = "Host is required";
    }
    if (!formData.share_name.trim()) {
      newErrors.share_name = "Share name is required";
    }
    if (!formData.username.trim()) {
      newErrors.username = "Username is required";
    }
    if (!connection && !formData.password.trim()) {
      // Password required for new connections
      newErrors.password = "Password is required";
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
        setTestResult(
          result as { status: "success" | "error"; message: string }
        );
      } else {
        // For new connections, we'll create a temporary connection to test
        // In production, you might want a separate test endpoint that doesn't save
        const tempConnection = await api.createConnection(formData);
        const result = await api.testConnection(tempConnection.id);
        // Delete the temp connection
        await api.deleteConnection(tempConnection.id);
        setTestResult(
          result as { status: "success" | "error"; message: string }
        );
      }
    } catch (error: any) {
      setTestResult({
        status: "error",
        message: error.response?.data?.detail || "Failed to test connection",
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
        if (formData.share_name !== connection.share_name)
          updateData.share_name = formData.share_name;
        if (formData.username !== connection.username)
          updateData.username = formData.username;
        if (formData.password.trim()) updateData.password = formData.password;
        if (formData.path_prefix !== connection.path_prefix)
          updateData.path_prefix = formData.path_prefix;

        await api.updateConnection(connection.id, updateData);
      } else {
        // Add mode - port will use default 445
        await api.createConnection(formData);
      }
      onSave();
      onClose();
    } catch (error: any) {
      setTestResult({
        status: "error",
        message: error.response?.data?.detail || "Failed to save connection",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {connection ? "Edit Connection" : "Add New Connection"}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <TextField
            label="Connection Name"
            value={formData.name}
            onChange={(e) => handleChange("name", e.target.value)}
            error={!!errors.name}
            helperText={errors.name}
            fullWidth
            required
          />

          <TextField
            label="Host"
            value={formData.host}
            onChange={(e) => handleChange("host", e.target.value)}
            error={!!errors.host}
            helperText={errors.host || "IP address or hostname"}
            placeholder="192.168.1.100 or server.local"
            fullWidth
            required
          />

          <TextField
            label="Share Name"
            value={formData.share_name}
            onChange={(e) => handleChange("share_name", e.target.value)}
            error={!!errors.share_name}
            helperText={errors.share_name || "Name of the SMB share"}
            placeholder="share"
            fullWidth
            required
          />

          <TextField
            label="Username"
            value={formData.username}
            onChange={(e) => handleChange("username", e.target.value)}
            error={!!errors.username}
            helperText={errors.username}
            fullWidth
            required
          />

          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            value={formData.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={!!errors.password}
            helperText={
              errors.password ||
              (connection ? "Leave blank to keep existing password" : "")
            }
            fullWidth
            required={!connection}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="toggle password visibility"
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
            label="Path Prefix"
            value={formData.path_prefix}
            onChange={(e) => handleChange("path_prefix", e.target.value)}
            helperText="Base path within the share (optional)"
            placeholder="/"
            fullWidth
          />

          {testResult && (
            <Alert severity={testResult.status}>{testResult.message}</Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleTestConnection} disabled={testing || saving}>
          {testing ? <CircularProgress size={24} /> : "Test Connection"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || testing}
        >
          {saving ? <CircularProgress size={24} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConnectionDialog;
