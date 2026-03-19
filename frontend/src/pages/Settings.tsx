//
// Settings
//

import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { SettingsCategoryList } from "../components/Settings/SettingsCategoryList";
import { getVisibleSettingsSections, SETTINGS_ROUTE_BY_CATEGORY } from "../components/Settings/settingsNavigation";
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
        onSelect={(category) => navigate(SETTINGS_ROUTE_BY_CATEGORY[category])}
        showChevron
        showDividers
        wrapItemsInListItem
        listSx={{ py: 0 }}
        subheaderSx={{ bgcolor: "background.default", textTransform: "uppercase", letterSpacing: 0.8 }}
        itemButtonSx={{ py: 2 }}
        itemIconSx={{ color: "primary.main" }}
        iconGlyphSx={{ fontSize: 28 }}
        primaryTypographyProps={{ variant: "h6", fontWeight: "medium" }}
      />
    </Box>
  );
}
