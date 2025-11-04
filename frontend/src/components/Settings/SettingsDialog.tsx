import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Button,
  Snackbar,
  Alert,
} from "@mui/material";
import { Close as CloseIcon, Add as AddIcon } from "@mui/icons-material";
import ConnectionList from "../Admin/ConnectionList";
import ConnectionDialog from "../Admin/ConnectionDialog";
import DeleteDialog from "../Admin/DeleteDialog";
import api from "../../services/api";
import { Connection } from "../../types";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] =
    useState<Connection | null>(null);
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info";
  }>({
    open: false,
    message: "",
    severity: "success",
  });
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      loadConnections();
    }
  }, [open]);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const data = await api.getConnections();
      setConnections(data);
    } catch (error: any) {
      showNotification(
        error.response?.data?.detail || "Failed to load connections",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (
    message: string,
    severity: "success" | "error" | "info"
  ) => {
    setNotification({ open: true, message, severity });
  };

  const handleAddClick = () => {
    setSelectedConnection(null);
    setConnectionDialogOpen(true);
  };

  const handleEdit = (connection: Connection) => {
    setSelectedConnection(connection);
    setConnectionDialogOpen(true);
  };

  const handleDelete = (connection: Connection) => {
    setSelectedConnection(connection);
    setDeleteDialogOpen(true);
  };

  const handleTest = async (connection: Connection) => {
    setTesting(true);
    try {
      const result = await api.testConnection(connection.id);
      showNotification(result.message, result.status as "success" | "error");
    } catch (error: any) {
      showNotification(
        error.response?.data?.detail || "Failed to test connection",
        "error"
      );
    } finally {
      setTesting(false);
    }
  };

  const handleDialogSave = () => {
    loadConnections();
    showNotification(
      `Connection ${selectedConnection ? "updated" : "created"} successfully`,
      "success"
    );
  };

  const handleDeleteConfirm = async () => {
    if (!selectedConnection) return;

    try {
      await api.deleteConnection(selectedConnection.id);
      setDeleteDialogOpen(false);
      setSelectedConnection(null);
      loadConnections();
      showNotification("Connection deleted successfully", "success");
    } catch (error: any) {
      showNotification(
        error.response?.data?.detail || "Failed to delete connection",
        "error"
      );
    }
  };

  const handleCloseNotification = () => {
    setNotification((prev) => ({ ...prev, open: false }));
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box display="flex" alignItems="center" gap={2}>
              SMB Connection Settings
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleAddClick}
              >
                Add Connection
              </Button>
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <ConnectionList
            connections={connections}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onTest={handleTest}
            loading={testing || loading}
          />
        </DialogContent>
      </Dialog>

      <ConnectionDialog
        open={connectionDialogOpen}
        onClose={() => setConnectionDialogOpen(false)}
        onSave={handleDialogSave}
        connection={selectedConnection}
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        connection={selectedConnection}
      />

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={handleCloseNotification}
          severity={notification.severity}
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default SettingsDialog;
