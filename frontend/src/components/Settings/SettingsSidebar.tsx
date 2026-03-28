//
// SettingsSidebar
//

import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { SettingsCategoryList } from "./SettingsCategoryList";
import { getSettingsNavItemByPath, getVisibleSettingsSections, SETTINGS_ROUTE_BY_NAV_ITEM } from "./settingsNavigation";
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
  const { t } = useTranslation();

  // Determine active category from current route
  const activePath = location.pathname;
  const selectedItem = getSettingsNavItemByPath(activePath);

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
          {t("settings.shell.title")}
        </Typography>
      </Box>

      {/* Categories List */}
      <SettingsCategoryList
        sections={sections}
        onSelect={(item) => navigate(SETTINGS_ROUTE_BY_NAV_ITEM[item])}
        selectedItem={selectedItem ?? undefined}
        listSx={{ flex: 1, py: 1 }}
        sectionSx={{ mb: 1.5 }}
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
        itemIconSx={(selected: boolean) => ({ minWidth: 40, color: selected ? "primary.main" : "text.secondary" })}
        primaryTypographyProps={(selected: boolean) => ({ fontWeight: selected ? 600 : 400 })}
      />
    </Box>
  );
}
