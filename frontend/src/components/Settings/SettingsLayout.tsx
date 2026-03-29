//
// SettingsLayout
//

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { AppBar, Box, IconButton, Toolbar, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  getMobileViewportShellSx,
  mobileSafeAreaAppBarSx,
  mobileSafeAreaToolbarSx,
  mobileScrollableContentSx,
} from "../../theme/mobileShell";
import { SettingsSidebar } from "./SettingsSidebar";
import { prefetchSettingsDataForItems } from "./settingsDataSources";
import {
  DEFAULT_SETTINGS_CATEGORY,
  getSettingsMobileBackTarget,
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
    if (location.pathname === "/settings") {
      navigate(-1);
      return;
    }

    const backTarget = getSettingsMobileBackTarget(location.pathname);
    if (backTarget) {
      navigate(backTarget);
      return;
    }

    navigate("/settings");
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
    <Box sx={getMobileViewportShellSx(true)}>
      <AppBar position="static" sx={mobileSafeAreaAppBarSx}>
        <Toolbar sx={mobileSafeAreaToolbarSx}>
          <IconButton edge="start" color="inherit" onClick={handleMobileBack} aria-label={t("common.navigation.goBack")}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
            {getPageTitle()}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={mobileScrollableContentSx}>
        <Outlet />
      </Box>
    </Box>
  );
}
