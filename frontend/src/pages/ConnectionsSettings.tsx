import { Box } from "@mui/material";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { ConnectionSettings } from "./ConnectionSettings";
import { LocalDrivesSettings } from "./LocalDrivesSettings";

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
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("connections")}
        description={getSettingsCategoryDescription("connections")}
        dialogSafe={dialogSafeHeader}
      />
      <Box sx={{ flex: 1, overflow: "auto", pb: 3 }}>
        <ConnectionSettings
          onConnectionsChanged={onConnectionsChanged}
          forceDesktopLayout={forceDesktopLayout}
          showHeader={false}
          showMobileFab={false}
          sectionTitle="SMB connections"
          sectionDescription="Browse shared connections and manage your private SMB share connections."
        />
        <LocalDrivesSettings
          onConnectionsChanged={onConnectionsChanged}
          showHeader={false}
          sectionTitle="Local drives"
          sectionDescription="Pair Sambee Companion and control local-drive access from this browser."
        />
      </Box>
    </Box>
  );
}
