//
// SettingsSidebar
//

import { Computer as ComputerIcon, Palette as PaletteIcon, Storage as StorageIcon } from "@mui/icons-material";
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { getSettingsCategoryLabel, SETTINGS_CATEGORY_META } from "./settingsNavigation";

/**
 * SettingsSidebar
 *
 * Persistent sidebar navigation for settings on desktop.
 * Shows all settings categories with active highlighting.
 */
export function SettingsSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check admin status
    api
      .getCurrentUser()
      .then((user) => setIsAdmin(user.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  // Determine active category from current route
  const activePath = location.pathname;

  const categories = [
    {
      id: "appearance",
      label: "Appearance",
      icon: <PaletteIcon />,
      path: "/settings/appearance",
      visible: true,
    },
    {
      id: "smb-connections",
      label: getSettingsCategoryLabel("smb-connections"),
      icon: <StorageIcon />,
      path: SETTINGS_CATEGORY_META["smb-connections"].route,
      visible: isAdmin,
    },
    {
      id: "local-drives",
      label: getSettingsCategoryLabel("local-drives"),
      icon: <ComputerIcon />,
      path: SETTINGS_CATEGORY_META["local-drives"].route,
      visible: true,
    },
  ];

  return (
    <Box
      sx={{
        width: 280,
        height: "100%",
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sidebar Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          Settings
        </Typography>
      </Box>

      {/* Categories List */}
      <List sx={{ flex: 1, py: 1 }}>
        {categories
          .filter((cat) => cat.visible)
          .map((category) => {
            const isActive = activePath === category.path;

            return (
              <ListItemButton
                key={category.id}
                selected={isActive}
                onClick={() => navigate(category.path)}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  "&.Mui-selected": {
                    bgcolor: "action.selected",
                    "&:hover": {
                      bgcolor: "action.selected",
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: isActive ? "primary.main" : "text.secondary" }}>{category.icon}</ListItemIcon>
                <ListItemText
                  primary={category.label}
                  primaryTypographyProps={{
                    fontWeight: isActive ? 600 : 400,
                  }}
                />
              </ListItemButton>
            );
          })}
      </List>
    </Box>
  );
}
