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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../../types";
import type { VersionInfo } from "../../utils/version";
import { fetchVersionInfo } from "../../utils/version";

interface HamburgerMenuProps {
  open: boolean;
  onClose: () => void;
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  onNavigateToRoot: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
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
}) => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const { t } = useTranslation();

  // Fetch version info on mount
  useEffect(() => {
    void fetchVersionInfo().then((info) => {
      if (info) {
        setVersionInfo(info);
      }
    });
  }, []);

  const handleConnectionChange = (connectionId: string) => {
    onConnectionChange(connectionId);
    onClose();
  };

  const selectedConnection = connections.find((c) => c.id === selectedConnectionId);

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      sx={{
        "& .MuiDrawer-paper": {
          width: 280,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.default",
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* App Logo/Title */}
        <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
          <Typography variant="h6" component="h1" sx={{ fontWeight: 600 }}>
            Sambee
          </Typography>
        </Box>

        {/* Connection Selector */}
        {connections.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
              {t("common.labels.connection")}
            </Typography>
            <FormControl fullWidth size="small">
              <Select
                value={selectedConnectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                displayEmpty
                aria-label={t("fileBrowser.chrome.mobileMenu.selectConnectionAriaLabel")}
              >
                {connections.map((conn) => (
                  <MenuItem key={conn.id} value={conn.id}>
                    {conn.name}
                    {selectedConnection && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        ({conn.host}/{conn.share_name})
                      </Typography>
                    )}
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
            aria-label={t("fileBrowser.chrome.mobileMenu.navigateRootAriaLabel")}
          >
            <ListItemIcon>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText primary={t("common.labels.root")} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            aria-label={t("fileBrowser.chrome.mobileMenu.openSettingsAriaLabel")}
          >
            <ListItemIcon>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText primary={t("common.labels.settings")} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton onClick={onLogout} aria-label={t("fileBrowser.chrome.mobileMenu.logoutAriaLabel")}>
            <ListItemIcon>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary={t("common.actions.logout")} />
          </ListItemButton>
        </ListItem>
      </List>

      {/* Version Information */}
      {versionInfo && (
        <>
          <Box sx={{ flexGrow: 1 }} />
          <Divider />
          <Box sx={{ p: 2, pt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("settings.shell.versionLabel")}: {versionInfo.version}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("settings.shell.buildLabel")}: {versionInfo.build_time}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {t("settings.shell.commitLabel")}: {versionInfo.git_commit.substring(0, 7)}
            </Typography>
          </Box>
        </>
      )}
    </Drawer>
  );
};

export default HamburgerMenu;
