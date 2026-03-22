import { getCurrentRegionalLocale } from "../i18n";

export function compareLocalizedStrings(a: string, b: string, options?: Intl.CollatorOptions): number {
  return a.localeCompare(b, getCurrentRegionalLocale(), options);
}

export function formatLocalizedDateTime(value: Date | string, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(getCurrentRegionalLocale(), options);
}

export function formatLocalizedNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getCurrentRegionalLocale(), options).format(value);
}
