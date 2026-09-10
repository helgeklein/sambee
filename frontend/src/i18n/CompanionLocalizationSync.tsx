import { useEffect, useRef, useState } from "react";
import { syncCurrentLocalizationToCompanion } from "../services/companionLocalizationSync";
import { useCurrentUserSetting } from "../services/userSettingsStore";
import { useLocalePreferences } from "./LocalePreferencesProvider";

export function CompanionLocalizationSync() {
  const { languagePreference, regionalLocale, regionalLocalePreference } = useLocalePreferences();
  const languageSetting = useCurrentUserSetting("localization.language");
  const [ready, setReady] = useState(false);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    setReady(languageSetting.confirmedValue !== undefined);
  }, [languageSetting.confirmedValue]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const signature = JSON.stringify({ languagePreference, regionalLocale, regionalLocalePreference });
    if (lastSignatureRef.current === signature) {
      return;
    }

    lastSignatureRef.current = signature;
    void syncCurrentLocalizationToCompanion();
  }, [languagePreference, ready, regionalLocale, regionalLocalePreference]);

  return null;
}
