import { Box, useMediaQuery, useTheme } from "@mui/material";
import { SettingsCategoryDescription } from "../components/Settings/SettingsCategoryDescription";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { ConnectionSettings } from "./ConnectionSettings";

interface ConnectionsSettingsProps {
  isAdmin?: boolean;
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  forceDesktopLayout?: boolean;
}

export function ConnectionsSettings({
  isAdmin,
  onConnectionsChanged,
  dialogSafeHeader = false,
  forceDesktopLayout = false,
}: ConnectionsSettingsProps) {
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("sm"));
  const isDesktop = forceDesktopLayout || isLargeScreen;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("connections")}
        description={<SettingsCategoryDescription category="connections" />}
        dialogSafe={dialogSafeHeader}
        showTitle={isDesktop}
      />

      <Box sx={{ flex: 1, minWidth: 0, overflow: isDesktop ? "hidden" : "auto" }}>
        <ConnectionSettings
          isAdmin={isAdmin}
          onConnectionsChanged={onConnectionsChanged}
          forceDesktopLayout={forceDesktopLayout}
          showHeader={false}
          showMobileFab={!isDesktop}
        />
      </Box>
    </Box>
  );
}
