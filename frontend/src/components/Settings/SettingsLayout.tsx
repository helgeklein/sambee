//
// SettingsLayout
//

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { AppBar, Box, IconButton, Toolbar, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SettingsSidebar } from "./SettingsSidebar";
import { prefetchSettingsDataForItems } from "./settingsDataSources";
import {
  DEFAULT_SETTINGS_CATEGORY,
  getSettingsNavItemByPath,
  getSettingsViewTitle,
  getVisibleSettingsNavItems,
  SETTINGS_ROUTE_BY_CATEGORY,
} from "./settingsNavigation";
import { useSettingsAccess } from "./useSettingsAccess";

/**
 * SettingsLayout
 *
 * Responsive layout wrapper for settings pages.
 * Desktop: Shows persistent sidebar with content area on right.
 * Mobile: Shows full-page routes with AppBar.
 */
export function SettingsLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("sm"));
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useSettingsAccess();
  const { t } = useTranslation();

  // On desktop, redirect from /settings to the topmost settings page.
  useEffect(() => {
    if (isDesktop && location.pathname === "/settings") {
      navigate(SETTINGS_ROUTE_BY_CATEGORY[DEFAULT_SETTINGS_CATEGORY], { replace: true });
    }
  }, [isDesktop, location.pathname, navigate]);

  useEffect(() => {
    prefetchSettingsDataForItems(getVisibleSettingsNavItems(isAdmin));
  }, [isAdmin]);

  // Get page title from current route
  const getPageTitle = () => {
    const item = getSettingsNavItemByPath(location.pathname);
    if (item) {
      return getSettingsViewTitle(item);
    }
    return getSettingsViewTitle("main");
  };

  const handleMobileBack = () => {
    navigate(-1);
  };

  if (isDesktop) {
    // Desktop: Sidebar + Content Area
    return (
      <Box sx={{ display: "flex", height: "100vh" }}>
        <SettingsSidebar />
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Outlet />
        </Box>
      </Box>
    );
  }

  // Mobile: Full-page with AppBar (edge-to-edge layout)
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static">
        <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
          <IconButton edge="start" color="inherit" onClick={handleMobileBack} aria-label={t("common.navigation.goBack")}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
            {getPageTitle()}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Outlet />
      </Box>
    </Box>
  );
}
