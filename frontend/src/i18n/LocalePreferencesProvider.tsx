import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { loadCurrentUserSettings, USER_SETTINGS_CHANGED_EVENT } from "../services/userSettingsSync";
import type { CurrentUserSettings, LanguagePreference, RegionalLocalePreference } from "../types";
import i18n, {
  getCurrentLanguagePreference,
  getCurrentRegionalLocale,
  getCurrentRegionalLocalePreference,
  REGIONAL_LOCALE_CHANGED_EVENT,
  setLanguagePreference,
  setRegionalLocalePreference,
} from "./index";

interface LocalePreferencesContextValue {
  languagePreference: LanguagePreference;
  regionalLocale: string;
  regionalLocalePreference: RegionalLocalePreference;
  setLanguagePreference: (languagePreference: LanguagePreference) => Promise<void>;
  setRegionalLocalePreference: (regionalLocalePreference: RegionalLocalePreference) => Promise<void>;
}

const LocalePreferencesContext = createContext<LocalePreferencesContextValue | undefined>(undefined);

function extractLocalizationSettings(settings: CurrentUserSettings | null): CurrentUserSettings["localization"] | null {
  if (!settings) {
    return null;
  }

  return settings.localization;
}

export function LocalePreferencesProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(() => getCurrentLanguagePreference());
  const [regionalLocalePreference, setRegionalLocalePreferenceState] = useState<RegionalLocalePreference>(() =>
    getCurrentRegionalLocalePreference()
  );
  const [regionalLocale, setRegionalLocaleState] = useState<string>(() => getCurrentRegionalLocale());

  useEffect(() => {
    const syncFromI18n = () => {
      setLanguagePreferenceState(getCurrentLanguagePreference());
      setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
      setRegionalLocaleState(getCurrentRegionalLocale());
    };

    const applyLocalizationSettings = async (settings: CurrentUserSettings | null) => {
      const localization = extractLocalizationSettings(settings);
      if (!localization) {
        return;
      }

      await setLanguagePreference(localization.language);
      await setRegionalLocalePreference(localization.regional_locale);
      syncFromI18n();
    };

    const handleUserSettingsChanged = (event: Event) => {
      const settings = (event as CustomEvent<CurrentUserSettings>).detail;
      void applyLocalizationSettings(settings);
    };

    i18n.on("languageChanged", syncFromI18n);
    window.addEventListener(REGIONAL_LOCALE_CHANGED_EVENT, syncFromI18n);
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);

    void loadCurrentUserSettings().then((settings) => {
      void applyLocalizationSettings(settings);
    });

    return () => {
      i18n.off("languageChanged", syncFromI18n);
      window.removeEventListener(REGIONAL_LOCALE_CHANGED_EVENT, syncFromI18n);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, handleUserSettingsChanged);
    };
  }, []);

  const value = useMemo<LocalePreferencesContextValue>(
    () => ({
      languagePreference,
      regionalLocale,
      regionalLocalePreference,
      setLanguagePreference: async (nextLanguagePreference) => {
        await setLanguagePreference(nextLanguagePreference);
        setLanguagePreferenceState(getCurrentLanguagePreference());
        setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
        setRegionalLocaleState(getCurrentRegionalLocale());
      },
      setRegionalLocalePreference: async (nextRegionalLocalePreference) => {
        await setRegionalLocalePreference(nextRegionalLocalePreference);
        setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
        setRegionalLocaleState(getCurrentRegionalLocale());
      },
    }),
    [languagePreference, regionalLocale, regionalLocalePreference]
  );

  return <LocalePreferencesContext.Provider value={value}>{children}</LocalePreferencesContext.Provider>;
}

export function useLocalePreferences(): LocalePreferencesContextValue {
  const context = useContext(LocalePreferencesContext);
  if (!context) {
    throw new Error("useLocalePreferences must be used within a LocalePreferencesProvider");
  }

  return context;
}
