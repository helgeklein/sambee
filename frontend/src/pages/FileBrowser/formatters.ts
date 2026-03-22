import { formatLocalizedDateTime, formatLocalizedNumber } from "../../utils/localeFormatting";

//
// formatters
//

/**
 * Format file size in human-readable format
 */
export const formatFileSize = (bytes?: number): string => {
  if (bytes === undefined || bytes === null) return "";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const fractionDigits = unitIndex === 0 ? 0 : 1;
  return `${formatLocalizedNumber(size, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${units[unitIndex]}`;
};

/**
 * Format date in locale-specific format
 */
export const formatDate = (dateString?: string): string => {
  if (!dateString) return "";
  return formatLocalizedDateTime(dateString, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
