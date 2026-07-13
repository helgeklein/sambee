import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
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
  ];
}