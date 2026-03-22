import {
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  MenuItem,
  Radio,
  Select,
  Switch,
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
import { useLocalePreferences } from "../i18n/LocalePreferencesProvider";
import { patchCurrentUserSettings } from "../services/userSettingsSync";
import { useSambeeTheme } from "../theme";
import type { LanguagePreference } from "../types";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../utils/localeFormatting";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

const LANGUAGE_OPTIONS = ["en", "en-XA"] as const;
const REGIONAL_LOCALE_OPTIONS = ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"] as const;
const REGIONAL_LOCALE_LABEL_KEYS = {
  "en-US": "settings.preferencesPage.regionalLocaleOptions.enUS",
  "en-GB": "settings.preferencesPage.regionalLocaleOptions.enGB",
  "de-DE": "settings.preferencesPage.regionalLocaleOptions.deDE",
  "fr-FR": "settings.preferencesPage.regionalLocaleOptions.frFR",
  "ja-JP": "settings.preferencesPage.regionalLocaleOptions.jaJP",
} as const satisfies Record<(typeof REGIONAL_LOCALE_OPTIONS)[number], string>;
const PREVIEW_DATE = new Date("2026-03-22T14:35:00Z");

function getBrowserLanguageLabel(t: ReturnType<typeof useTranslation>["t"]): string {
  if (typeof navigator === "undefined") {
    return t("settings.preferencesPage.browserDefaultOption");
  }

  const locales = Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  const browserLocale = locales.find(Boolean);

  const resolvedLanguage =
    locales
      .filter((locale): locale is string => Boolean(locale))
      .map((locale) => {
        const exactMatch = LANGUAGE_OPTIONS.find((supportedLanguage) => supportedLanguage.toLowerCase() === locale.toLowerCase());
        if (exactMatch) {
          return exactMatch;
        }

        const baseLanguage = locale.split("-")[0]?.toLowerCase();
        return LANGUAGE_OPTIONS.find((supportedLanguage) => supportedLanguage.toLowerCase() === baseLanguage) ?? null;
      })
      .find((language): language is (typeof LANGUAGE_OPTIONS)[number] => Boolean(language)) ?? "en";

  const resolvedLanguageLabel =
    resolvedLanguage === "en-XA" ? t("settings.preferencesPage.pseudoLanguageOption") : t("settings.preferencesPage.englishLanguageOption");

  return browserLocale
    ? `${t("settings.preferencesPage.browserDefaultOption")} (${browserLocale} -> ${resolvedLanguageLabel})`
    : t("settings.preferencesPage.browserDefaultOption");
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

export function PreferencesSettings() {
  const { currentTheme, availableThemes, setThemeById } = useSambeeTheme();
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const { languagePreference, regionalLocalePreference, setLanguagePreference, setRegionalLocalePreference } = useLocalePreferences();

  const languageOptions = useMemo(
    () => [
      { value: "browser", label: getBrowserLanguageLabel(t) },
      { value: "en", label: t("settings.preferencesPage.englishLanguageOption") },
      { value: "en-XA", label: t("settings.preferencesPage.pseudoLanguageOption") },
    ],
    [t]
  );

  const regionalLocaleOptions = useMemo(() => {
    const browserLocale = typeof navigator === "undefined" ? null : navigator.language || null;
    const options = [
      {
        value: "browser",
        label: browserLocale
          ? `${t("settings.preferencesPage.browserDefaultOption")} (${browserLocale})`
          : t("settings.preferencesPage.browserDefaultOption"),
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
        title={getSettingsCategoryLabel("preferences")}
        description={getSettingsCategoryDescription("preferences")}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup
          title={t("settings.preferencesPage.appearanceTitle")}
          description={t("settings.preferencesPage.appearanceDescription")}
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
          title={t("settings.preferencesPage.localizationTitle")}
          description={t("settings.preferencesPage.localizationDescription")}
          sx={{ mb: 4 }}
        >
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
            <FormControl fullWidth>
              <InputLabel id="preferences-language-label">{t("settings.preferencesPage.languageLabel")}</InputLabel>
              <Select
                labelId="preferences-language-label"
                value={languagePreference}
                label={t("settings.preferencesPage.languageLabel")}
                onChange={handleLanguageChange}
              >
                {languageOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("settings.preferencesPage.languageDescription")}
              </Typography>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="preferences-regional-locale-label">{t("settings.preferencesPage.regionalLocaleLabel")}</InputLabel>
              <Select
                labelId="preferences-regional-locale-label"
                value={regionalLocalePreference}
                label={t("settings.preferencesPage.regionalLocaleLabel")}
                onChange={handleRegionalLocaleChange}
              >
                {regionalLocaleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("settings.preferencesPage.regionalLocaleDescription")}
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
              bgcolor: "action.selected",
            }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
              {t("settings.preferencesPage.regionalSettingsPreviewTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("settings.preferencesPage.regionalSettingsPreviewDateLabel")}:{" "}
              {formatLocalizedDateTime(PREVIEW_DATE, {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {t("settings.preferencesPage.regionalSettingsPreviewNumberLabel")}:{" "}
              {formatLocalizedNumber(1234567.89, {
                maximumFractionDigits: 2,
              })}
            </Typography>
          </Box>
        </SettingsGroup>

        <SettingsGroup title={t("settings.preferencesPage.browserTitle")} description={t("settings.preferencesPage.browserDescription")}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            {t("settings.preferencesPage.quickNavigationTitle")}
          </Typography>
          <FormControlLabel
            control={<Switch checked={includeDotDirectories} onChange={(_event, checked) => setIncludeDotDirectories(checked)} />}
            label={t("settings.preferencesPage.includeDotDirectoriesLabel")}
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
            {t("settings.preferencesPage.includeDotDirectoriesDescription")}
          </Typography>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
