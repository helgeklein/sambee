import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANGUAGE, PSEUDO_LANGUAGE, resources, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./resources";

export const LOCALE_STORAGE_KEY = "sambee.locale";
export const REGIONAL_LOCALE_STORAGE_KEY = "sambee.regional-locale";
export const BROWSER_LANGUAGE_PREFERENCE = "browser";
export const BROWSER_REGIONAL_LOCALE_PREFERENCE = "browser";
export const DEFAULT_LANGUAGE_PREFERENCE = BROWSER_LANGUAGE_PREFERENCE;
export const DEFAULT_REGIONAL_LOCALE_PREFERENCE = BROWSER_REGIONAL_LOCALE_PREFERENCE;
export const REGIONAL_LOCALE_CHANGED_EVENT = "sambee:regional-locale-changed";

export type LanguagePreference = SupportedLanguage | typeof BROWSER_LANGUAGE_PREFERENCE;
export type RegionalLocalePreference = string;

let localeSideEffectsRegistered = false;
let currentLanguagePreference: LanguagePreference = DEFAULT_LANGUAGE_PREFERENCE;
let currentRegionalLocalePreference: RegionalLocalePreference = DEFAULT_REGIONAL_LOCALE_PREFERENCE;
let currentRegionalLocale = DEFAULT_LANGUAGE;

export function isPseudoLanguageEnabled(isDevelopment: boolean = import.meta.env.DEV): boolean {
  return isDevelopment;
}

export function getAvailableLanguages(isDevelopment: boolean = import.meta.env.DEV): SupportedLanguage[] {
  return isPseudoLanguageEnabled(isDevelopment)
    ? SUPPORTED_LANGUAGES
    : SUPPORTED_LANGUAGES.filter((supportedLanguage) => supportedLanguage !== PSEUDO_LANGUAGE);
}

function getBrowserLocales(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }

  const locales = Array.isArray(navigator.languages) ? navigator.languages : [];
  if (locales.length > 0) {
    return locales.filter((locale): locale is string => Boolean(locale));
  }

  return navigator.language ? [navigator.language] : [];
}

function canonicalizeLocale(locale: string): string | null {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    return null;
  }
}

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

function resolveLanguagePreference(language?: string | null): LanguagePreference {
  if (!language || language === BROWSER_LANGUAGE_PREFERENCE) {
    return DEFAULT_LANGUAGE_PREFERENCE;
  }

  return resolveLanguage(language);
}

function resolveLanguageFromPreference(languagePreference: LanguagePreference): SupportedLanguage {
  if (languagePreference !== BROWSER_LANGUAGE_PREFERENCE) {
    return resolveLanguage(languagePreference);
  }

  const browserLocales = getBrowserLocales();
  for (const locale of browserLocales) {
    const supportedLanguage = resolveLanguage(locale);
    if (supportedLanguage) {
      return supportedLanguage;
    }
  }

  return DEFAULT_LANGUAGE;
}

function resolveRegionalLocalePreference(locale?: string | null): RegionalLocalePreference {
  if (!locale || locale === BROWSER_REGIONAL_LOCALE_PREFERENCE) {
    return DEFAULT_REGIONAL_LOCALE_PREFERENCE;
  }

  return canonicalizeLocale(locale) ?? DEFAULT_REGIONAL_LOCALE_PREFERENCE;
}

function resolveRegionalLocale(localePreference: RegionalLocalePreference, languagePreference: LanguagePreference): string {
  if (localePreference !== BROWSER_REGIONAL_LOCALE_PREFERENCE) {
    return canonicalizeLocale(localePreference) ?? resolveLanguageFromPreference(languagePreference);
  }

  for (const locale of getBrowserLocales()) {
    const canonicalized = canonicalizeLocale(locale);
    if (canonicalized) {
      return canonicalized;
    }
  }

  return resolveLanguageFromPreference(languagePreference);
}

function readStoredLanguagePreference(): LanguagePreference | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storedLanguage = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return storedLanguage ? resolveLanguagePreference(storedLanguage) : undefined;
  } catch {
    return undefined;
  }
}

function readStoredRegionalLocalePreference(): RegionalLocalePreference | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storedLocale = window.localStorage.getItem(REGIONAL_LOCALE_STORAGE_KEY);
    return storedLocale ? resolveRegionalLocalePreference(storedLocale) : undefined;
  } catch {
    return undefined;
  }
}

function persistLanguagePreference(languagePreference: LanguagePreference): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolveLanguagePreference(languagePreference));
  } catch {
    // Ignore storage failures; locale changes should still work for the current session.
  }
}

function persistRegionalLocalePreference(regionalLocalePreference: RegionalLocalePreference): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(REGIONAL_LOCALE_STORAGE_KEY, resolveRegionalLocalePreference(regionalLocalePreference));
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
    syncDocumentLanguage(language);
  });
}

export function getCurrentLanguage(): SupportedLanguage {
  return resolveLanguage(i18n.resolvedLanguage ?? i18n.language);
}

export function getCurrentLanguagePreference(): LanguagePreference {
  return currentLanguagePreference;
}

export function getCurrentRegionalLocalePreference(): RegionalLocalePreference {
  return currentRegionalLocalePreference;
}

export function getCurrentRegionalLocale(): string {
  return currentRegionalLocale;
}

function updateResolvedRegionalLocale(): void {
  currentRegionalLocale = resolveRegionalLocale(currentRegionalLocalePreference, currentLanguagePreference);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(REGIONAL_LOCALE_CHANGED_EVENT, {
        detail: {
          regionalLocale: currentRegionalLocale,
          preference: currentRegionalLocalePreference,
        },
      })
    );
  }
}

currentLanguagePreference = readStoredLanguagePreference() ?? DEFAULT_LANGUAGE_PREFERENCE;
currentRegionalLocalePreference = readStoredRegionalLocalePreference() ?? DEFAULT_REGIONAL_LOCALE_PREFERENCE;

const initialLanguage = resolveLanguageFromPreference(currentLanguagePreference);
currentRegionalLocale = resolveRegionalLocale(currentRegionalLocalePreference, currentLanguagePreference);

registerLocaleSideEffects();
syncDocumentLanguage(initialLanguage);

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "translation",
    showSupportNotice: false,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    returnNull: false,
  });
}

export function translate(...args: Parameters<typeof i18n.t>): string {
  return i18n.t(...args) as string;
}

export async function setLanguagePreference(languagePreference: string): Promise<void> {
  currentLanguagePreference = resolveLanguagePreference(languagePreference);
  persistLanguagePreference(currentLanguagePreference);
  updateResolvedRegionalLocale();
  await i18n.changeLanguage(resolveLanguageFromPreference(currentLanguagePreference));
}

export async function setRegionalLocalePreference(regionalLocalePreference: string): Promise<void> {
  currentRegionalLocalePreference = resolveRegionalLocalePreference(regionalLocalePreference);
  persistRegionalLocalePreference(currentRegionalLocalePreference);
  updateResolvedRegionalLocale();
}

export async function setLocale(language: string): Promise<void> {
  await setLanguagePreference(language);
}

export default i18n;
