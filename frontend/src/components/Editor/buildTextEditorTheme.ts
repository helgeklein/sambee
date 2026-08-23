import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE } from "../../theme/viewerStyles";
import { buildCodeMirrorSurfaceTheme, type CodeMirrorSurfaceThemeOptions } from "./buildCodeMirrorSurfaceTheme";

export interface TextEditorThemeOptions extends CodeMirrorSurfaceThemeOptions {
  accentColor: string;
}

export function buildTextEditorTheme({ accentColor, ...surfaceOptions }: TextEditorThemeOptions): Extension[] {
  return [
    ...buildCodeMirrorSurfaceTheme(surfaceOptions),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: accentColor },
        { tag: [tags.string, tags.url], color: accentColor },
        { tag: [tags.comment], color: `${surfaceOptions.textColor}99`, fontStyle: "italic" },
      ])
    ),
    EditorView.theme({
      ".cm-selectionLayer": {
        width: "100%",
        height: "100%",
        clipPath: `inset(0 var(${CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE}, 0px) 0 var(${CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE}, 0px))`,
      },
    }),
  ];
}
