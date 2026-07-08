import { markdown, pasteURLAsLink } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildCommonEditorExtensions } from "./buildCommonEditorExtensions";
import { buildMarkdownAutocomplete } from "./buildMarkdownAutocomplete";
import { buildMarkdownEditorTheme, type MarkdownEditorThemeOptions } from "./buildMarkdownEditorTheme";

export function buildMarkdownEditorExtensions(theme: MarkdownEditorThemeOptions): Extension[] {
  return [
    ...buildCommonEditorExtensions({ defaultSyntaxHighlighting: false, lineWrapping: true }),
    ...buildMarkdownEditorTheme(theme),
    buildMarkdownAutocomplete(),
    pasteURLAsLink,
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "on",
      autocapitalize: "sentences",
    }),
    markdown({ codeLanguages: languages }),
  ];
}
