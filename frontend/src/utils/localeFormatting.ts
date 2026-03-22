import { getCurrentLanguage } from "../i18n";

export function compareLocalizedStrings(a: string, b: string, options?: Intl.CollatorOptions): number {
  return a.localeCompare(b, getCurrentLanguage(), options);
}

export function formatLocalizedDateTime(value: Date | string, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(getCurrentLanguage(), options);
}

export function formatLocalizedNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getCurrentLanguage(), options).format(value);
}
