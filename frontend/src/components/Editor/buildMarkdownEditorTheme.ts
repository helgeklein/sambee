import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export interface MarkdownEditorThemeOptions {
  activeLineBackground: string;
  borderColor: string;
  linkColor: string;
  selectionBackground: string;
  surfaceBackground: string;
  textColor: string;
}

export function buildMarkdownEditorTheme({
  activeLineBackground,
  borderColor,
  linkColor,
  selectionBackground,
  surfaceBackground,
  textColor,
}: MarkdownEditorThemeOptions): Extension[] {
  return [
    EditorView.theme({
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
        backgroundColor: selectionBackground,
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: selectionBackground,
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
    }),
    syntaxHighlighting(HighlightStyle.define([{ tag: [tags.labelName, tags.link, tags.string, tags.url], color: linkColor }])),
  ];
}
