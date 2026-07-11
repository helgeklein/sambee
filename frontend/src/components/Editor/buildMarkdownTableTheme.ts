import { TableStyle, TableTheme } from "codemirror-markdown-tables";

export interface MarkdownTableThemeOptions {
  activeLineBackground: string;
  borderColor: string;
  selectionBackground: string;
  surfaceBackground: string;
  textColor: string;
  tableBackground: string;
  tableAlternateRowBackground: string;
  tableHeaderBackground: string;
  tableHeaderText?: string;
  tableBorderColor: string;
}

interface MarkdownTableThemeConfig {
  theme: {
    light: TableTheme;
    dark: TableTheme;
  };
  style: TableStyle;
}

function softenSelectionOverlay(color: string): string {
  const rgbaMatch = color.match(/^rgba?\(([^)]+)\)$/i);

  if (!rgbaMatch) {
    return color;
  }

  const channels = rgbaMatch[1]?.split(",").map((part) => part.trim()) ?? [];

  if (channels.length < 3) {
    return color;
  }

  const red = channels[0] ?? "0";
  const green = channels[1] ?? "0";
  const blue = channels[2] ?? "0";
  const alpha = channels.length >= 4 ? Number.parseFloat(channels[3] ?? "1") : 1;
  const softenedAlpha = Number.isFinite(alpha) ? Math.max(Math.min(alpha * 0.65, 1), 0) : 0.18;

  return `rgba(${red}, ${green}, ${blue}, ${softenedAlpha})`;
}

function buildTableThemeProps({
  activeLineBackground,
  borderColor,
  selectionBackground,
  surfaceBackground,
  textColor,
  tableBackground,
  tableAlternateRowBackground,
  tableHeaderBackground,
  tableHeaderText,
  tableBorderColor,
}: MarkdownTableThemeOptions) {
  return {
    "--tbl-theme-row-background": tableBackground,
    "--tbl-theme-even-row-background": tableAlternateRowBackground,
    "--tbl-theme-odd-row-background": tableBackground,
    "--tbl-theme-header-row-background": tableHeaderBackground,
    "--tbl-theme-border-color": tableBorderColor,
    "--tbl-theme-border-hover-color": borderColor,
    "--tbl-theme-border-active-color": textColor,
    "--tbl-theme-outline-color": textColor,
    "--tbl-theme-text-color": textColor,
    "--tbl-theme-menu-border-color": tableBorderColor,
    "--tbl-theme-menu-background": surfaceBackground,
    "--tbl-theme-menu-hover-background": activeLineBackground,
    "--tbl-theme-menu-text-color": tableHeaderText ?? textColor,
    "--tbl-theme-menu-hover-text-color": textColor,
    "--tbl-theme-select-all-focus-overlay": selectionBackground,
    "--tbl-theme-select-all-blur-overlay": softenSelectionOverlay(selectionBackground),
  } as const;
}

export function buildMarkdownTableTheme(options: MarkdownTableThemeOptions): MarkdownTableThemeConfig {
  const themeProps = buildTableThemeProps(options);

  return {
    theme: {
      light: TableTheme.light.with(themeProps),
      dark: TableTheme.dark.with(themeProps),
    },
    style: TableStyle.default.with({
      "--tbl-style-font-family": "inherit",
      "--tbl-style-font-size": "inherit",
      "--tbl-style-menu-font-family": "inherit",
      "--tbl-style-menu-font-size": "inherit",
      "--tbl-style-default-header-alignment": "left",
    }),
  };
}
