//
// Settings
//

import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { SettingsCategoryList } from "../components/Settings/SettingsCategoryList";
import { getVisibleSettingsSections, SETTINGS_ROUTE_BY_NAV_ITEM } from "../components/Settings/settingsNavigation";
import { useSettingsAccess } from "../components/Settings/useSettingsAccess";

/**
 * Settings
 *
 * Settings landing page (mobile only - desktop shows sidebar).
 * On mobile, shows category cards to navigate to sub-pages.
 */
export function Settings() {
  const navigate = useNavigate();
  const { isAdmin } = useSettingsAccess();

  return (
    <Box sx={{ height: "100%", bgcolor: "background.default" }}>
      <SettingsCategoryList
        sections={getVisibleSettingsSections(isAdmin)}
        onSelect={(item) => navigate(SETTINGS_ROUTE_BY_NAV_ITEM[item])}
        showDividers
        wrapItemsInListItem
        listSx={{ py: 0 }}
        subheaderSx={{ bgcolor: "background.default", textTransform: "uppercase", letterSpacing: 0.8 }}
        itemButtonSx={{ py: 2 }}
        itemIconSx={{ color: "primary.main" }}
        primaryTypographyProps={{ fontWeight: "medium" }}
      />
    </Box>
  );
}
