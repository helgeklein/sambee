import {
  Box,
  Button,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { settingsSelectMenuProps, settingsSelectSx } from "../components/Settings/SettingsFormLayout";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsList } from "../components/Settings/SettingsList";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { getSettingsPageSurfaceColor } from "../components/Settings/settingsSurface";
import { getAvailableLanguages } from "../i18n";
import { useLocalePreferences } from "../i18n/LocalePreferencesProvider";
import { PSEUDO_LANGUAGE } from "../i18n/resources";
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
  const { currentTheme, availableThemes, saveThemeById, setThemeById } = useSambeeTheme();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const { languagePreference, regionalLocalePreference, setLanguagePreference, setRegionalLocalePreference } = useLocalePreferences();
  const availableLanguages = getAvailableLanguages();
  const [savedAppearance, setSavedAppearance] = useState({
    themeId: currentTheme.id,
    languagePreference,
    regionalLocalePreference,
  });
  const savedAppearanceRef = useRef(savedAppearance);
  const draftAppearanceRef = useRef(savedAppearance);
  const previewActionsRef = useRef({ setThemeById, setLanguagePreference, setRegionalLocalePreference });
  previewActionsRef.current = { setThemeById, setLanguagePreference, setRegionalLocalePreference };
  const [draftThemeId, setDraftThemeId] = useState(currentTheme.id);
  const [draftLanguagePreference, setDraftLanguagePreference] = useState(languagePreference);
  const [draftRegionalLocalePreference, setDraftRegionalLocalePreference] = useState(regionalLocalePreference);

  useEffect(() => {
    const nextSavedAppearance = {
      themeId: currentTheme.id,
      languagePreference,
      regionalLocalePreference,
    };
    const previousSavedAppearance = savedAppearanceRef.current;
    const wasClean =
      draftAppearanceRef.current.themeId === previousSavedAppearance.themeId &&
      draftAppearanceRef.current.languagePreference === previousSavedAppearance.languagePreference &&
      draftAppearanceRef.current.regionalLocalePreference === previousSavedAppearance.regionalLocalePreference;

    if (!wasClean) {
      return;
    }

    savedAppearanceRef.current = nextSavedAppearance;
    setSavedAppearance(nextSavedAppearance);

    if (wasClean) {
      draftAppearanceRef.current = nextSavedAppearance;
      setDraftThemeId(nextSavedAppearance.themeId);
      setDraftLanguagePreference(nextSavedAppearance.languagePreference);
      setDraftRegionalLocalePreference(nextSavedAppearance.regionalLocalePreference);
    }
  }, [currentTheme.id, languagePreference, regionalLocalePreference]);

  const hasUnsavedChanges =
    draftThemeId !== savedAppearance.themeId ||
    draftLanguagePreference !== savedAppearance.languagePreference ||
    draftRegionalLocalePreference !== savedAppearance.regionalLocalePreference;

  useEffect(() => {
    return () => {
      previewActionsRef.current.setThemeById(savedAppearanceRef.current.themeId);
      void previewActionsRef.current.setLanguagePreference(savedAppearanceRef.current.languagePreference);
      void previewActionsRef.current.setRegionalLocalePreference(savedAppearanceRef.current.regionalLocalePreference);
    };
  }, []);

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

    if (draftRegionalLocalePreference !== "browser" && !options.some((option) => option.value === draftRegionalLocalePreference)) {
      options.push({ value: draftRegionalLocalePreference, label: draftRegionalLocalePreference });
    }

    return options;
  }, [draftRegionalLocalePreference, t]);

  const handleLanguageChange = (event: SelectChangeEvent<string>) => {
    const nextLanguagePreference = event.target.value as LanguagePreference;
    draftAppearanceRef.current = { ...draftAppearanceRef.current, languagePreference: nextLanguagePreference };
    setDraftLanguagePreference(nextLanguagePreference);
    void setLanguagePreference(nextLanguagePreference);
  };

  const handleRegionalLocaleChange = (event: SelectChangeEvent<string>) => {
    const nextRegionalLocalePreference = event.target.value;
    draftAppearanceRef.current = { ...draftAppearanceRef.current, regionalLocalePreference: nextRegionalLocalePreference };
    setDraftRegionalLocalePreference(nextRegionalLocalePreference);
    void setRegionalLocalePreference(nextRegionalLocalePreference);
  };

  const saveChanges = () => {
    const nextSavedAppearance = {
      themeId: draftThemeId,
      languagePreference: draftLanguagePreference,
      regionalLocalePreference: draftRegionalLocalePreference,
    };
    draftAppearanceRef.current = nextSavedAppearance;
    savedAppearanceRef.current = nextSavedAppearance;
    setSavedAppearance(nextSavedAppearance);
    saveThemeById(draftThemeId, {
      localization: {
        language: draftLanguagePreference,
        regional_locale: draftRegionalLocalePreference,
      },
    });
  };

  return (
    <SettingsPage
      category="appearance"
      footerPrimaryActions={
        <Button variant="contained" onClick={saveChanges} disabled={!hasUnsavedChanges}>
          {t("settings.advanced.saveChanges")}
        </Button>
      }
    >
      <SettingsSectionList>
        <SettingsGroup title={t("settings.appearancePage.themeTitle")}>
          {isMobile ? (
            <SettingsList>
              {availableThemes.map((themeOption) => (
                <Box key={themeOption.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => {
                        draftAppearanceRef.current = { ...draftAppearanceRef.current, themeId: themeOption.id };
                        setDraftThemeId(themeOption.id);
                        setThemeById(themeOption.id);
                      }}
                      sx={{ py: 2, px: 0 }}
                    >
                      <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%", gap: 2 }}>
                        <Radio checked={draftThemeId === themeOption.id} sx={{ mt: -0.5 }} />
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
                  key={themeOption.id}
                  onClick={() => {
                    draftAppearanceRef.current = { ...draftAppearanceRef.current, themeId: themeOption.id };
                    setDraftThemeId(themeOption.id);
                    setThemeById(themeOption.id);
                  }}
                  sx={{
                    p: 3,
                    border: draftThemeId === themeOption.id ? 2 : 1,
                    borderColor: draftThemeId === themeOption.id ? "primary.main" : "divider",
                    borderRadius: 1,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    "&:hover": {
                      borderColor: draftThemeId === themeOption.id ? "primary.main" : "text.secondary",
                      bgcolor: "action.selected",
                    },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <Radio checked={draftThemeId === themeOption.id} />
                    <Typography variant="h6" sx={{ ml: 1 }}>
                      {themeOption.name}
                    </Typography>
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
        </SettingsGroup>

        <SettingsGroup title={t("settings.appearancePage.localizationTitle")}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
            <FormControl fullWidth>
              <InputLabel id="appearance-language-label">{t("settings.appearancePage.languageLabel")}</InputLabel>
              <Select
                labelId="appearance-language-label"
                value={draftLanguagePreference}
                label={t("settings.appearancePage.languageLabel")}
                onChange={handleLanguageChange}
                sx={settingsSelectSx}
                MenuProps={settingsSelectMenuProps}
              >
                {languageOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <SettingsFieldHelp>{t("settings.appearancePage.languageDescription")}</SettingsFieldHelp>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="appearance-regional-locale-label">{t("settings.appearancePage.regionalLocaleLabel")}</InputLabel>
              <Select
                labelId="appearance-regional-locale-label"
                value={draftRegionalLocalePreference}
                label={t("settings.appearancePage.regionalLocaleLabel")}
                onChange={handleRegionalLocaleChange}
                sx={settingsSelectSx}
                MenuProps={settingsSelectMenuProps}
              >
                {regionalLocaleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <SettingsFieldHelp>{t("settings.appearancePage.regionalLocaleDescription")}</SettingsFieldHelp>
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
