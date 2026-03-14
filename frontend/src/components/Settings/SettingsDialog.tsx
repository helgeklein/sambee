//
// SettingsDialog
//

import {
  Computer as ComputerIcon,
  ManageSearch as ManageSearchIcon,
  Palette as PaletteIcon,
  Storage as StorageIcon,
} from "@mui/icons-material";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Dialog, Divider, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppearanceSettings } from "../../pages/AppearanceSettings";
import { BrowserSettings } from "../../pages/BrowserSettings";
import { ConnectionSettings } from "../../pages/ConnectionSettings";
import { LocalDrivesSettings } from "../../pages/LocalDrivesSettings";
import api from "../../services/api";
import type { VersionInfo } from "../../utils/version";
import { fetchVersionInfo } from "../../utils/version";
import { getSettingsCategoryLabel, type SettingsCategory } from "./settingsNavigation";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Initial category to show when dialog opens */
  initialCategory?: SettingsCategory;
  /** Callback when connections are added, updated, or deleted */
  onConnectionsChanged?: () => void;
}

/**
 * SettingsDialog
 *
 * Modal dialog for settings on desktop.
 * Contains sidebar navigation and content area showing Appearance,
 * Browser, SMB Connections, or Local Drives settings.
 */
const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, initialCategory = "appearance", onConnectionsChanged }) => {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory);
  const [isAdmin, setIsAdmin] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  // Refs for category list items (for arrow key navigation and initial focus)
  const appearanceRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const smbConnectionsRef = useRef<HTMLDivElement>(null);
  const localDrivesRef = useRef<HTMLDivElement>(null);

  // Build list of available categories based on admin status
  const availableCategories = useMemo(() => {
    const categories: SettingsCategory[] = ["appearance", "browser"];
    if (isAdmin) {
      categories.push("smb-connections");
    }
    categories.push("local-drives");
    return categories;
  }, [isAdmin]);

  const focusCategoryButton = useCallback((category: SettingsCategory) => {
    if (category === "appearance") {
      appearanceRef.current?.focus();
      return;
    }

    if (category === "browser") {
      browserRef.current?.focus();
      return;
    }

    if (category === "smb-connections") {
      smbConnectionsRef.current?.focus();
      return;
    }

    localDrivesRef.current?.focus();
  }, []);

  //
  // handleCategoryKeyDown
  //
  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        return;
      }

      e.preventDefault();
      const currentIndex = availableCategories.indexOf(selectedCategory);
      let newIndex = currentIndex;

      if (e.key === "ArrowDown") {
        newIndex = Math.min(currentIndex + 1, availableCategories.length - 1);
      } else if (e.key === "ArrowUp") {
        newIndex = Math.max(currentIndex - 1, 0);
      }

      if (newIndex !== currentIndex) {
        const newCategory = availableCategories[newIndex];
        if (newCategory) {
          setSelectedCategory(newCategory);
          focusCategoryButton(newCategory);
        }
      }
    },
    [availableCategories, focusCategoryButton, selectedCategory]
  );

  useEffect(() => {
    // Check admin status when dialog opens
    if (open) {
      api
        .getCurrentUser()
        .then((user) => setIsAdmin(user.is_admin))
        .catch(() => setIsAdmin(false));

      // Fetch version info
      void fetchVersionInfo().then((info) => {
        if (info) {
          setVersionInfo(info);
        }
      });
    }
  }, [open]);

  // Set category when dialog opens (use initialCategory prop)
  useEffect(() => {
    if (open) {
      setSelectedCategory(availableCategories.includes(initialCategory) ? initialCategory : (availableCategories[0] ?? "appearance"));
    }
  }, [availableCategories, initialCategory, open]);

  // Focus the initial category button when dialog opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure the dialog is fully rendered
      const timeoutId = setTimeout(() => {
        focusCategoryButton(availableCategories.includes(initialCategory) ? initialCategory : (availableCategories[0] ?? "appearance"));
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [availableCategories, focusCategoryButton, initialCategory, open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: "80vh", bgcolor: "background.default" } }}>
      {/* Close button in upper-right corner */}
      <IconButton
        onClick={onClose}
        size="small"
        aria-label="Close settings"
        sx={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 1,
        }}
      >
        <CloseIcon />
      </IconButton>

      <Box sx={{ display: "flex", height: "100%" }}>
        {/* Left Sidebar */}
        <Box
          sx={{
            width: 280,
            borderRight: 1,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.default",
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Settings
            </Typography>
          </Box>
          <Divider sx={{ mb: 2 }} />
          <List sx={{ flex: 1, py: 0 }} role="listbox" aria-label="Settings categories">
            <ListItem disablePadding>
              <ListItemButton
                ref={appearanceRef}
                onClick={() => setSelectedCategory("appearance")}
                onKeyDown={handleCategoryKeyDown}
                selected={selectedCategory === "appearance"}
                tabIndex={selectedCategory === "appearance" ? 0 : -1}
                role="option"
                aria-selected={selectedCategory === "appearance"}
                sx={{ py: 1.5, px: 2 }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: selectedCategory === "appearance" ? "primary.main" : "text.secondary",
                  }}
                >
                  <PaletteIcon sx={{ fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary="Appearance"
                  primaryTypographyProps={{
                    variant: "h6",
                    fontWeight: selectedCategory === "appearance" ? "medium" : "normal",
                  }}
                />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                ref={browserRef}
                onClick={() => setSelectedCategory("browser")}
                onKeyDown={handleCategoryKeyDown}
                selected={selectedCategory === "browser"}
                tabIndex={selectedCategory === "browser" ? 0 : -1}
                role="option"
                aria-selected={selectedCategory === "browser"}
                sx={{ py: 1.5, px: 2 }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: selectedCategory === "browser" ? "primary.main" : "text.secondary",
                  }}
                >
                  <ManageSearchIcon sx={{ fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={getSettingsCategoryLabel("browser")}
                  primaryTypographyProps={{
                    variant: "h6",
                    fontWeight: selectedCategory === "browser" ? "medium" : "normal",
                  }}
                />
              </ListItemButton>
            </ListItem>
            {isAdmin && (
              <ListItem disablePadding>
                <ListItemButton
                  ref={smbConnectionsRef}
                  onClick={() => setSelectedCategory("smb-connections")}
                  onKeyDown={handleCategoryKeyDown}
                  selected={selectedCategory === "smb-connections"}
                  tabIndex={selectedCategory === "smb-connections" ? 0 : -1}
                  role="option"
                  aria-selected={selectedCategory === "smb-connections"}
                  sx={{ py: 1.5, px: 2 }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 40,
                      color: selectedCategory === "smb-connections" ? "primary.main" : "text.secondary",
                    }}
                  >
                    <StorageIcon sx={{ fontSize: 28 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={getSettingsCategoryLabel("smb-connections")}
                    primaryTypographyProps={{
                      variant: "h6",
                      fontWeight: selectedCategory === "smb-connections" ? "medium" : "normal",
                    }}
                  />
                </ListItemButton>
              </ListItem>
            )}
            <ListItem disablePadding>
              <ListItemButton
                ref={localDrivesRef}
                onClick={() => setSelectedCategory("local-drives")}
                onKeyDown={handleCategoryKeyDown}
                selected={selectedCategory === "local-drives"}
                tabIndex={selectedCategory === "local-drives" ? 0 : -1}
                role="option"
                aria-selected={selectedCategory === "local-drives"}
                sx={{ py: 1.5, px: 2 }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: selectedCategory === "local-drives" ? "primary.main" : "text.secondary",
                  }}
                >
                  <ComputerIcon sx={{ fontSize: 28 }} />
                </ListItemIcon>
                <ListItemText
                  primary={getSettingsCategoryLabel("local-drives")}
                  primaryTypographyProps={{
                    variant: "h6",
                    fontWeight: selectedCategory === "local-drives" ? "medium" : "normal",
                  }}
                />
              </ListItemButton>
            </ListItem>
          </List>

          {/* Version Information */}
          {versionInfo && (
            <>
              <Divider />
              <Box sx={{ p: 2, pt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Version: {versionInfo.version}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Build: {versionInfo.build_time}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  Commit: {versionInfo.git_commit.substring(0, 7)}
                </Typography>
              </Box>
            </>
          )}
        </Box>

        {/* Right Content Area */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: "background.default",
          }}
        >
          {selectedCategory === "appearance" && <AppearanceSettings />}
          {selectedCategory === "browser" && <BrowserSettings />}
          {selectedCategory === "smb-connections" && isAdmin && (
            <ConnectionSettings onConnectionsChanged={onConnectionsChanged} forceDesktopLayout />
          )}
          {selectedCategory === "local-drives" && <LocalDrivesSettings onConnectionsChanged={onConnectionsChanged} />}
        </Box>
      </Box>
    </Dialog>
  );
};

export default SettingsDialog;
