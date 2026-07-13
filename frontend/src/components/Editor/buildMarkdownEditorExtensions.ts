import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage, pasteURLAsLink } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdownTableAutocompleter, markdownTables } from "codemirror-markdown-tables";
import { buildPassiveSearchHighlightExtension } from "./buildCodeMirrorSearchHighlights";
import { buildCommonEditorExtensions } from "./buildCommonEditorExtensions";
import {
  buildSelectionLayerExtension,
  EDITOR_SELECTION_RANGE_CLASS,
  getSelectionLineSegments,
  type SelectionLineSegment,
} from "./buildEditorSelectionLayer";
import { buildMarkdownAutocompleteUi, createMarkdownSnippetAutocompleter } from "./buildMarkdownAutocomplete";
import { buildMarkdownEditorTheme, type MarkdownEditorThemeOptions } from "./buildMarkdownEditorTheme";
import { buildMarkdownTableTheme } from "./buildMarkdownTableTheme";

const MARKDOWN_TABLE_AUTOCOMPLETE_OPTIONS = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
] as const;

export const MARKDOWN_SELECTION_RANGE_CLASS = EDITOR_SELECTION_RANGE_CLASS;
export type MarkdownSelectionLineSegment = SelectionLineSegment;
export const getMarkdownSelectionLineSegments = getSelectionLineSegments;

export function buildMarkdownEditorExtensions(theme: MarkdownEditorThemeOptions): Extension[] {
  const markdownLanguageSupport = markdown({ base: markdownLanguage, codeLanguages: languages });
  const snippetAutocompleter = createMarkdownSnippetAutocompleter();
  const tableAutocompleter = markdownTableAutocompleter({ options: MARKDOWN_TABLE_AUTOCOMPLETE_OPTIONS });
  const markdownAutocompleteData = markdownLanguageSupport.language.data.of({
    autocomplete: (context) => snippetAutocompleter(context) ?? tableAutocompleter(context),
  });
  const markdownTableTheme = buildMarkdownTableTheme(theme);

  return [
    ...buildCommonEditorExtensions({
      defaultSyntaxHighlighting: false,
      drawSelection: false,
      highlightSelectionMatches: false,
      lineWrapping: true,
    }),
    ...buildMarkdownEditorTheme(theme),
    buildSelectionLayerExtension(),
    buildPassiveSearchHighlightExtension(),
    buildMarkdownAutocompleteUi(),
    pasteURLAsLink,
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "on",
      autocapitalize: "sentences",
    }),
    markdownLanguageSupport,
    markdownAutocompleteData,
    markdownTables({
      ...markdownTableTheme,
      selectionType: "codemirror",
      handlePosition: "inside",
      lineWrapping: "wrap",
      extensions: [keymap.of(defaultKeymap)],
      globalKeyBindings: [...historyKeymap, ...searchKeymap],
      markdownConfig: {
        completeHTMLTags: true,
        pasteURLAsLink: true,
      },
    }),
  ];
}
