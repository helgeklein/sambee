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
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import {
  settingsDestructiveIconButtonSx,
  settingsMetadataChipSx,
  settingsPrimaryButtonSx,
  settingsPrimaryFabSx,
  settingsUtilityIconButtonSx,
} from "../components/Settings/settingsButtonStyles";
import { useSettingsAccess } from "../components/Settings/useSettingsAccess";
import api from "../services/api";
import type { Connection } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";

const CONNECTION_SETTINGS_HEADER = {
  title: "SMB Connections",
  description: "Browse shared connections and manage your private SMB share connections.",
};

/**
 * ConnectionSettings
 *
 * Connection management content for admin users.
 * Used within SettingsLayout (no AppBar needed).
 * Responsive design: table on desktop, cards on mobile.
 */

interface ConnectionSettingsProps {
  isAdmin?: boolean;
  /** Callback when connections are added, updated, or deleted */
  onConnectionsChanged?: () => void;
  /**
   * Force desktop layout regardless of screen size.
   * Used when rendered inside SettingsDialog where the mobile 3-dot menu
   * would overlap with the dialog's close button.
   */
  forceDesktopLayout?: boolean;
  showHeader?: boolean;
  sectionTitle?: string;
  sectionDescription?: string;
  showMobileFab?: boolean;
}

export function ConnectionSettings({
  isAdmin,
  onConnectionsChanged,
  forceDesktopLayout = false,
  showHeader = true,
  sectionTitle,
  sectionDescription,
  showMobileFab = true,
}: ConnectionSettingsProps) {
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("sm"));
  const { isAdmin: detectedIsAdmin } = useSettingsAccess();
  // Use desktop layout if forced or on large screens
  const isDesktop = forceDesktopLayout || isLargeScreen;
  const effectiveIsAdmin = Boolean(isAdmin || detectedIsAdmin);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    element: HTMLElement;
    connection: Connection;
  } | null>(null);
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
      const message = getApiErrorMessage(error, "Failed to load connections");
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
    if (!connection.can_manage) return;
    setSelectedConnection(connection);
    setConnectionDialogOpen(true);
  };

  const handleDeleteClick = (connection: Connection) => {
    if (!connection.can_manage) return;
    setSelectedConnection(connection);
    setDeleteDialogOpen(true);
  };

  const handleConnectionDialogClose = () => {
    setConnectionDialogOpen(false);
    setSelectedConnection(null);
  };

  const handleConnectionSave = (savedConnection: Connection, requestedScope: "shared" | "private") => {
    loadConnections();
    if (savedConnection.scope !== requestedScope) {
      showNotification(
        savedConnection.scope === "private"
          ? "Connection saved as private. Shared visibility requires admin access."
          : `Connection ${selectedConnection ? "updated" : "created"} successfully`,
        savedConnection.scope === "private" ? "info" : "success"
      );
    } else {
      showNotification(`Connection ${selectedConnection ? "updated" : "created"} successfully`, "success");
    }
    handleConnectionDialogClose();
    onConnectionsChanged?.();
  };

  const handleDeleteConfirm = async () => {
    if (!selectedConnection) return;

    try {
      await api.deleteConnection(selectedConnection.id);
      showNotification("Connection deleted successfully", "success");
      await loadConnections();
      setDeleteDialogOpen(false);
      setSelectedConnection(null);
      onConnectionsChanged?.();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to delete connection");
      showNotification(message, "error");
    }
  };

  const handleTestConnection = async (connection: Connection) => {
    if (!connection.can_manage) return;

    try {
      const result = await api.testConnection(connection.id);
      showNotification(result.message, result.status as "success" | "error");
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Connection test failed");
      showNotification(message, "error");
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, connection: Connection) => {
    if (!connection.can_manage) return;
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

  const sharedConnections = connections.filter((connection) => connection.scope === "shared");
  const privateConnections = connections.filter((connection) => connection.scope === "private");

  const renderConnectionList = (sectionConnections: Connection[]) => {
    if (sectionConnections.length === 0) {
      return null;
    }

    if (isDesktop) {
      return (
        <List sx={{ py: 0 }}>
          {sectionConnections.map((connection) => (
            <Box key={connection.id}>
              <ListItem
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  py: 2.5,
                  px: 0,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    mb: 1.5,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography variant="h6" fontWeight="medium">
                    {connection.name}
                  </Typography>
                  <Chip label={connection.type.toUpperCase()} size="small" variant="outlined" sx={settingsMetadataChipSx} />
                  <Chip label={connection.scope.toUpperCase()} size="small" variant="outlined" sx={settingsMetadataChipSx} />
                </Box>

                <Box sx={{ display: "flex", mb: -0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                    User:
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {connection.username}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <Box sx={{ display: "flex" }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                      Path:
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      \\{connection.host}\{connection.share_name}
                      {connection.path_prefix && connection.path_prefix !== "/" && connection.path_prefix.replace(/\//g, "\\")}
                    </Typography>
                  </Box>
                  {connection.can_manage ? (
                    <Box sx={{ display: "flex", gap: 1, ml: 2 }}>
                      <Tooltip title="Test Connection">
                        <IconButton
                          onClick={() => handleTestConnection(connection)}
                          aria-label="Test connection"
                          sx={settingsUtilityIconButtonSx}
                        >
                          <TestIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton onClick={() => handleEdit(connection)} aria-label="Edit connection" sx={settingsUtilityIconButtonSx}>
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          onClick={() => handleDeleteClick(connection)}
                          aria-label="Delete connection"
                          sx={settingsDestructiveIconButtonSx}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ) : null}
                </Box>
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      );
    }

    return (
      <List sx={{ py: 0 }}>
        {sectionConnections.map((connection) => (
          <Box key={connection.id}>
            <ListItem
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                py: 2.5,
                px: 0,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  mb: 1.5,
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography variant="h6" fontWeight="medium">
                    {connection.name}
                  </Typography>
                  <Chip label={connection.type.toUpperCase()} size="small" variant="outlined" sx={settingsMetadataChipSx} />
                  <Chip label={connection.scope.toUpperCase()} size="small" variant="outlined" sx={settingsMetadataChipSx} />
                </Box>
                {connection.can_manage ? (
                  <IconButton
                    size="small"
                    onClick={(e) => handleMenuOpen(e, connection)}
                    aria-label="Connection actions"
                    sx={{
                      ...settingsUtilityIconButtonSx,
                      mt: 0,
                      width: 32,
                      height: 32,
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                ) : null}
              </Box>

              <Box sx={{ display: "flex", mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                  User:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {connection.username}
                </Typography>
              </Box>

              <Box sx={{ display: "flex" }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                  Path:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  \\{connection.host}\{connection.share_name}
                  {connection.path_prefix && connection.path_prefix !== "/" && connection.path_prefix.replace(/\//g, "\\")}
                </Typography>
              </Box>
            </ListItem>
            <Divider />
          </Box>
        ))}
      </List>
    );
  };

  const renderSection = (title: string, description: string, sectionConnections: Connection[], emptyMessage: string) => (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {description}
      </Typography>
      {sectionConnections.length === 0 ? (
        <Box sx={{ py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {emptyMessage}
          </Typography>
        </Box>
      ) : (
        renderConnectionList(sectionConnections)
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        height: showHeader ? "100%" : "auto",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: showHeader ? "hidden" : "visible",
      }}
    >
      {showHeader ? (
        <SettingsSectionHeader
          title={CONNECTION_SETTINGS_HEADER.title}
          description={CONNECTION_SETTINGS_HEADER.description}
          dialogSafe={forceDesktopLayout}
          showTitle={isDesktop}
          actions={
            isDesktop ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddClick} sx={settingsPrimaryButtonSx}>
                Add Connection
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, pb: 2 }}>
          <SettingsGroup
            title={sectionTitle}
            description={sectionDescription}
            actions={
              isDesktop ? (
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddClick} sx={settingsPrimaryButtonSx}>
                  Add Connection
                </Button>
              ) : null
            }
          />
        </Box>
      )}

      {/* Connection List */}
      <Box sx={{ flex: showHeader ? 1 : undefined, overflow: showHeader ? "auto" : "visible", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
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
              {effectiveIsAdmin
                ? `Click ${isDesktop ? "the + button" : "the + button in the toolbar"} to create a shared or private SMB connection`
                : `Click ${isDesktop ? "the + button" : "the + button in the toolbar"} to create your first private SMB connection`}
            </Typography>
          </Box>
        ) : (
          <>
            {renderSection(
              "Shared connections",
              "Admins can create these for everyone. You can browse them, but only admins can change them.",
              sharedConnections,
              "No shared connections are available."
            )}
            {renderSection(
              "My connections",
              "These connections are visible only to your account.",
              privateConnections,
              "You have no private connections yet."
            )}
          </>
        )}
      </Box>

      {/* Mobile: FAB for adding connections */}
      {!isDesktop && showMobileFab && (
        <Fab color="primary" aria-label="add connection" onClick={handleAddClick} sx={settingsPrimaryFabSx}>
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
        title="Delete Connection"
        description="Are you sure you want to delete the connection"
        itemName={selectedConnection?.name ?? null}
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
