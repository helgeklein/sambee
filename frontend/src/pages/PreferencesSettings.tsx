import {
  Box,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  MenuItem,
  Radio,
  Select,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { getAvailableLanguages } from "../i18n";
import { useLocalePreferences } from "../i18n/LocalePreferencesProvider";
import { PSEUDO_LANGUAGE } from "../i18n/resources";
import { patchCurrentUserSettings } from "../services/userSettingsSync";
import { useSambeeTheme } from "../theme";
import type { LanguagePreference } from "../types";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../utils/localeFormatting";

const REGIONAL_LOCALE_OPTIONS = ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"] as const;
const REGIONAL_LOCALE_LABEL_KEYS = {
  "en-US": "settings.appearancePage.regionalLocaleOptions.enUS",
  "en-GB": "settings.appearancePage.regionalLocaleOptions.enGB",
  "de-DE": "settings.appearancePage.regionalLocaleOptions.deDE",
  "fr-FR": "settings.appearancePage.regionalLocaleOptions.frFR",
  "ja-JP": "settings.appearancePage.regionalLocaleOptions.jaJP",
} as const satisfies Record<(typeof REGIONAL_LOCALE_OPTIONS)[number], string>;
const PREVIEW_DATE = new Date("2026-03-22T14:35:00Z");

function getLanguageOptionLabel(t: ReturnType<typeof useTranslation>["t"], language: string): string {
  return language === PSEUDO_LANGUAGE
    ? t("settings.appearancePage.pseudoLanguageOption")
    : t("settings.appearancePage.englishLanguageOption");
}

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

export function AppearanceSettings() {
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const { languagePreference, regionalLocalePreference, setLanguagePreference, setRegionalLocalePreference } = useLocalePreferences();
  const availableLanguages = getAvailableLanguages();

  const languageOptions = useMemo(
    () => [
      { value: "browser", label: t("settings.appearancePage.browserDefaultOption") },
      ...availableLanguages.map((language) => ({
        value: language,
        label: getLanguageOptionLabel(t, language),
      })),
    ],
    [availableLanguages, t]
  );

  const regionalLocaleOptions = useMemo(() => {
    const options = [
      {
        value: "browser",
        label: t("settings.appearancePage.browserDefaultOption"),
      },
      ...REGIONAL_LOCALE_OPTIONS.map((locale) => ({
        value: locale,
        label: t(REGIONAL_LOCALE_LABEL_KEYS[locale]),
      })),
    ];

    if (regionalLocalePreference !== "browser" && !options.some((option) => option.value === regionalLocalePreference)) {
      options.push({ value: regionalLocalePreference, label: regionalLocalePreference });
    }

    return options;
  }, [regionalLocalePreference, t]);

  const handleLanguageChange = (event: SelectChangeEvent<string>) => {
    const nextLanguagePreference = event.target.value as LanguagePreference;
    void setLanguagePreference(nextLanguagePreference);
    void patchCurrentUserSettings({
      localization: {
        language: nextLanguagePreference,
      },
    });
  };

  const handleRegionalLocaleChange = (event: SelectChangeEvent<string>) => {
    const nextRegionalLocalePreference = event.target.value;
    void setRegionalLocalePreference(nextRegionalLocalePreference);
    void patchCurrentUserSettings({
      localization: {
        regional_locale: nextRegionalLocalePreference,
      },
    });
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("appearance")}
        description={getSettingsCategoryDescription("appearance")}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup
          title={t("settings.appearancePage.themeTitle")}
          description={t("settings.appearancePage.themeDescription")}
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

        <SettingsGroup
          title={t("settings.appearancePage.localizationTitle")}
          description={t("settings.appearancePage.localizationDescription")}
          sx={{ mb: 4 }}
        >
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
            <FormControl fullWidth>
              <InputLabel id="appearance-language-label">{t("settings.appearancePage.languageLabel")}</InputLabel>
              <Select
                labelId="appearance-language-label"
                value={languagePreference}
                label={t("settings.appearancePage.languageLabel")}
                onChange={handleLanguageChange}
              >
                {languageOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("settings.appearancePage.languageDescription")}
              </Typography>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="appearance-regional-locale-label">{t("settings.appearancePage.regionalLocaleLabel")}</InputLabel>
              <Select
                labelId="appearance-regional-locale-label"
                value={regionalLocalePreference}
                label={t("settings.appearancePage.regionalLocaleLabel")}
                onChange={handleRegionalLocaleChange}
              >
                {regionalLocaleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("settings.appearancePage.regionalLocaleDescription")}
              </Typography>
            </FormControl>
          </Box>

          <Box
            sx={{
              mt: 2.5,
              p: 2,
              borderRadius: 1,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
              {t("settings.appearancePage.regionalSettingsPreviewTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatLocalizedDateTime(PREVIEW_DATE, {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {formatLocalizedNumber(1234567.89, {
                maximumFractionDigits: 2,
              })}
            </Typography>
          </Box>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
