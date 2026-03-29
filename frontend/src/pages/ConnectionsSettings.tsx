import { Box, useMediaQuery, useTheme } from "@mui/material";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { ConnectionSettings } from "./ConnectionSettings";

interface ConnectionsSettingsProps {
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  forceDesktopLayout?: boolean;
}

export function ConnectionsSettings({
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
        description={getSettingsCategoryDescription("connections")}
        dialogSafe={dialogSafeHeader}
        showTitle={isDesktop}
      />

      <Box sx={{ flex: 1, minWidth: 0, overflow: isDesktop ? "hidden" : "auto" }}>
        <ConnectionSettings
          onConnectionsChanged={onConnectionsChanged}
          forceDesktopLayout={forceDesktopLayout}
          showHeader={false}
          showMobileFab={!isDesktop}
        />
      </Box>
    </Box>
  );
}
