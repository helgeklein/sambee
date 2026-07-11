import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage, pasteURLAsLink } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, layer, RectangleMarker } from "@codemirror/view";
import { markdownTableAutocompleter, markdownTables } from "codemirror-markdown-tables";
import { buildPassiveSearchHighlightExtension } from "../Viewer/markdownEditorSearch";
import { buildCommonEditorExtensions } from "./buildCommonEditorExtensions";
import { buildMarkdownAutocompleteUi, createMarkdownSnippetAutocompleter } from "./buildMarkdownAutocomplete";
import { buildMarkdownEditorTheme, type MarkdownEditorThemeOptions } from "./buildMarkdownEditorTheme";
import { buildMarkdownTableTheme } from "./buildMarkdownTableTheme";

const MARKDOWN_TABLE_AUTOCOMPLETE_OPTIONS = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
] as const;

export const MARKDOWN_SELECTION_RANGE_CLASS = "sambee-markdown-selection-range";

export interface MarkdownSelectionLineSegment {
  from: number;
  to: number;
  emptyLine: boolean;
}

export function getMarkdownSelectionLineSegments(doc: Text, range: { from: number; to: number }): MarkdownSelectionLineSegment[] {
  const segments: MarkdownSelectionLineSegment[] = [];

  let line = doc.lineAt(range.from);

  for (;;) {
    const segmentFrom = Math.max(range.from, line.from);
    const segmentTo = Math.min(range.to, line.to);

    if (segmentFrom < segmentTo) {
      segments.push({ from: segmentFrom, to: segmentTo, emptyLine: false });
    } else if (line.length === 0 && range.from <= line.from && line.from < range.to) {
      // Mirror VS Code's visual behavior on empty lines by painting a single
      // character cell at the line start when the selection crosses that row.
      segments.push({ from: line.from, to: line.to, emptyLine: true });
    }

    if (line.to >= range.to) {
      break;
    }

    line = doc.line(line.number + 1);
  }

  return segments;
}

function expandSelectionRectangles(view: EditorView, markers: readonly RectangleMarker[]): RectangleMarker[] {
  const targetHeight = view.defaultLineHeight;

  return markers.map((marker) => {
    if (marker.height >= targetHeight) {
      return marker;
    }

    const expansion = (targetHeight - marker.height) / 2;

    return new RectangleMarker(MARKDOWN_SELECTION_RANGE_CLASS, marker.left, marker.top - expansion, marker.width, targetHeight);
  });
}

function buildEmptyLineSelectionMarkers(view: EditorView, position: number): RectangleMarker[] {
  const cursorMarkers = RectangleMarker.forRange(view, MARKDOWN_SELECTION_RANGE_CLASS, EditorSelection.cursor(position));

  return expandSelectionRectangles(
    view,
    cursorMarkers.map(
      (marker) =>
        new RectangleMarker(
          MARKDOWN_SELECTION_RANGE_CLASS,
          marker.left,
          marker.top,
          marker.width === null ? view.defaultCharacterWidth : Math.max(marker.width, view.defaultCharacterWidth),
          marker.height
        )
    )
  );
}

function buildMarkdownSelectionExtension(): Extension {
  return layer({
    above: false,
    class: "sambee-markdown-selection-layer",
    update(update) {
      return update.docChanged || update.selectionSet || update.viewportChanged;
    },
    markers(view) {
      const markers = [];

      for (const range of view.state.selection.ranges) {
        if (range.empty) {
          continue;
        }

        for (const segment of getMarkdownSelectionLineSegments(view.state.doc, range)) {
          if (segment.emptyLine) {
            markers.push(...buildEmptyLineSelectionMarkers(view, segment.from));
          } else {
            markers.push(
              ...expandSelectionRectangles(
                view,
                RectangleMarker.forRange(view, MARKDOWN_SELECTION_RANGE_CLASS, EditorSelection.range(segment.from, segment.to))
              )
            );
          }
        }
      }

      return markers;
    },
  });
}

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
    buildMarkdownSelectionExtension(),
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
