import { Add as AddIcon } from "@mui/icons-material";
import { Alert, AppBar, Box, Button, CircularProgress, Container, Paper, Snackbar, Toolbar, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ConnectionDialog from "../components/Admin/ConnectionDialog";
import ConnectionList from "../components/Admin/ConnectionList";
import DeleteDialog from "../components/Admin/DeleteDialog";
import api from "../services/api";
import type { Connection } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";
import { isAdminUser } from "../utils/userAccess";

const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
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

  const showNotification = useCallback((message: string, severity: "success" | "error" | "info") => {
    setNotification({ open: true, message, severity });
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const user = await api.getCurrentUser();
      if (!isAdminUser(user)) {
        showNotification("Access denied. Admin privileges required.", "error");
        navigate("/browse");
      }
    } catch (_error) {
      navigate("/login");
    }
  }, [navigate, showNotification]);

  const loadConnections = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getConnections();
      setConnections(data);
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to load connections");
      showNotification(message, "error");
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    checkAuth();
    loadConnections();
  }, [checkAuth, loadConnections]);

  const handleAddClick = () => {
    setSelectedConnection(null);
    setDialogOpen(true);
  };

  const handleEdit = (connection: Connection) => {
    setSelectedConnection(connection);
    setDialogOpen(true);
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
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to test connection");
      showNotification(message, "error");
    } finally {
      setTesting(false);
    }
  };

  const handleDialogSave = (savedConnection: Connection, requestedScope: "shared" | "private") => {
    loadConnections();
    if (savedConnection.scope !== requestedScope) {
      showNotification(
        savedConnection.scope === "private"
          ? "Connection saved as private. Shared visibility requires admin access."
          : `Connection ${selectedConnection ? "updated" : "created"} successfully`,
        savedConnection.scope === "private" ? "info" : "success"
      );
      return;
    }

    showNotification(`Connection ${selectedConnection ? "updated" : "created"} successfully`, "success");
  };

  const handleDeleteConfirm = async () => {
    if (!selectedConnection) return;

    try {
      await api.deleteConnection(selectedConnection.id);
      setDeleteDialogOpen(false);
      setSelectedConnection(null);
      loadConnections();
      showNotification("Connection deleted successfully", "success");
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to delete connection");
      showNotification(message, "error");
    }
  };

  const handleCloseNotification = () => {
    setNotification((prev) => ({ ...prev, open: false }));
  };

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Admin Panel - SMB Share Management
          </Typography>
          <Button color="inherit" startIcon={<AddIcon />} onClick={handleAddClick}>
            Add Connection
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Paper elevation={3} sx={{ p: 3 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <ConnectionList connections={connections} onEdit={handleEdit} onDelete={handleDelete} onTest={handleTest} loading={testing} />
          )}
        </Paper>
      </Container>

      <ConnectionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleDialogSave} connection={selectedConnection} />

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Connection"
        description="Are you sure you want to delete the connection"
        itemName={selectedConnection?.name ?? null}
      />

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert onClose={handleCloseNotification} severity={notification.severity} sx={{ width: "100%" }}>
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AdminPanel;
