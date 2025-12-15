/**
 * Theme system for Sambee
 *
 * Provides a flexible theming system that allows users to:
 * - Switch between built-in themes
 * - Create custom themes
 * - Persist theme preferences
 *
 * @example
 * ```tsx
 * import { SambeeThemeProvider, useSambeeTheme } from './theme';
 *
 * function MyComponent() {
 *   const { currentTheme, setThemeById, availableThemes } = useSambeeTheme();
 *   return (
 *     <select value={currentTheme.id} onChange={(e) => setThemeById(e.target.value)}>
 *       {availableThemes.map(theme => (
 *         <option key={theme.id} value={theme.id}>{theme.name}</option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */

export { SambeeThemeProvider, useSambeeTheme } from "./ThemeContext";
export { builtInThemes, getDefaultTheme, getThemeById } from "./themes";
export type { ThemeConfig, ThemeFieldSchema, ThemeFieldType } from "./types";
export { THEME_SCHEMA } from "./types";
