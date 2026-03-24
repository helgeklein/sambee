/**
 * Viewer styling utilities
 *
 * Shared utilities and default colors for viewer components
 * (ImageViewer, PDFViewer, MarkdownViewer).
 */

import type { SxProps, Theme } from "@mui/material";
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
 * GitHub-flavored markdown styling colors.
 */
export const MARKDOWN_COLORS = {
  /** Code block and inline code background */
  CODE_BG: "#f6f8fa",
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

function getMarkdownDocumentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SxProps<Theme> {
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
      borderRadius: 1,
      p: { xs: 1, sm: 2 },
      overflow: "auto",
      width: "100%",
    },

    // Inline code: break long words.
    "& code": {
      backgroundColor: MARKDOWN_COLORS.CODE_BG,
      padding: "0.2em 0.4em",
      borderRadius: "3px",
      fontSize: "0.9em",
      overflowWrap: "break-word",
    },

    // Code inside pre: preserve formatting (don't break).
    "& pre code": {
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

    // Tables: horizontal scroll if too wide.
    "& table": {
      borderCollapse: "collapse",
      width: "100%",
      display: "block",
      overflowX: "auto",
    },
    "& table td, & table th": {
      border: `1px solid ${MARKDOWN_COLORS.BORDER}`,
      padding: "6px 13px",
    },
    "& table tr": {
      backgroundColor: MARKDOWN_COLORS.ROW_BG,
      borderTop: `1px solid ${MARKDOWN_COLORS.BORDER_STRONG}`,
    },
    "& table tr:nth-of-type(even)": {
      backgroundColor: MARKDOWN_COLORS.ROW_BG_ALT,
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
export function getMarkdownContentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SxProps<Theme> {
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

export function getMarkdownEditorContentStyles(viewerText: string, linkColor: string, linkHoverColor: string): SxProps<Theme> {
  return {
    minHeight: "100%",
    padding: 0,
    caretColor: viewerText,
    ...getMarkdownDocumentStyles(viewerText, linkColor, linkHoverColor),
  };
}
