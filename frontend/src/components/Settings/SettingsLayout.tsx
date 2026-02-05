//
// SettingsLayout
//

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { AppBar, Box, IconButton, Toolbar, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SettingsSidebar } from "./SettingsSidebar";

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

  // On desktop, redirect from /settings to /settings/appearance (default page)
  useEffect(() => {
    if (isDesktop && location.pathname === "/settings") {
      navigate("/settings/appearance", { replace: true });
    }
  }, [isDesktop, location.pathname, navigate]);

  // Get page title from current route
  const getPageTitle = () => {
    if (location.pathname === "/settings/appearance") return "Appearance";
    if (location.pathname === "/settings/connections") return "Connections";
    return "Settings";
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
          <IconButton edge="start" color="inherit" onClick={() => navigate(-1)} aria-label="Go back">
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
