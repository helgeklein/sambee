import { Box, FormControlLabel, Switch, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
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
            control={<Switch checked={includeDotDirectories} onChange={(_event, checked) => setIncludeDotDirectories(checked)} />}
            label={t("settings.fileBrowserPage.includeDotDirectoriesLabel")}
            sx={{ alignItems: "flex-start", m: 0 }}
            slotProps={{
              typography: {
                sx: {
                  fontWeight: 500,
                  mt: 0.25,
                },
              },
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>
            {t("settings.fileBrowserPage.includeDotDirectoriesDescription")}
          </Typography>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
