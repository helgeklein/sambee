import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { buildCodeMirrorSurfaceTheme } from "./buildCodeMirrorSurfaceTheme";
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
    ...buildCodeMirrorSurfaceTheme({
      activeLineBackground,
      borderColor,
      currentSearchMatchBackground,
      isDarkMode,
      otherSearchMatchBackground,
      selectionBackground,
      surfaceBackground,
      textColor,
    }),
    syntaxHighlighting(HighlightStyle.define([{ tag: [tags.labelName, tags.link, tags.string, tags.url], color: linkColor }])),
    EditorView.theme({
      ".cm-content ::selection": {
        backgroundColor: "transparent",
      },
      ".cm-line::selection, .cm-line ::selection": {
        backgroundColor: "transparent",
      },
      [`.${MARKDOWN_SELECTION_RANGE_CLASS}`]: {
        backgroundColor: selectionBackground,
      },
    }),
  ];
}
