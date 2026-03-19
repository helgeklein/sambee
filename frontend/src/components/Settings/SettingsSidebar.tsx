//
// SettingsSidebar
//

import { Box, Typography } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { SettingsCategoryList } from "./SettingsCategoryList";
import { getSettingsCategoryByPath, getVisibleSettingsSections, SETTINGS_CATEGORY_META } from "./settingsNavigation";
import { useSettingsAccess } from "./useSettingsAccess";

/**
 * SettingsSidebar
 *
 * Persistent sidebar navigation for settings on desktop.
 * Shows all settings categories with active highlighting.
 */
export function SettingsSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useSettingsAccess();

  // Determine active category from current route
  const activePath = location.pathname;
  const selectedCategory = getSettingsCategoryByPath(activePath);

  const sections = getVisibleSettingsSections(isAdmin);

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
      <SettingsCategoryList
        sections={sections}
        onSelect={(category) => navigate(SETTINGS_CATEGORY_META[category].route)}
        selectedCategory={selectedCategory ?? undefined}
        listSx={{ flex: 1, py: 1 }}
        sectionSx={{ mb: 1.5 }}
        subheaderSx={{ bgcolor: "transparent", lineHeight: 2.5, textTransform: "uppercase", letterSpacing: 0.8 }}
        itemButtonSx={{
          mx: 1,
          borderRadius: 1,
          "&.Mui-selected": {
            bgcolor: "action.selected",
            "&:hover": {
              bgcolor: "action.selected",
            },
          },
        }}
        itemIconSx={(selected) => ({ minWidth: 40, color: selected ? "primary.main" : "text.secondary" })}
        primaryTypographyProps={(selected) => ({ fontWeight: selected ? 600 : 400 })}
      />
    </Box>
  );
}
