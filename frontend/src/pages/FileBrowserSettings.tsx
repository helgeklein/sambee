import { Box, Checkbox, FormControlLabel, useMediaQuery, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

export function FileBrowserSettings() {
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("file-browser")}
        description={getSettingsCategoryDescription("file-browser")}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup
          title={t("settings.fileBrowserPage.quickNavigationTitle")}
          description={t("settings.fileBrowserPage.quickNavigationDescription")}
        >
          <FormControlLabel
            control={<Checkbox checked={includeDotDirectories} onChange={(event) => setIncludeDotDirectories(event.target.checked)} />}
            label={t("settings.fileBrowserPage.includeDotDirectoriesLabel")}
            sx={{ m: 0 }}
          />
          <SettingsFieldHelp sx={{ maxWidth: 640 }}>{t("settings.fileBrowserPage.includeDotDirectoriesDescription")}</SettingsFieldHelp>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
