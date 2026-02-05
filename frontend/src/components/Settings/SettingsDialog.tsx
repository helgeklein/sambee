//
// SettingsDialog
//

import { Palette as PaletteIcon, Storage as StorageIcon } from "@mui/icons-material";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Dialog, Divider, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppearanceSettings } from "../../pages/AppearanceSettings";
import { ConnectionSettings } from "../../pages/ConnectionSettings";
import api from "../../services/api";
import type { VersionInfo } from "../../utils/version";
import { fetchVersionInfo } from "../../utils/version";

export type SettingsCategory = "appearance" | "connections";

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
 * Contains sidebar navigation and content area showing Appearance or Connections settings.
 */
const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, initialCategory = "appearance", onConnectionsChanged }) => {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory);
  const [isAdmin, setIsAdmin] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  // Refs for category list items (for arrow key navigation and initial focus)
  const appearanceRef = useRef<HTMLDivElement>(null);
  const connectionsRef = useRef<HTMLDivElement>(null);

  // Build list of available categories based on admin status
  const availableCategories = useMemo(() => {
    const categories: SettingsCategory[] = ["appearance"];
    if (isAdmin) {
      categories.push("connections");
    }
    return categories;
  }, [isAdmin]);

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
          // Focus the new category button
          if (newCategory === "appearance") {
            appearanceRef.current?.focus();
          } else if (newCategory === "connections") {
            connectionsRef.current?.focus();
          }
        }
      }
    },
    [availableCategories, selectedCategory]
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
      setSelectedCategory(initialCategory);
    }
  }, [open, initialCategory]);

  // Focus the initial category button when dialog opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure the dialog is fully rendered
      const timeoutId = setTimeout(() => {
        if (initialCategory === "appearance") {
          appearanceRef.current?.focus();
        } else if (initialCategory === "connections") {
          connectionsRef.current?.focus();
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [open, initialCategory]);

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
            {isAdmin && (
              <ListItem disablePadding>
                <ListItemButton
                  ref={connectionsRef}
                  onClick={() => setSelectedCategory("connections")}
                  onKeyDown={handleCategoryKeyDown}
                  selected={selectedCategory === "connections"}
                  tabIndex={selectedCategory === "connections" ? 0 : -1}
                  role="option"
                  aria-selected={selectedCategory === "connections"}
                  sx={{ py: 1.5, px: 2 }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 40,
                      color: selectedCategory === "connections" ? "primary.main" : "text.secondary",
                    }}
                  >
                    <StorageIcon sx={{ fontSize: 28 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary="Connections"
                    primaryTypographyProps={{
                      variant: "h6",
                      fontWeight: selectedCategory === "connections" ? "medium" : "normal",
                    }}
                  />
                </ListItemButton>
              </ListItem>
            )}
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
          {selectedCategory === "connections" && isAdmin && (
            <ConnectionSettings onConnectionsChanged={onConnectionsChanged} forceDesktopLayout />
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default SettingsDialog;
