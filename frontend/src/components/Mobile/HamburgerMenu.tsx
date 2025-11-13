import { Logout as LogoutIcon, Settings as SettingsIcon } from "@mui/icons-material";
import HomeIcon from "@mui/icons-material/Home";
import {
  Box,
  Divider,
  Drawer,
  FormControl,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import type React from "react";
import type { Connection } from "../../types";

interface HamburgerMenuProps {
  open: boolean;
  onClose: () => void;
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  onNavigateToRoot: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  isAdmin: boolean;
}

const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  open,
  onClose,
  connections,
  selectedConnectionId,
  onConnectionChange,
  onNavigateToRoot,
  onOpenSettings,
  onLogout,
  isAdmin,
}) => {
  const handleConnectionChange = (connectionId: string) => {
    onConnectionChange(connectionId);
    onClose();
  };

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      sx={{
        "& .MuiDrawer-paper": {
          width: 280,
          boxSizing: "border-box",
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* App Logo/Title */}
        <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            Sambee
          </Typography>
        </Box>

        {/* Connection Selector */}
        {connections.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
              Connection
            </Typography>
            <FormControl fullWidth size="small">
              <Select
                value={selectedConnectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                displayEmpty
              >
                {connections.map((conn) => (
                  <MenuItem key={conn.id} value={conn.id}>
                    {conn.name}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      ({conn.host}/{conn.share_name})
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
      </Box>

      <Divider />

      {/* Menu Items */}
      <List>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              onNavigateToRoot();
              onClose();
            }}
          >
            <ListItemIcon>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText primary="Root" />
          </ListItemButton>
        </ListItem>

        {isAdmin && (
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
            >
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </ListItem>
        )}

        <ListItem disablePadding>
          <ListItemButton onClick={onLogout}>
            <ListItemIcon>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary="Logout" />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );
};

export default HamburgerMenu;
