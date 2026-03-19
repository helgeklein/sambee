import {
  Box,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  Radio,
  Switch,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { useSambeeTheme } from "../theme";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

const PREFERENCES_COPY = {
  appearanceTitle: "Appearance",
  browserTitle: "Browser",
  quickNavigationTitle: "Quick navigation",
  includeDotDirectoriesLabel: "Include dot directories in quick nav",
  includeDotDirectoriesDescription: "Show folders like .git, .cache, and other dot-prefixed directories in quick navigation results.",
};

function ThemePreview({
  theme,
}: {
  theme: {
    primary: { main: string };
    background?: { default?: string };
    text?: { primary?: string };
    components?: { link?: { main: string } };
  };
}) {
  return (
    <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.background?.default || "#F6F1E8",
          border: "1px solid",
          borderColor: "divider",
        }}
      />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.text?.primary || "#1F262B",
          border: "1px solid",
          borderColor: "divider",
        }}
      />
      <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: theme.primary.main }} />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          bgcolor: theme.components?.link?.main || theme.primary.main,
          border: "1px solid",
          borderColor: "divider",
        }}
      />
    </Box>
  );
}

export function PreferencesSettings() {
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("preferences")}
        description={getSettingsCategoryDescription("preferences")}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup
          title={PREFERENCES_COPY.appearanceTitle}
          description="Choose the application theme and visual defaults."
          sx={{ mb: 4 }}
        >
          {isMobile ? (
            <List sx={{ py: 0 }}>
              {availableThemes.map((themeOption) => (
                <Box key={themeOption.id}>
                  <ListItem disablePadding>
                    <ListItemButton onClick={() => setThemeById(themeOption.id)} sx={{ py: 2, px: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%", gap: 2 }}>
                        <Radio checked={currentTheme.id === themeOption.id} sx={{ mt: -0.5 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h6" fontWeight="medium">
                            {themeOption.name}
                          </Typography>
                          {themeOption.description && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {themeOption.description}
                            </Typography>
                          )}
                          <ThemePreview theme={themeOption} />
                        </Box>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                  <Divider />
                </Box>
              ))}
            </List>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
                gap: 2,
              }}
            >
              {availableThemes.map((themeOption) => (
                <Box
                  key={themeOption.id}
                  onClick={() => setThemeById(themeOption.id)}
                  sx={{
                    p: 3,
                    border: currentTheme.id === themeOption.id ? 2 : 1,
                    borderColor: currentTheme.id === themeOption.id ? "primary.main" : "divider",
                    borderRadius: 1,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    "&:hover": {
                      borderColor: currentTheme.id === themeOption.id ? "primary.main" : "text.secondary",
                      bgcolor: "action.selected",
                    },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Radio checked={currentTheme.id === themeOption.id} />
                    <Typography variant="h6" sx={{ ml: 1 }}>
                      {themeOption.name}
                    </Typography>
                  </Box>
                  {themeOption.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {themeOption.description}
                    </Typography>
                  )}
                  <ThemePreview theme={themeOption} />
                </Box>
              ))}
            </Box>
          )}
        </SettingsGroup>

        <SettingsGroup title={PREFERENCES_COPY.browserTitle} description="Set defaults for how the file browser behaves.">
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            {PREFERENCES_COPY.quickNavigationTitle}
          </Typography>
          <FormControlLabel
            control={<Switch checked={includeDotDirectories} onChange={(_event, checked) => setIncludeDotDirectories(checked)} />}
            label={PREFERENCES_COPY.includeDotDirectoriesLabel}
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
            {PREFERENCES_COPY.includeDotDirectoriesDescription}
          </Typography>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
