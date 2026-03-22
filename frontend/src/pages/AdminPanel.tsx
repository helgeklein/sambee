import { Add as AddIcon } from "@mui/icons-material";
import { Alert, AppBar, Box, Button, CircularProgress, Container, Paper, Snackbar, Toolbar, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        showNotification(t("settings.adminPanel.accessDenied"), "error");
        navigate("/browse");
      }
    } catch (_error) {
      navigate("/login");
    }
  }, [navigate, showNotification, t]);

  const loadConnections = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getConnections();
      setConnections(data);
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.adminPanel.notifications.loadFailed"));
      showNotification(message, "error");
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

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
      const message = getApiErrorMessage(error, t("settings.adminPanel.notifications.testFailed"));
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
          ? t("settings.connectionManagement.notifications.savedPrivateInfo")
          : selectedConnection
            ? t("settings.connectionManagement.notifications.updatedSuccess")
            : t("settings.connectionManagement.notifications.createdSuccess"),
        savedConnection.scope === "private" ? "info" : "success"
      );
      return;
    }

    showNotification(
      selectedConnection
        ? t("settings.connectionManagement.notifications.updatedSuccess")
        : t("settings.connectionManagement.notifications.createdSuccess"),
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
      showNotification(t("settings.connectionManagement.notifications.deletedSuccess"), "success");
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t("settings.adminPanel.notifications.deleteFailed"));
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
            {t("settings.adminPanel.title")}
          </Typography>
          <Button color="inherit" startIcon={<AddIcon />} onClick={handleAddClick}>
            {t("settings.connectionManagement.addConnectionButton")}
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
        title={t("settings.adminPanel.deleteDialogTitle")}
        description={t("settings.adminPanel.deleteDialogDescription")}
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
