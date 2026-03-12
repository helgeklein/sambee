const PATH_SEPARATOR = "/";
const BACKSLASH_SEPARATOR = "\\";

/**
 * Normalises path separators in a search query so that both `/` and `\`
 * work for cross-directory matching.
 */
export function normalizeQuerySeparators(query: string): string {
  return query.replaceAll(BACKSLASH_SEPARATOR, PATH_SEPARATOR);
}
