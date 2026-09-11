import {
  Box,
  Divider,
  FormControl,
  InputLabel,
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
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formSelectMenuProps, formSelectSx } from "../components/Form/FormLayout";
import { SettingSaveStatus } from "../components/Settings/SettingSaveStatus";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsList } from "../components/Settings/SettingsList";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { getSettingsPageSurfaceColor } from "../components/Settings/settingsSurface";
import { useRestoreFocusAfterPending } from "../hooks/useRestoreFocusAfterPending";
import { getAvailableLanguages } from "../i18n";
import { useLocalePreferences } from "../i18n/LocalePreferencesProvider";
import { PSEUDO_LANGUAGE } from "../i18n/resources";
import { useCurrentUserSetting } from "../services/userSettingsStore";
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
          bgcolor: theme.background?.default || "#FBF9F4",
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
  const { currentTheme, availableThemes } = useSambeeTheme();
  const themeSetting = useCurrentUserSetting("appearance.theme_id");
  const languageSetting = useCurrentUserSetting("localization.language");
  const regionalLocaleSetting = useCurrentUserSetting("localization.regional_locale");
  const [pendingThemeId, setPendingThemeId] = useState<string | null>(null);
  const restoreThemeFocus = useRestoreFocusAfterPending(themeSetting.pending || pendingThemeId !== null);
  const restoreLanguageFocus = useRestoreFocusAfterPending(languageSetting.pending);
  const restoreRegionalLocaleFocus = useRestoreFocusAfterPending(regionalLocaleSetting.pending);
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
    const options: Array<{ value: string; label: string }> = [
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
    languageSetting.clearError();
    void setLanguagePreference(nextLanguagePreference).catch(() => undefined);
  };

  const handleRegionalLocaleChange = (event: SelectChangeEvent<string>) => {
    const nextRegionalLocalePreference = event.target.value;
    regionalLocaleSetting.clearError();
    void setRegionalLocalePreference(nextRegionalLocalePreference).catch(() => undefined);
  };

  const handleThemeSelect = (themeId: string) => {
    if (!themeSetting.pending && themeId !== currentTheme.id) {
      setPendingThemeId(themeId);
      themeSetting.clearError();
      void themeSetting
        .commit(themeId)
        .catch(() => undefined)
        .finally(() => setPendingThemeId(null));
    }
  };

  const selectedThemeId = pendingThemeId ?? currentTheme.id;
  const themeSelectionPending = themeSetting.pending || pendingThemeId !== null;

  return (
    <SettingsPage category="appearance">
      <SettingsSectionList>
        <SettingsGroup title={t("settings.appearancePage.themeTitle")}>
          {isMobile ? (
            <SettingsList>
              {availableThemes.map((themeOption) => (
                <Box key={themeOption.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      disabled={themeSelectionPending}
                      onFocus={() => restoreThemeFocus()}
                      onClick={() => handleThemeSelect(themeOption.id)}
                      sx={{ py: 2, px: 0 }}
                    >
                      <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%", gap: 2 }}>
                        <Radio checked={selectedThemeId === themeOption.id} sx={{ mt: -0.5 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h6" sx={{ fontWeight: 500 }}>
                            {themeOption.name}
                          </Typography>
                          {themeOption.description && (
                            <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                              {themeOption.description}
                            </Typography>
                          )}
                          <ThemePreview theme={themeOption} />
                        </Box>
                        {selectedThemeId === themeOption.id ? (
                          <SettingSaveStatus
                            pending={themeSelectionPending}
                            saved={themeSetting.saved}
                            savingLabel={t("settings.saveStatus.saving")}
                            savedLabel={t("settings.saveStatus.saved")}
                          />
                        ) : null}
                      </Box>
                    </ListItemButton>
                  </ListItem>
                  <Divider />
                </Box>
              ))}
            </SettingsList>
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
                  component="label"
                  key={themeOption.id}
                  sx={{
                    p: 3,
                    border: selectedThemeId === themeOption.id ? 2 : 1,
                    borderColor: selectedThemeId === themeOption.id ? "primary.main" : "divider",
                    borderRadius: 1,
                    cursor: themeSelectionPending ? "default" : "pointer",
                    transition: "all 0.2s",
                    ...(themeSelectionPending
                      ? {}
                      : {
                          "&:hover": {
                            borderColor: selectedThemeId === themeOption.id ? "primary.main" : "text.secondary",
                            bgcolor: "action.selected",
                          },
                        }),
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Radio
                      checked={selectedThemeId === themeOption.id}
                      disabled={themeSelectionPending}
                      slotProps={{ input: { "aria-label": themeOption.name } }}
                      onFocus={() => restoreThemeFocus()}
                      onChange={() => handleThemeSelect(themeOption.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleThemeSelect(themeOption.id);
                        }
                      }}
                    />
                    <Typography variant="h6" sx={{ ml: 1 }}>
                      {themeOption.name}
                    </Typography>
                    {selectedThemeId === themeOption.id ? (
                      <Box sx={{ ml: "auto" }}>
                        <SettingSaveStatus
                          pending={themeSelectionPending}
                          saved={themeSetting.saved}
                          savingLabel={t("settings.saveStatus.saving")}
                          savedLabel={t("settings.saveStatus.saved")}
                        />
                      </Box>
                    ) : null}
                  </Box>
                  {themeOption.description && (
                    <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
                      {themeOption.description}
                    </Typography>
                  )}
                  <ThemePreview theme={themeOption} />
                </Box>
              ))}
            </Box>
          )}
          {themeSetting.error ? <SettingsFieldHelp sx={{ color: "error.main" }}>{themeSetting.error}</SettingsFieldHelp> : null}
        </SettingsGroup>

        <SettingsGroup title={t("settings.appearancePage.localizationTitle")}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
            <FormControl fullWidth>
              <InputLabel id="appearance-language-label">{t("settings.appearancePage.languageLabel")}</InputLabel>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Select
                  labelId="appearance-language-label"
                  value={languagePreference}
                  label={t("settings.appearancePage.languageLabel")}
                  onChange={handleLanguageChange}
                  onFocus={() => restoreLanguageFocus()}
                  disabled={languageSetting.pending}
                  error={Boolean(languageSetting.error)}
                  sx={{ ...formSelectSx, flex: 1, minWidth: 0 }}
                  MenuProps={formSelectMenuProps}
                >
                  {languageOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>
                  <SettingSaveStatus
                    pending={languageSetting.pending}
                    saved={languageSetting.saved}
                    savingLabel={t("settings.saveStatus.saving")}
                    savedLabel={t("settings.saveStatus.saved")}
                  />
                </Box>
              </Box>
              <SettingsFieldHelp sx={languageSetting.error ? { color: "error.main" } : undefined}>
                {languageSetting.error ?? t("settings.appearancePage.languageDescription")}
              </SettingsFieldHelp>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="appearance-regional-locale-label">{t("settings.appearancePage.regionalLocaleLabel")}</InputLabel>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Select
                  labelId="appearance-regional-locale-label"
                  value={regionalLocalePreference}
                  label={t("settings.appearancePage.regionalLocaleLabel")}
                  onChange={handleRegionalLocaleChange}
                  onFocus={() => restoreRegionalLocaleFocus()}
                  disabled={regionalLocaleSetting.pending}
                  error={Boolean(regionalLocaleSetting.error)}
                  sx={{ ...formSelectSx, flex: 1, minWidth: 0 }}
                  MenuProps={formSelectMenuProps}
                >
                  {regionalLocaleOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>
                  <SettingSaveStatus
                    pending={regionalLocaleSetting.pending}
                    saved={regionalLocaleSetting.saved}
                    savingLabel={t("settings.saveStatus.saving")}
                    savedLabel={t("settings.saveStatus.saved")}
                  />
                </Box>
              </Box>
              <SettingsFieldHelp sx={regionalLocaleSetting.error ? { color: "error.main" } : undefined}>
                {regionalLocaleSetting.error ?? t("settings.appearancePage.regionalLocaleDescription")}
              </SettingsFieldHelp>
            </FormControl>
          </Box>

          <FormControl
            fullWidth
            role="group"
            aria-labelledby="appearance-regional-preview-label"
            sx={{
              mt: 2.5,
            }}
          >
            <InputLabel id="appearance-regional-preview-label" shrink sx={{ px: 0.5, bgcolor: getSettingsPageSurfaceColor }}>
              {t("settings.appearancePage.regionalSettingsPreviewTitle")}
            </InputLabel>
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {formatLocalizedDateTime(PREVIEW_DATE, {
                  dateStyle: "full",
                  timeStyle: "short",
                })}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75, color: "text.secondary" }}>
                {formatLocalizedNumber(1234567.89, {
                  maximumFractionDigits: 2,
                })}
              </Typography>
            </Box>
          </FormControl>
        </SettingsGroup>
      </SettingsSectionList>
    </SettingsPage>
  );
}
