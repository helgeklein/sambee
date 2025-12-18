//
// ConnectionSettings
//

import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
  CheckCircle as TestIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Fab,
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  Snackbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import ConnectionDialog from "../components/Admin/ConnectionDialog";
import DeleteDialog from "../components/Admin/DeleteDialog";
import api from "../services/api";
import type { Connection } from "../types";
import { isApiError } from "../types";

/**
 * ConnectionSettings
 *
 * Connection management content for admin users.
 * Used within SettingsLayout (no AppBar needed).
 * Responsive design: table on desktop, cards on mobile.
 */
export function ConnectionSettings() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ element: HTMLElement; connection: Connection } | null>(null);
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

  const loadConnections = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getConnections();
      setConnections(data);
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to load connections" : "Failed to load connections";
      showNotification(message, "error");
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleAddClick = () => {
    setSelectedConnection(null);
    setConnectionDialogOpen(true);
  };

  const handleEdit = (connection: Connection) => {
    setSelectedConnection(connection);
    setConnectionDialogOpen(true);
  };

  const handleDeleteClick = (connection: Connection) => {
    setSelectedConnection(connection);
    setDeleteDialogOpen(true);
  };

  const handleConnectionDialogClose = () => {
    setConnectionDialogOpen(false);
    setSelectedConnection(null);
  };

  const handleConnectionSave = () => {
    loadConnections();
    showNotification(`Connection ${selectedConnection ? "updated" : "created"} successfully`, "success");
    handleConnectionDialogClose();
  };

  const handleDeleteConfirm = async () => {
    if (!selectedConnection) return;

    try {
      await api.deleteConnection(selectedConnection.id);
      showNotification("Connection deleted successfully", "success");
      await loadConnections();
      setDeleteDialogOpen(false);
      setSelectedConnection(null);
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to delete connection" : "Failed to delete connection";
      showNotification(message, "error");
    }
  };

  const handleTestConnection = async (connection: Connection) => {
    try {
      const result = await api.testConnection(connection.id);
      showNotification(result.message, result.status as "success" | "error");
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Connection test failed" : "Connection test failed";
      showNotification(message, "error");
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, connection: Connection) => {
    setMenuAnchor({ element: event.currentTarget, connection });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleMenuTest = () => {
    if (menuAnchor) {
      handleTestConnection(menuAnchor.connection);
    }
    handleMenuClose();
  };

  const handleMenuEdit = () => {
    if (menuAnchor) {
      handleEdit(menuAnchor.connection);
    }
    handleMenuClose();
  };

  const handleMenuDelete = () => {
    if (menuAnchor) {
      handleDeleteClick(menuAnchor.connection);
    }
    handleMenuClose();
  };

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
      {/* Desktop: Header with button */}
      {isDesktop && (
        <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Typography variant="h5" fontWeight="medium">
              Connections
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddClick}>
              Add Connection
            </Button>
          </Box>
        </Box>
      )}

      {/* Connection List */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : connections.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="h6" color="text.secondary">
              No connections configured
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Click {isDesktop ? "the + button" : "the + button in the toolbar"} to create your first SMB share connection
            </Typography>
          </Box>
        ) : isDesktop ? (
          // Desktop: Edge-to-edge list layout with inline action buttons
          <List sx={{ py: 0 }}>
            {connections.map((connection) => (
              <Box key={connection.id}>
                <ListItem
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    py: 2.5,
                    px: 2,
                  }}
                >
                  {/* Connection Name and Type */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1.5 }}>
                    <Typography variant="h6" fontWeight="medium">
                      {connection.name}
                    </Typography>
                    <Chip label={connection.type.toUpperCase()} size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                  </Box>

                  {/* User */}
                  <Box sx={{ display: "flex", mb: -0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                      User:
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {connection.username}
                    </Typography>
                  </Box>

                  {/* UNC Path and Action Buttons */}
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box sx={{ display: "flex" }}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                        Path:
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        \\{connection.host}\{connection.share_name}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 1, ml: 2 }}>
                      <Tooltip title="Test Connection">
                        <IconButton onClick={() => handleTestConnection(connection)} color="primary" aria-label="Test connection">
                          <TestIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton onClick={() => handleEdit(connection)} color="primary" aria-label="Edit connection">
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton onClick={() => handleDeleteClick(connection)} color="error" aria-label="Delete connection">
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        ) : (
          // Mobile: Edge-to-edge list layout
          <List sx={{ py: 0 }}>
            {connections.map((connection) => (
              <Box key={connection.id}>
                <ListItem
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    py: 2.5,
                    px: 2,
                  }}
                >
                  {/* Connection Name, Type, and Menu */}
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1.5 }}>
                    <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 2 }}>
                      <Typography variant="h6" fontWeight="medium">
                        {connection.name}
                      </Typography>
                      <Chip label={connection.type.toUpperCase()} size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                    </Box>
                    <IconButton size="small" onClick={(e) => handleMenuOpen(e, connection)} aria-label="Connection actions" sx={{ mt: 0 }}>
                      <MoreVertIcon />
                    </IconButton>
                  </Box>

                  {/* User */}
                  <Box sx={{ display: "flex", mb: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                      User:
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {connection.username}
                    </Typography>
                  </Box>

                  {/* UNC Path */}
                  <Box sx={{ display: "flex" }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                      Path:
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      \\{connection.host}\{connection.share_name}
                    </Typography>
                  </Box>
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        )}
      </Box>

      {/* Mobile: FAB for adding connections */}
      {!isDesktop && (
        <Fab
          color="primary"
          aria-label="add connection"
          onClick={handleAddClick}
          sx={{
            position: "fixed",
            bottom: "calc(16px + env(safe-area-inset-bottom))",
            right: "calc(16px + env(safe-area-inset-right))",
          }}
        >
          <AddIcon />
        </Fab>
      )}

      {/* Actions Menu */}
      <Menu
        anchorEl={menuAnchor?.element}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: "background.default",
              minWidth: 180,
            },
          },
        }}
      >
        <MenuItem onClick={handleMenuTest}>
          <TestIcon fontSize="small" sx={{ mr: 1.5, color: "primary.main" }} />
          Test Connection
        </MenuItem>
        <MenuItem onClick={handleMenuEdit}>
          <EditIcon fontSize="small" sx={{ mr: 1.5, color: "primary.main" }} />
          Edit
        </MenuItem>
        <MenuItem onClick={handleMenuDelete} sx={{ color: "error.main" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} />
          Delete
        </MenuItem>
      </Menu>

      {/* Connection Dialog */}
      <ConnectionDialog
        open={connectionDialogOpen}
        onClose={handleConnectionDialogClose}
        onSave={handleConnectionSave}
        connection={selectedConnection}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setSelectedConnection(null);
        }}
        onConfirm={handleDeleteConfirm}
        connection={selectedConnection}
      />

      {/* Notification Snackbar */}
      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={() => setNotification({ ...notification, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={notification.severity} onClose={() => setNotification({ ...notification, open: false })} sx={{ width: "100%" }}>
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
