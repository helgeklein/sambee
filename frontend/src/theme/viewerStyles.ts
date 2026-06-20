/**
 * Viewer styling utilities
 *
 * Shared utilities and default colors for viewer components
 * (ImageViewer, PDFViewer, MarkdownViewer).
 */

import type { Theme } from "@mui/material";
import type { SystemStyleObject } from "@mui/system";
import type { ThemeConfig } from "./types";

//
// Default viewer colors
//

/**
 * Default fallback colors for viewer components.
 * These are used when theme doesn't provide specific viewer colors.
 */
export const VIEWER_DEFAULTS = {
  /** Toolbar background shared across all viewers */
  TOOLBAR_BG: "rgba(0,0,0,0.8)",
  /** Toolbar text color (white for contrast against dark toolbar) */
  TOOLBAR_TEXT: "#ffffff",

  /** Image viewer: black background to make images pop */
  IMAGE_VIEWER_BG: "#000000",
  /** PDF viewer: gray background to distinguish from PDF pages */
  PDF_VIEWER_BG: "#525252",
  /** Markdown viewer: white background for readability */
  MARKDOWN_VIEWER_BG: "#ffffff",
  /** Markdown viewer: dark text for readability */
  MARKDOWN_VIEWER_TEXT: "#000000",
} as const;

//
// Viewer color types
//

/** Colors for a viewer component */
export interface ViewerColors {
  viewerBg: string;
  toolbarBg: string;
  toolbarText: string;
}

/** Extended colors for markdown viewer (includes text color) */
export interface MarkdownViewerColors extends ViewerColors {
  viewerText: string;
  linkColor: string;
  linkHoverColor: string;
}

//
// getViewerColors
//

/**
 * Get viewer colors from theme with fallbacks.
 * Centralizes the color extraction logic that was duplicated across viewers.
 *
 * @param theme - The current Sambee theme configuration
 * @param viewerType - Which viewer to get colors for
 * @returns ViewerColors object with background and toolbar colors
 *
 * @example
 * ```tsx
 * const { currentTheme } = useSambeeTheme();
 * const colors = getViewerColors(currentTheme, 'image');
 * ```
 */
export function getViewerColors(theme: ThemeConfig, viewerType: "image"): ViewerColors;
export function getViewerColors(theme: ThemeConfig, viewerType: "pdf"): ViewerColors;
export function getViewerColors(theme: ThemeConfig, viewerType: "markdown"): MarkdownViewerColors;
export function getViewerColors(theme: ThemeConfig, viewerType: "image" | "pdf" | "markdown"): ViewerColors | MarkdownViewerColors {
  switch (viewerType) {
    case "image":
      return {
        viewerBg: theme.components?.imageViewer?.viewerBackground || VIEWER_DEFAULTS.IMAGE_VIEWER_BG,
        toolbarBg: theme.components?.imageViewer?.toolbarBackground || VIEWER_DEFAULTS.TOOLBAR_BG,
        toolbarText: theme.components?.imageViewer?.toolbarText || VIEWER_DEFAULTS.TOOLBAR_TEXT,
      };

    case "pdf":
      return {
        viewerBg: theme.components?.pdfViewer?.viewerBackground || VIEWER_DEFAULTS.PDF_VIEWER_BG,
        toolbarBg: theme.components?.pdfViewer?.toolbarBackground || VIEWER_DEFAULTS.TOOLBAR_BG,
        toolbarText: theme.components?.pdfViewer?.toolbarText || VIEWER_DEFAULTS.TOOLBAR_TEXT,
      };

    case "markdown":
      return {
        viewerBg: theme.components?.markdownViewer?.viewerBackground || VIEWER_DEFAULTS.MARKDOWN_VIEWER_BG,
        toolbarBg: theme.components?.markdownViewer?.toolbarBackground || VIEWER_DEFAULTS.TOOLBAR_BG,
        toolbarText: theme.components?.markdownViewer?.toolbarText || VIEWER_DEFAULTS.TOOLBAR_TEXT,
        viewerText: theme.components?.markdownViewer?.viewerText || VIEWER_DEFAULTS.MARKDOWN_VIEWER_TEXT,
        linkColor: theme.components?.link?.main || theme.primary.main,
        linkHoverColor: theme.components?.link?.hover || theme.primary.dark || theme.primary.main,
      };
  }
}

//
// Markdown content styles
//

/**
 * Markdown styling colors aligned with the website docs code surfaces.
 */
export const MARKDOWN_COLORS = {
  /** Code block and inline code background */
  CODE_BG: "#f0eee9",
  /** Border used by docs code surfaces */
  CODE_BORDER: "#d4c4ae",
  /** Table and blockquote border */
  BORDER: "#dfe2e5",
  /** Table header border */
  BORDER_STRONG: "#c6cbd1",
  /** Table row background */
  ROW_BG: "#fff",
  /** Table alternate row background */
  ROW_BG_ALT: "#f6f8fa",
  /** Blockquote text color */
  MUTED_TEXT: "#6a737d",
  /** Heading border */
  HEADING_BORDER: "#eaecef",
} as const;

const MARKDOWN_CODE_FONT_SIZE = "0.875em";
const MARKDOWN_INLINE_CODE_PADDING = "0.125rem 0.375rem";
const MARKDOWN_CODE_BLOCK_PADDING = "1.25rem";
const MARKDOWN_CODE_BLOCK_LINE_HEIGHT = 1.65;
export const MARKDOWN_CODE_BLOCK_ACTIVE_LINE_NUMBER_BG = "rgba(212, 196, 174, 0.35)";
const MARKDOWN_TABLE_CELL_PADDING_INLINE = "0.675rem";
const MARKDOWN_TABLE_CELL_PADDING_BLOCK = "0.8em";
const MARKDOWN_TABLE_FONT_SIZE = "0.9375em";
const MARKDOWN_TABLE_HEADER_FONT_SIZE = "0.75rem";
const MARKDOWN_TABLE_HEADER_LETTER_SPACING = "0.16em";
const MARKDOWN_TABLE_LIGHT_BG = "#fbf9f4";
const MARKDOWN_TABLE_LIGHT_ROW_ALT_BG = "#f5f3ee";
const MARKDOWN_TABLE_LIGHT_HEADER_BG = "#eae8e3";
const MARKDOWN_TABLE_LIGHT_BORDER = "#d4c4ae";
const MARKDOWN_TABLE_LIGHT_BORDER_STRONG = "#827562";
const MARKDOWN_TABLE_DARK_BG = "#1b1c19";
const MARKDOWN_TABLE_DARK_ROW_ALT_BG = "#24231f";
const MARKDOWN_TABLE_DARK_HEADER_BG = "#302e2a";
const MARKDOWN_TABLE_DARK_BORDER = "#3b3935";
const MARKDOWN_TABLE_DARK_BORDER_STRONG = "#504535";
const MARKDOWN_TABLE_DARK_HEADER_TEXT = "#ebe8e2";
const MARKDOWN_EDITOR_INLINE_CODE_CLASS = "sambee-markdown-inline-code";
const MARKDOWN_EDITOR_CODE_BLOCK_CLASS = "sambee-markdown-code-block";

function getMarkdownTableSurfaceColors(theme: Theme) {
  if (theme.palette.mode === "dark") {
    return {
      tableBackground: MARKDOWN_TABLE_DARK_BG,
      alternateRowBackground: MARKDOWN_TABLE_DARK_ROW_ALT_BG,
      headerBackground: MARKDOWN_TABLE_DARK_HEADER_BG,
      headerText: MARKDOWN_TABLE_DARK_HEADER_TEXT,
      border: MARKDOWN_TABLE_DARK_BORDER,
      borderStrong: MARKDOWN_TABLE_DARK_BORDER_STRONG,
    };
  }

  return {
    tableBackground: MARKDOWN_TABLE_LIGHT_BG,
    alternateRowBackground: MARKDOWN_TABLE_LIGHT_ROW_ALT_BG,
    headerBackground: MARKDOWN_TABLE_LIGHT_HEADER_BG,
    headerText: undefined,
    border: MARKDOWN_TABLE_LIGHT_BORDER,
    borderStrong: MARKDOWN_TABLE_LIGHT_BORDER_STRONG,
  };
}

function getMarkdownDocumentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SystemStyleObject<Theme> {
  return {
    color: viewerText,
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: 1.5,

    // Ensure all children respect container width.
    "& *": {
      boxSizing: "border-box",
      minWidth: 0,
      maxWidth: "100%",
    },

    // Keep block spacing consistent between viewer and editor.
    "& p, & ul, & ol, & blockquote, & pre, & table": {
      marginTop: 0,
      marginBottom: "16px",
    },
    "& ul, & ol": {
      paddingLeft: "2em",
    },
    "& ul ul, & ul ol, & ol ul, & ol ol": {
      marginTop: 0,
      marginBottom: 0,
    },
    "& li": {
      marginTop: "0.25em",
      marginBottom: "0.25em",
    },

    // Code blocks: fixed width with internal scrolling.
    "& pre": {
      backgroundColor: MARKDOWN_COLORS.CODE_BG,
      color: viewerText,
      border: `1px solid ${MARKDOWN_COLORS.CODE_BORDER}`,
      borderRadius: 0,
      fontSize: MARKDOWN_CODE_FONT_SIZE,
      padding: MARKDOWN_CODE_BLOCK_PADDING,
      margin: "1.25rem 0",
      overflowX: "auto",
      lineHeight: MARKDOWN_CODE_BLOCK_LINE_HEIGHT,
      width: "100%",
    },

    // Inline code mirrors docs styling.
    "& code:not(pre code)": {
      backgroundColor: MARKDOWN_COLORS.CODE_BG,
      color: viewerText,
      fontSize: MARKDOWN_CODE_FONT_SIZE,
      fontWeight: "normal",
      padding: MARKDOWN_INLINE_CODE_PADDING,
      border: `1px solid ${MARKDOWN_COLORS.CODE_BORDER}`,
      borderRadius: 0,
      overflowWrap: "break-word",
    },

    // Code inside pre inherits the containing code surface.
    "& pre code": {
      display: "block",
      minWidth: "max-content",
      color: "inherit",
      border: 0,
      padding: 0,
      backgroundColor: "transparent",
      overflowWrap: "normal",
    },

    // Images: scale to fit.
    "& img": {
      maxWidth: "100%",
      height: "auto",
      display: "block",
    },

    // Tables mirror the website docs treatment.
    "& table": {
      display: "block",
      width: "max-content",
      maxWidth: "100%",
      overflowX: "auto",
      borderCollapse: "collapse",
      margin: "1.25rem 0",
      fontSize: MARKDOWN_TABLE_FONT_SIZE,
      border: (theme) => `1px solid ${getMarkdownTableSurfaceColors(theme).borderStrong}`,
      backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).tableBackground,
    },
    "& table td, & table th": {
      border: (theme) => `1px solid ${getMarkdownTableSurfaceColors(theme).border}`,
      paddingBlock: MARKDOWN_TABLE_CELL_PADDING_BLOCK,
      paddingInline: MARKDOWN_TABLE_CELL_PADDING_INLINE,
      textAlign: "left",
      verticalAlign: "top",
    },
    "& table thead th": {
      backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).headerBackground,
      color: (theme) => getMarkdownTableSurfaceColors(theme).headerText,
      fontSize: MARKDOWN_TABLE_HEADER_FONT_SIZE,
      fontWeight: 700,
      letterSpacing: MARKDOWN_TABLE_HEADER_LETTER_SPACING,
      textTransform: "uppercase",
    },
    "& table tbody tr:nth-of-type(even)": {
      backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).alternateRowBackground,
    },

    // Blockquotes.
    "& blockquote": {
      borderLeft: `4px solid ${MARKDOWN_COLORS.BORDER}`,
      marginTop: 0,
      marginBottom: "16px",
      paddingLeft: "16px",
      color: MARKDOWN_COLORS.MUTED_TEXT,
    },

    // Headings: break long words.
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      marginTop: "24px",
      marginBottom: "16px",
      fontWeight: 600,
      lineHeight: 1.25,
      overflowWrap: "break-word",
    },
    "& h1": {
      paddingBottom: "0.3em",
      fontSize: "2em",
      borderBottom: `1px solid ${MARKDOWN_COLORS.HEADING_BORDER}`,
    },
    "& h2": {
      paddingBottom: "0.3em",
      fontSize: "1.5em",
      borderBottom: `1px solid ${MARKDOWN_COLORS.HEADING_BORDER}`,
    },
    "& h3": {
      fontSize: "1.25em",
    },

    // Links.
    "& a": {
      color: linkColor,
      textDecoration: "none",
      overflowWrap: "break-word",
      "&:hover": {
        color: linkHoverColor,
      },
    },
  };
}

//
// getMarkdownContentStyles
//

/**
 * Get the sx prop for styling markdown content.
 * Encapsulates all GitHub-flavored markdown styling.
 *
 * @param viewerText - Text color for the markdown content
 * @param linkColor - Default color for markdown links
 * @param linkHoverColor - Hover color for markdown links
 * @returns SxProps for the markdown container
 */
export function getMarkdownContentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SystemStyleObject<Theme> {
  return {
    // Layout
    minHeight: 0,
    minWidth: 0,
    width: "100%",
    maxWidth: "100%",
    p: { xs: 2, sm: 4 },
    ...getMarkdownDocumentStyles(viewerText, linkColor, linkHoverColor),
  };
}

export function getMarkdownEditorContentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SystemStyleObject<Theme> {
  return {
    minHeight: "100%",
    padding: 0,
    caretColor: viewerText,
    ...getMarkdownDocumentStyles(viewerText, linkColor, linkHoverColor),
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS}`]: {
      "--baseBase": MARKDOWN_COLORS.CODE_BG,
      "--baseBg": MARKDOWN_COLORS.CODE_BG,
      "--baseBgSubtle": MARKDOWN_COLORS.CODE_BG,
      "--baseBgHover": MARKDOWN_COLORS.CODE_BG,
      "--baseBgActive": MARKDOWN_COLORS.CODE_BG,
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} > div`]: {
      backgroundColor: MARKDOWN_COLORS.CODE_BG,
      border: `1px solid ${MARKDOWN_COLORS.CODE_BORDER}`,
      borderRadius: 0,
      padding: MARKDOWN_CODE_BLOCK_PADDING,
      fontSize: MARKDOWN_CODE_FONT_SIZE,
      lineHeight: MARKDOWN_CODE_BLOCK_LINE_HEIGHT,
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-editor, & .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-scroller, & .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-content, & .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-gutters`]:
      {
        backgroundColor: MARKDOWN_COLORS.CODE_BG,
        fontSize: "inherit",
        lineHeight: "inherit",
      },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-editor`]: {
      borderRadius: 0,
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-editor.cm-focused .cm-activeLineGutter`]: {
      backgroundColor: MARKDOWN_CODE_BLOCK_ACTIVE_LINE_NUMBER_BG,
      color: viewerText,
      fontWeight: 600,
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-editor:not(.cm-focused) .cm-activeLineGutter`]: {
      backgroundColor: "transparent",
      color: "inherit",
      fontWeight: "inherit",
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} [role='combobox']`]: {
      borderRadius: 0,
    },
    [`& .${MARKDOWN_EDITOR_CODE_BLOCK_CLASS} .cm-content`]: {
      padding: 0,
    },
    [`& .${MARKDOWN_EDITOR_INLINE_CODE_CLASS}`]: {
      backgroundColor: "transparent !important",
      padding: 0,
    },
  };
}
