import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE } from "../../theme/viewerStyles";
import { buildCodeMirrorSurfaceTheme } from "./buildCodeMirrorSurfaceTheme";

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
      ".cm-selectionLayer": {
        width: "100%",
        height: "100%",
        clipPath: `inset(0 var(${CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE}, 0px) 0 var(${CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE}, 0px))`,
      },
    }),
  ];
}
