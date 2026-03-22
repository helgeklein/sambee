import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

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
          sectionTitle={t("settings.connectionsPage.smbSectionTitle")}
          sectionDescription={t("settings.connectionsPage.smbSectionDescription")}
        />
        <LocalDrivesSettings
          onConnectionsChanged={onConnectionsChanged}
          showHeader={false}
          sectionTitle={t("settings.connectionsPage.localDrivesSectionTitle")}
          sectionDescription={t("settings.connectionsPage.localDrivesSectionDescription")}
        />
      </Box>
    </Box>
  );
}
