//
// MobileSettingsDrawer
//

import {
  ChevronRight as ChevronRightIcon,
  Computer as ComputerIcon,
  ManageSearch as ManageSearchIcon,
  Palette as PaletteIcon,
  Storage as StorageIcon,
} from "@mui/icons-material";
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
import { BrowserSettings } from "../../pages/BrowserSettings";
import { ConnectionSettings } from "../../pages/ConnectionSettings";
import { LocalDrivesSettings } from "../../pages/LocalDrivesSettings";
import api from "../../services/api";
import { getSettingsCategoryDescription, getSettingsCategoryLabel, type MobileSettingsView } from "../Settings/settingsNavigation";

interface MobileSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Callback when connections are added, updated, or deleted */
  onConnectionsChanged?: () => void;
  /** Initial view to show when drawer opens */
  initialView?: MobileSettingsView;
}

/**
 * MobileSettingsDrawer
 *
 * Full-screen drawer for mobile settings.
 * Preserves underlying page state by using drawer instead of routing.
 */
export const MobileSettingsDrawer: React.FC<MobileSettingsDrawerProps> = ({
  open,
  onClose,
  onConnectionsChanged,
  initialView = "main",
}) => {
  const [currentView, setCurrentView] = useState<MobileSettingsView>(initialView);
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

  // Set view to initialView when drawer opens, reset when closes
  useEffect(() => {
    if (open) {
      setCurrentView(initialView);
    }
  }, [open, initialView]);

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
      case "browser":
        return getSettingsCategoryLabel("browser");
      case "smb-connections":
        return getSettingsCategoryLabel("smb-connections");
      case "local-drives":
        return getSettingsCategoryLabel("local-drives");
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
                <ListItem disablePadding>
                  <ListItemButton onClick={() => setCurrentView("browser")} sx={{ py: 2 }}>
                    <ListItemIcon>
                      <ManageSearchIcon sx={{ color: "primary.main", fontSize: 28 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="h6" fontWeight="medium">
                          {getSettingsCategoryLabel("browser")}
                        </Typography>
                      }
                      secondary={getSettingsCategoryDescription("browser")}
                    />
                    <ChevronRightIcon sx={{ color: "text.secondary" }} />
                  </ListItemButton>
                </ListItem>
                <Divider />

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

                {isAdmin && (
                  <>
                    <ListItem disablePadding>
                      <ListItemButton onClick={() => setCurrentView("smb-connections")} sx={{ py: 2 }}>
                        <ListItemIcon>
                          <StorageIcon sx={{ color: "primary.main", fontSize: 28 }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography variant="h6" fontWeight="medium">
                              {getSettingsCategoryLabel("smb-connections")}
                            </Typography>
                          }
                          secondary={getSettingsCategoryDescription("smb-connections")}
                        />
                        <ChevronRightIcon sx={{ color: "text.secondary" }} />
                      </ListItemButton>
                    </ListItem>
                    <Divider />
                  </>
                )}

                <ListItem disablePadding>
                  <ListItemButton onClick={() => setCurrentView("local-drives")} sx={{ py: 2 }}>
                    <ListItemIcon>
                      <ComputerIcon sx={{ color: "primary.main", fontSize: 28 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="h6" fontWeight="medium">
                          {getSettingsCategoryLabel("local-drives")}
                        </Typography>
                      }
                      secondary={getSettingsCategoryDescription("local-drives")}
                    />
                    <ChevronRightIcon sx={{ color: "text.secondary" }} />
                  </ListItemButton>
                </ListItem>
                <Divider />
              </List>
            </Box>
          )}

          {currentView === "appearance" && <AppearanceSettings />}

          {currentView === "browser" && <BrowserSettings />}

          {currentView === "smb-connections" && <ConnectionSettings onConnectionsChanged={onConnectionsChanged} />}

          {currentView === "local-drives" && <LocalDrivesSettings onConnectionsChanged={onConnectionsChanged} />}
        </Box>
      </Box>
    </Drawer>
  );
};
