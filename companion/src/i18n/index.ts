import i18n from "i18next";
import { DEFAULT_LANGUAGE, resources, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./resources";

export const LOCALE_STORAGE_KEY = "sambee.locale";

let localeSideEffectsRegistered = false;

function resolveLanguage(language?: string | null): SupportedLanguage {
  if (!language) {
    return DEFAULT_LANGUAGE;
  }

  const exactMatch = SUPPORTED_LANGUAGES.find((supportedLanguage) => supportedLanguage.toLowerCase() === language.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const baseLanguage = language.split("-")[0]?.toLowerCase();
  const fallbackMatch = SUPPORTED_LANGUAGES.find((supportedLanguage) => supportedLanguage.toLowerCase() === baseLanguage);

  return fallbackMatch ?? DEFAULT_LANGUAGE;
}

function readStoredLanguage(): SupportedLanguage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storedLanguage = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return storedLanguage ? resolveLanguage(storedLanguage) : undefined;
  } catch {
    return undefined;
  }
}

function persistLanguage(language: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolveLanguage(language));
  } catch {
    // Ignore storage failures; locale changes should still work for the current session.
  }
}

function syncDocumentLanguage(language: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedLanguage = resolveLanguage(language);
  document.documentElement.lang = resolvedLanguage;
  document.documentElement.dir = i18n.dir(resolvedLanguage);
}

function registerLocaleSideEffects(): void {
  if (localeSideEffectsRegistered) {
    return;
  }

  localeSideEffectsRegistered = true;
  i18n.on("languageChanged", (language) => {
    persistLanguage(language);
    syncDocumentLanguage(language);
  });
}

export function getCurrentLanguage(): SupportedLanguage {
  return resolveLanguage(i18n.resolvedLanguage ?? i18n.language);
}

const initialLanguage = readStoredLanguage() ?? resolveLanguage(typeof navigator === "undefined" ? undefined : navigator.language);

registerLocaleSideEffects();
syncDocumentLanguage(initialLanguage);

if (!i18n.isInitialized) {
  void i18n.init({
    resources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });
}

export function translate(...args: Parameters<typeof i18n.t>): string {
  return i18n.t(...args) as string;
}

export async function setLocale(language: string): Promise<void> {
  await i18n.changeLanguage(resolveLanguage(language));
}

export default i18n;
