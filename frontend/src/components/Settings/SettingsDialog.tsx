import {
  Add as AddIcon,
  Close as CloseIcon,
  KeyboardOutlined as KeyboardIcon,
  Logout as LogoutIcon,
  Palette as PaletteIcon,
  Storage as StorageIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { KeyboardShortcut } from "../../hooks/useKeyboardShortcuts";
import api from "../../services/api";
import { useSambeeTheme } from "../../theme";
import type { Connection } from "../../types";
import { isApiError } from "../../types";
import ConnectionDialog from "../Admin/ConnectionDialog";
import ConnectionList from "../Admin/ConnectionList";
import DeleteDialog from "../Admin/DeleteDialog";

type SettingsCategory = "connections" | "appearance" | "shortcuts" | "account";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  shortcuts: KeyboardShortcut[];
  onLogout: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, isAdmin, shortcuts, onLogout }) => {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>("connections");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
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
    if (open) {
      loadConnections();
    }
  }, [open, loadConnections]);

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
    } catch (error: unknown) {
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to test connection" : "Failed to test connection";
      showNotification(message, "error");
    } finally {
      setTesting(false);
    }
  };

  const handleDialogSave = () => {
    loadConnections();
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
      const message = isApiError(error) ? error.response?.data?.detail || "Failed to delete connection" : "Failed to delete connection";
      showNotification(message, "error");
    }
  };

  const handleCloseNotification = () => {
    setNotification((prev) => ({ ...prev, open: false }));
  };

  const handleLogout = () => {
    onClose();
    onLogout();
  };

  // Reset to first category when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedCategory(isAdmin ? "connections" : "appearance");
    }
  }, [open, isAdmin]);

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: "80vh" } }}>
        <Box sx={{ display: "flex", height: "100%" }}>
          {/* Left Sidebar */}
          <Box
            sx={{
              width: 240,
              borderRight: 1,
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="h6">Settings</Typography>
              <IconButton onClick={onClose} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
            <Divider />
            <List sx={{ flex: 1 }}>
              {isAdmin && (
                <ListItem disablePadding>
                  <ListItemButton selected={selectedCategory === "connections"} onClick={() => setSelectedCategory("connections")}>
                    <ListItemIcon>
                      <StorageIcon />
                    </ListItemIcon>
                    <ListItemText primary="Connections" />
                  </ListItemButton>
                </ListItem>
              )}
              <ListItem disablePadding>
                <ListItemButton selected={selectedCategory === "appearance"} onClick={() => setSelectedCategory("appearance")}>
                  <ListItemIcon>
                    <PaletteIcon />
                  </ListItemIcon>
                  <ListItemText primary="Appearance" />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton selected={selectedCategory === "shortcuts"} onClick={() => setSelectedCategory("shortcuts")}>
                  <ListItemIcon>
                    <KeyboardIcon />
                  </ListItemIcon>
                  <ListItemText primary="Keyboard Shortcuts" />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton selected={selectedCategory === "account"} onClick={() => setSelectedCategory("account")}>
                  <ListItemIcon>
                    <LogoutIcon />
                  </ListItemIcon>
                  <ListItemText primary="Account" />
                </ListItemButton>
              </ListItem>
            </List>
          </Box>

          {/* Right Content Area */}
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DialogContent sx={{ flex: 1, overflow: "auto" }}>
              {selectedCategory === "connections" && isAdmin && (
                <ConnectionsSettings
                  connections={connections}
                  loading={loading}
                  testing={testing}
                  onAddClick={handleAddClick}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onTest={handleTest}
                />
              )}
              {selectedCategory === "appearance" && <AppearanceSettings />}
              {selectedCategory === "shortcuts" && <KeyboardShortcutsSettings shortcuts={shortcuts} />}
              {selectedCategory === "account" && <AccountSettings onLogout={handleLogout} />}
            </DialogContent>
          </Box>
        </Box>
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
        <Alert onClose={handleCloseNotification} severity={notification.severity} sx={{ width: "100%" }}>
          {notification.message}
        </Alert>
      </Snackbar>
    </>
  );
};

//
// ConnectionsSettings
//
interface ConnectionsSettingsProps {
  connections: Connection[];
  loading: boolean;
  testing: boolean;
  onAddClick: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
}

const ConnectionsSettings: React.FC<ConnectionsSettingsProps> = ({
  connections,
  loading,
  testing,
  onAddClick,
  onEdit,
  onDelete,
  onTest,
}) => {
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h5">SMB Connection Settings</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onAddClick}>
          Add Connection
        </Button>
      </Box>
      <ConnectionList connections={connections} onEdit={onEdit} onDelete={onDelete} onTest={onTest} loading={testing || loading} />
    </Box>
  );
};

//
// AppearanceSettings
//
const AppearanceSettings: React.FC = () => {
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();

  const handleSelect = (themeId: string) => {
    setThemeById(themeId);
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Appearance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choose your preferred theme
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
          gap: 2,
        }}
      >
        {availableThemes.map((theme) => (
          <Card
            key={theme.id}
            variant="outlined"
            sx={{
              border: currentTheme.id === theme.id ? 2 : 1,
              borderColor: currentTheme.id === theme.id ? "primary.main" : "divider",
            }}
          >
            <CardActionArea onClick={() => handleSelect(theme.id)}>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                  <Radio checked={currentTheme.id === theme.id} />
                  <Typography variant="h6" sx={{ ml: 1 }}>
                    {theme.name}
                  </Typography>
                </Box>
                {theme.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {theme.description}
                  </Typography>
                )}
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
                    {theme.mode === "dark" ? "Dark" : "Light"}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.5,
                      flex: 1,
                    }}
                  >
                    <Box
                      sx={{
                        flex: 1,
                        height: 40,
                        backgroundColor: theme.primary.main,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                      title="Primary color"
                    />
                    <Box
                      sx={{
                        flex: 1,
                        height: 40,
                        backgroundColor: theme.secondary.main,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                      title="Secondary color"
                    />
                  </Box>
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

//
// KeyboardShortcutsSettings
//
interface KeyboardShortcutsSettingsProps {
  shortcuts: KeyboardShortcut[];
}

interface GroupedShortcut {
  description: string;
  labels: string[];
}

const KeyboardShortcutsSettings: React.FC<KeyboardShortcutsSettingsProps> = ({ shortcuts }) => {
  // Group shortcuts by description
  const groupedShortcuts: GroupedShortcut[] = [];
  const descriptionMap = new Map<string, string[]>();

  for (const shortcut of shortcuts) {
    const existing = descriptionMap.get(shortcut.description);
    if (existing) {
      existing.push(shortcut.label);
    } else {
      descriptionMap.set(shortcut.description, [shortcut.label]);
    }
  }

  // Convert map to array, preserving order from original shortcuts
  const seenDescriptions = new Set<string>();
  for (const shortcut of shortcuts) {
    if (!seenDescriptions.has(shortcut.description)) {
      seenDescriptions.add(shortcut.description);
      groupedShortcuts.push({
        description: shortcut.description,
        labels: descriptionMap.get(shortcut.description) || [],
      });
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Keyboard Shortcuts
      </Typography>
      {groupedShortcuts.length === 0 ? (
        <Box sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>No keyboard shortcuts available</Box>
      ) : (
        <Table size="small">
          <TableBody>
            {groupedShortcuts.map((group) => (
              <TableRow key={group.description}>
                <TableCell sx={{ width: "30%" }}>
                  <Typography variant="body2" component="strong" fontWeight="bold">
                    {group.labels.join(" / ")}
                  </Typography>
                </TableCell>
                <TableCell>{group.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

//
// AccountSettings
//
interface AccountSettingsProps {
  onLogout: () => void;
}

const AccountSettings: React.FC<AccountSettingsProps> = ({ onLogout }) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Account
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage your account settings
      </Typography>
      <Button variant="outlined" color="error" startIcon={<LogoutIcon />} onClick={onLogout}>
        Logout
      </Button>
    </Box>
  );
};

export default SettingsDialog;
