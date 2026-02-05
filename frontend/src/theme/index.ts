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

// Styling constants
export {
  FOCUS_OUTLINE_OFFSET_PX,
  FOCUS_OUTLINE_WIDTH_PX,
  PAGE_INPUT,
  RESPONSIVE_FONT_SIZE,
  SCROLLBAR,
  SEARCH_HIGHLIGHT,
  TOOLBAR_HEIGHT,
  TOUCH_TARGET_MIN_SIZE_PX,
  Z_INDEX,
} from "./constants";
export { SambeeThemeProvider, useSambeeTheme } from "./ThemeContext";
export { builtInThemes, getDefaultTheme, getThemeById } from "./themes";
export type { ThemeConfig, ThemeFieldSchema, ThemeFieldType } from "./types";
export { THEME_SCHEMA } from "./types";
export type { MarkdownViewerColors, ViewerColors } from "./viewerStyles";
// Viewer styling utilities
export {
  getMarkdownContentStyles,
  getViewerColors,
  MARKDOWN_COLORS,
  VIEWER_DEFAULTS,
} from "./viewerStyles";
