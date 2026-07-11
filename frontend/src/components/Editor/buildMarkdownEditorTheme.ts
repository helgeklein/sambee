import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { MARKDOWN_SELECTION_RANGE_CLASS } from "./buildMarkdownEditorExtensions";

export interface MarkdownEditorThemeOptions {
  activeLineBackground: string;
  borderColor: string;
  currentSearchMatchBackground: string;
  isDarkMode: boolean;
  linkColor: string;
  otherSearchMatchBackground: string;
  selectionBackground: string;
  surfaceBackground: string;
  tableAlternateRowBackground: string;
  tableBackground: string;
  tableBorderColor: string;
  tableHeaderBackground: string;
  tableHeaderText?: string;
  textColor: string;
}

export function buildMarkdownEditorTheme({
  activeLineBackground,
  borderColor,
  currentSearchMatchBackground,
  isDarkMode,
  linkColor,
  otherSearchMatchBackground,
  selectionBackground,
  surfaceBackground,
  textColor,
}: MarkdownEditorThemeOptions): Extension[] {
  return [
    EditorView.theme(
      {
        ".cm-editor": {
          color: textColor,
          backgroundColor: "transparent",
        },
        ".cm-scroller, .cm-content": {
          color: textColor,
          backgroundColor: "transparent",
          caretColor: textColor,
        },
        ".cm-content ::selection": {
          backgroundColor: "transparent",
        },
        ".cm-line::selection, .cm-line ::selection": {
          backgroundColor: "transparent",
        },
        [`.${MARKDOWN_SELECTION_RANGE_CLASS}`]: {
          backgroundColor: selectionBackground,
        },
        ".cm-searchMatch": {
          backgroundColor: otherSearchMatchBackground,
        },
        ".cm-searchMatch-selected": {
          backgroundColor: currentSearchMatchBackground,
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: textColor,
        },
        ".cm-activeLine": {
          backgroundColor: "transparent",
        },
        "&.cm-focused .cm-activeLine": {
          backgroundColor: activeLineBackground,
        },
        ".cm-matchingBracket, .cm-nonmatchingBracket": {
          outline: `1px solid ${borderColor}`,
        },
        ".cm-tooltip": {
          backgroundColor: surfaceBackground,
          border: `1px solid ${borderColor}`,
          color: textColor,
        },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: activeLineBackground,
          color: textColor,
        },
        ".cm-completionIcon": {
          opacity: 0.75,
        },
        ".cm-panels": {
          backgroundColor: surfaceBackground,
          color: textColor,
          borderBottom: `1px solid ${borderColor}`,
        },
        ".cm-panels.cm-panels-bottom": {
          borderBottom: 0,
          borderTop: `1px solid ${borderColor}`,
        },
      },
      { dark: isDarkMode }
    ),
    syntaxHighlighting(HighlightStyle.define([{ tag: [tags.labelName, tags.link, tags.string, tags.url], color: linkColor }])),
  ];
}
