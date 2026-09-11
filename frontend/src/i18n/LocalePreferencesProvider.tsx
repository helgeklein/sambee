import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useCurrentUserSetting } from "../services/userSettingsStore";
import type { LanguagePreference, RegionalLocalePreference } from "../types";
import i18n, {
  setLanguagePreference as applyLanguagePreference,
  setRegionalLocalePreference as applyRegionalLocalePreference,
  getCurrentLanguagePreference,
  getCurrentRegionalLocale,
  getCurrentRegionalLocalePreference,
  REGIONAL_LOCALE_CHANGED_EVENT,
} from "./index";

interface LocalePreferencesContextValue {
  languagePreference: LanguagePreference;
  regionalLocale: string;
  regionalLocalePreference: RegionalLocalePreference;
  setLanguagePreference: (languagePreference: LanguagePreference) => Promise<void>;
  setRegionalLocalePreference: (regionalLocalePreference: RegionalLocalePreference) => Promise<void>;
}

const LocalePreferencesContext = createContext<LocalePreferencesContextValue | undefined>(undefined);

export function LocalePreferencesProvider({ children }: { children: ReactNode }) {
  const languageSetting = useCurrentUserSetting("localization.language");
  const regionalLocaleSetting = useCurrentUserSetting("localization.regional_locale");
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

    const applyLocalizationSettings = async () => {
      if (languageSetting.confirmedValue === undefined || regionalLocaleSetting.confirmedValue === undefined) {
        return;
      }

      await applyLanguagePreference(languageSetting.confirmedValue);
      await applyRegionalLocalePreference(regionalLocaleSetting.confirmedValue);
      syncFromI18n();
    };

    const applyLocalizationSettingsSafely = async () => {
      try {
        await applyLocalizationSettings();
      } catch {
        syncFromI18n();
      }
    };

    i18n.on("languageChanged", syncFromI18n);
    window.addEventListener(REGIONAL_LOCALE_CHANGED_EVENT, syncFromI18n);
    void applyLocalizationSettingsSafely();

    return () => {
      i18n.off("languageChanged", syncFromI18n);
      window.removeEventListener(REGIONAL_LOCALE_CHANGED_EVENT, syncFromI18n);
    };
  }, [languageSetting.confirmedValue, regionalLocaleSetting.confirmedValue]);

  const value = useMemo<LocalePreferencesContextValue>(
    () => ({
      languagePreference,
      regionalLocale,
      regionalLocalePreference,
      setLanguagePreference: async (nextLanguagePreference) => {
        await languageSetting.commit(nextLanguagePreference);
        try {
          await applyLanguagePreference(nextLanguagePreference);
        } catch {
          setLanguagePreferenceState(getCurrentLanguagePreference());
          setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
          setRegionalLocaleState(getCurrentRegionalLocale());
          return;
        }
        setLanguagePreferenceState(getCurrentLanguagePreference());
        setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
        setRegionalLocaleState(getCurrentRegionalLocale());
      },
      setRegionalLocalePreference: async (nextRegionalLocalePreference) => {
        await regionalLocaleSetting.commit(nextRegionalLocalePreference);
        try {
          await applyRegionalLocalePreference(nextRegionalLocalePreference);
        } catch {
          setLanguagePreferenceState(getCurrentLanguagePreference());
          setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
          setRegionalLocaleState(getCurrentRegionalLocale());
          return;
        }
        setRegionalLocalePreferenceState(getCurrentRegionalLocalePreference());
        setRegionalLocaleState(getCurrentRegionalLocale());
      },
    }),
    [languagePreference, languageSetting, regionalLocale, regionalLocalePreference, regionalLocaleSetting]
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
