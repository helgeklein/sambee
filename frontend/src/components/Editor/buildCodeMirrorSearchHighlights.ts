import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type EditorView, ViewPlugin } from "@codemirror/view";

export const PASSIVE_SEARCH_MATCH_CLASS = "sambee-passive-search-match";
export const PASSIVE_SELECTED_SEARCH_MATCH_CLASS = "sambee-passive-search-match-selected";

interface SearchMatchRange {
  from: number;
  to: number;
}

const passiveSearchMatchMark = Decoration.mark({ class: PASSIVE_SEARCH_MATCH_CLASS });
const passiveSelectedSearchMatchMark = Decoration.mark({
  class: `${PASSIVE_SEARCH_MATCH_CLASS} ${PASSIVE_SELECTED_SEARCH_MATCH_CLASS}`,
});

function rangeEquals(left: SearchMatchRange | null, right: SearchMatchRange): boolean {
  return left !== null && left.from === right.from && left.to === right.to;
}

function rangeContainedInSelection(range: SearchMatchRange, selection: SearchMatchRange): boolean {
  return selection.from <= range.from && selection.to >= range.to;
}

function resolveCurrentSearchRange(view: EditorView): SearchMatchRange | null {
  const query = getSearchQuery(view.state);

  if (!query.search) {
    return null;
  }

  const cursor = query.getCursor(view.state);
  const mainSelection = view.state.selection.main;
  const mainSelectionRange = { from: mainSelection.from, to: mainSelection.to };

  let currentRange: SearchMatchRange | null = null;
  let containedRange: SearchMatchRange | null = null;

  for (let nextMatch = cursor.next(); !nextMatch.done; nextMatch = cursor.next()) {
    const match = nextMatch.value;
    const matchRange = { from: match.from, to: match.to };

    if (match.from === mainSelection.from && match.to === mainSelection.to) {
      currentRange = matchRange;
      continue;
    }

    if (containedRange === null && rangeContainedInSelection(matchRange, mainSelectionRange)) {
      containedRange = matchRange;
    }
  }

  return currentRange ?? containedRange;
}

export function buildPassiveSearchHighlightExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: {
        view: EditorView;
        state: EditorView["state"];
        startState: EditorView["state"];
        docChanged: boolean;
        selectionSet: boolean;
        viewportChanged: boolean;
      }) {
        const query = getSearchQuery(update.state);
        const previousQuery = getSearchQuery(update.startState);

        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          !query.eq(previousQuery) ||
          searchPanelOpen(update.state) !== searchPanelOpen(update.startState)
        ) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const query = getSearchQuery(view.state);

        if (!query.valid || query.search.length === 0) {
          return Decoration.none;
        }

        const panelOpen = searchPanelOpen(view.state);
        const currentRange = resolveCurrentSearchRange(view);
        const mainSelection = view.state.selection.main;
        const mainSelectionRange = { from: mainSelection.from, to: mainSelection.to };

        if (panelOpen) {
          if (currentRange === null || rangeEquals(currentRange, mainSelectionRange)) {
            return Decoration.none;
          }

          return Decoration.set([passiveSelectedSearchMatchMark.range(currentRange.from, currentRange.to)], true);
        }

        const builder = new RangeSetBuilder<Decoration>();

        for (const { from, to } of view.visibleRanges) {
          const cursor = query.getCursor(view.state, from, to);

          for (let nextMatch = cursor.next(); !nextMatch.done; nextMatch = cursor.next()) {
            const match = nextMatch.value;
            const selected = rangeEquals(currentRange, { from: match.from, to: match.to });

            if (selected) {
              builder.add(match.from, match.to, passiveSelectedSearchMatchMark);
              continue;
            }

            builder.add(match.from, match.to, passiveSearchMatchMark);
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (value) => value.decorations,
    }
  );
}
