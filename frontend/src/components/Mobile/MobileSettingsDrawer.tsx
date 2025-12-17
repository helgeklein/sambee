//
// MobileSettingsDrawer
//

import { ChevronRight as ChevronRightIcon, Palette as PaletteIcon, Storage as StorageIcon } from "@mui/icons-material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import { AppearanceSettings } from "../../pages/AppearanceSettings";
import { ConnectionSettings } from "../../pages/ConnectionSettings";
import api from "../../services/api";

interface MobileSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

type SettingsView = "main" | "appearance" | "connections";

/**
 * MobileSettingsDrawer
 *
 * Full-screen drawer for mobile settings.
 * Preserves underlying page state by using drawer instead of routing.
 */
export const MobileSettingsDrawer: React.FC<MobileSettingsDrawerProps> = ({ open, onClose }) => {
  const [currentView, setCurrentView] = useState<SettingsView>("main");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (open) {
      // Check admin status when drawer opens
      api
        .getCurrentUser()
        .then((user) => setIsAdmin(user.is_admin))
        .catch(() => setIsAdmin(false));
    }
  }, [open]);

  // Reset to main view when drawer closes
  useEffect(() => {
    if (!open) {
      setCurrentView("main");
    }
  }, [open]);

  const handleBack = () => {
    if (currentView === "main") {
      onClose();
    } else {
      setCurrentView("main");
    }
  };

  const getTitle = () => {
    switch (currentView) {
      case "appearance":
        return "Appearance";
      case "connections":
        return "Connections";
      default:
        return "Settings";
    }
  };

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
            <IconButton edge="start" color="inherit" onClick={handleBack} aria-label="Go back">
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
              {getTitle()}
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {currentView === "main" && (
            <Box sx={{ height: "100%", bgcolor: "background.default" }}>
              <List sx={{ py: 0 }}>
                {isAdmin && (
                  <>
                    <ListItem disablePadding>
                      <ListItemButton onClick={() => setCurrentView("connections")} sx={{ py: 2 }}>
                        <ListItemIcon>
                          <StorageIcon sx={{ color: "primary.main", fontSize: 28 }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography variant="h6" fontWeight="medium">
                              Connections
                            </Typography>
                          }
                          secondary="Manage SMB connections"
                        />
                        <ChevronRightIcon sx={{ color: "text.secondary" }} />
                      </ListItemButton>
                    </ListItem>
                    <Divider />
                  </>
                )}

                <ListItem disablePadding>
                  <ListItemButton onClick={() => setCurrentView("appearance")} sx={{ py: 2 }}>
                    <ListItemIcon>
                      <PaletteIcon sx={{ color: "primary.main", fontSize: 28 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="h6" fontWeight="medium">
                          Appearance
                        </Typography>
                      }
                      secondary="Theme and display options"
                    />
                    <ChevronRightIcon sx={{ color: "text.secondary" }} />
                  </ListItemButton>
                </ListItem>
                <Divider />
              </List>
            </Box>
          )}

          {currentView === "appearance" && <AppearanceSettings />}

          {currentView === "connections" && <ConnectionSettings />}
        </Box>
      </Box>
    </Drawer>
  );
};
