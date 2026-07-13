import { getSearchQuery, SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

export interface MarkdownEditorSearchRequest {
  searchText: string;
  searchOpen: boolean;
}

export interface MarkdownEditorSearchMetrics {
  matches: number;
  currentMatch: number;
  searchText: string;
  isSearchable: boolean;
}

interface SearchMatchRange {
  from: number;
  to: number;
}

function rangeEquals(left: SearchMatchRange | null, right: SearchMatchRange): boolean {
  return left !== null && left.from === right.from && left.to === right.to;
}

function rangeContainedInSelection(range: SearchMatchRange, selection: SearchMatchRange): boolean {
  return selection.from <= range.from && selection.to >= range.to;
}

function resolveSearchMatchState(view: EditorView): MarkdownEditorSearchMetrics & { currentRange: SearchMatchRange | null } {
  const query = getSearchQuery(view.state);
  const normalizedSearchText = query.search;
  const isSearchable = view.state.doc.length > 0;

  if (!normalizedSearchText) {
    return { matches: 0, currentMatch: 0, currentRange: null, searchText: normalizedSearchText, isSearchable };
  }

  const cursor = query.getCursor(view.state);
  const mainSelection = view.state.selection.main;
  const mainSelectionRange = { from: mainSelection.from, to: mainSelection.to };

  let matches = 0;
  let currentMatch = 0;
  let currentRange: SearchMatchRange | null = null;
  let containedRange: SearchMatchRange | null = null;
  let containedMatchIndex = 0;

  for (let nextMatch = cursor.next(); !nextMatch.done; nextMatch = cursor.next()) {
    matches += 1;
    const match = nextMatch.value;
    const matchRange = { from: match.from, to: match.to };

    if (match.from === mainSelection.from && match.to === mainSelection.to) {
      currentMatch = matches;
      currentRange = matchRange;
      continue;
    }

    if (containedRange === null && rangeContainedInSelection(matchRange, mainSelectionRange)) {
      containedRange = matchRange;
      containedMatchIndex = matches;
    }
  }

  if (currentRange === null && containedRange !== null) {
    currentMatch = containedMatchIndex;
    currentRange = containedRange;
  }

  return { matches, currentMatch, currentRange, searchText: normalizedSearchText, isSearchable };
}

export function updateRootSearchQuery(view: EditorView | null | undefined, searchText: string): void {
  if (!view) {
    return;
  }

  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: searchText,
        caseSensitive: false,
        literal: true,
      })
    ),
  });
}

export function getRootSearchMetrics(view: EditorView | null | undefined): MarkdownEditorSearchMetrics {
  if (!view) {
    return { matches: 0, currentMatch: 0, searchText: "", isSearchable: false };
  }

  const { matches, currentMatch, searchText, isSearchable } = resolveSearchMatchState(view);
  return { matches, currentMatch, searchText, isSearchable };
}

export function shouldAutoNavigateSearch(
  previousRequest: MarkdownEditorSearchRequest | null,
  currentRequest: MarkdownEditorSearchRequest,
  searchAutoNavigate: boolean
): boolean {
  return (
    searchAutoNavigate &&
    currentRequest.searchOpen &&
    currentRequest.searchText.trim().length > 0 &&
    (!previousRequest ||
      previousRequest.searchText !== currentRequest.searchText ||
      previousRequest.searchOpen !== currentRequest.searchOpen)
  );
}
