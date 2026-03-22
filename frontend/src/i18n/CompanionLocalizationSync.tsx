import { useEffect, useRef, useState } from "react";
import { syncCurrentLocalizationToCompanion } from "../services/companionLocalizationSync";
import { loadCurrentUserSettings } from "../services/userSettingsSync";
import { useLocalePreferences } from "./LocalePreferencesProvider";

export function CompanionLocalizationSync() {
  const { languagePreference, regionalLocale, regionalLocalePreference } = useLocalePreferences();
  const [ready, setReady] = useState(false);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadCurrentUserSettings().finally(() => {
      if (!cancelled) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
