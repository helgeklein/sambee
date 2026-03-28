//
// MobileSettingsDrawer
//

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { AppBar, Box, Drawer, IconButton, Toolbar, Typography } from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCategoryContent } from "../Settings/SettingsCategoryContent";
import { SettingsCategoryList } from "../Settings/SettingsCategoryList";
import { prefetchSettingsDataForItems } from "../Settings/settingsDataSources";
import { getSettingsViewTitle, getVisibleSettingsSections, type MobileSettingsView } from "../Settings/settingsNavigation";
import { useSettingsAccess } from "../Settings/useSettingsAccess";

interface MobileSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Callback when connections are added, updated, or deleted */
  onConnectionsChanged?: () => void;
  /** Initial view to show when drawer opens */
  initialView?: MobileSettingsView;
}

/**
 * MobileSettingsDrawer
 *
 * Full-screen drawer for mobile settings.
 * Preserves underlying page state by using drawer instead of routing.
 */
export const MobileSettingsDrawer: React.FC<MobileSettingsDrawerProps> = ({
  open,
  onClose,
  onConnectionsChanged,
  initialView = "main",
}) => {
  const [currentView, setCurrentView] = useState<MobileSettingsView>(initialView);
  const { isAdmin } = useSettingsAccess(open);
  const { t } = useTranslation();

  // Set view to initialView when drawer opens, reset when closes
  useEffect(() => {
    if (open) {
      setCurrentView(initialView);
      prefetchSettingsDataForItems(getVisibleSettingsSections(isAdmin).flatMap((section) => section.categories));
    }
  }, [initialView, isAdmin, open]);

  const handleBack = () => {
    if (currentView === "main") {
      onClose();
    } else {
      setCurrentView("main");
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: "100%",
          height: "100%",
        },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* AppBar */}
        <AppBar position="static">
          <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
            <IconButton edge="start" color="inherit" onClick={handleBack} aria-label={t("common.navigation.goBack")}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" component="h1" sx={{ ml: 2 }}>
              {getSettingsViewTitle(currentView)}
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {currentView === "main" && (
            <Box sx={{ height: "100%", bgcolor: "background.default" }}>
              <SettingsCategoryList
                sections={getVisibleSettingsSections(isAdmin)}
                onSelect={setCurrentView}
                showDividers
                wrapItemsInListItem
                listSx={{ py: 0 }}
                subheaderSx={{ bgcolor: "background.default", textTransform: "uppercase", letterSpacing: 0.8 }}
                itemButtonSx={{ py: 2 }}
                itemIconSx={{ color: "primary.main" }}
                primaryTypographyProps={{ fontWeight: "medium" }}
              />
            </Box>
          )}

          {currentView !== "main" && (
            <SettingsCategoryContent item={currentView} isAdmin={isAdmin} onConnectionsChanged={onConnectionsChanged} />
          )}
        </Box>
      </Box>
    </Drawer>
  );
};
