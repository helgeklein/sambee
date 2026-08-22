import { getSearchQuery, SearchQuery, setSearchQuery } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

export interface CodeMirrorFindReplaceRequest {
  caseSensitive: boolean;
  regexp: boolean;
  searchOpen: boolean;
  searchText: string;
  wholeWord: boolean;
}

export interface CodeMirrorFindReplaceMetrics {
  currentMatch: number;
  isSearchable: boolean;
  isValid: boolean;
  matches: number;
  searchText: string;
}

export interface CodeMirrorFindReplaceOptions {
  caseSensitive: boolean;
  regexp: boolean;
  replace: string;
  searchText: string;
  wholeWord: boolean;
}

interface SearchMatchRange {
  from: number;
  to: number;
}

function rangeContainedInSelection(range: SearchMatchRange, selection: SearchMatchRange): boolean {
  return selection.from <= range.from && selection.to >= range.to;
}

function resolveSearchMatchState(view: EditorView): CodeMirrorFindReplaceMetrics {
  const query = getSearchQuery(view.state);
  const searchText = query.search;
  const isSearchable = view.state.doc.length > 0;

  if (!searchText) {
    return { currentMatch: 0, isSearchable, isValid: true, matches: 0, searchText };
  }

  if (!query.valid) {
    return { currentMatch: 0, isSearchable, isValid: false, matches: 0, searchText };
  }

  const cursor = query.getCursor(view.state);
  const mainSelection = view.state.selection.main;
  const mainSelectionRange = { from: mainSelection.from, to: mainSelection.to };
  let matches = 0;
  let currentMatch = 0;
  let containedMatchIndex = 0;

  for (let nextMatch = cursor.next(); !nextMatch.done; nextMatch = cursor.next()) {
    matches += 1;
    const match = nextMatch.value;

    if (match.from === mainSelection.from && match.to === mainSelection.to) {
      currentMatch = matches;
      continue;
    }

    if (containedMatchIndex === 0 && rangeContainedInSelection(match, mainSelectionRange)) {
      containedMatchIndex = matches;
    }
  }

  return { currentMatch: currentMatch || containedMatchIndex, isSearchable, isValid: true, matches, searchText };
}

export function updateCodeMirrorFindReplaceQuery(view: EditorView | null | undefined, options: CodeMirrorFindReplaceOptions): void {
  if (!view) {
    return;
  }

  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        caseSensitive: options.caseSensitive,
        literal: true,
        regexp: options.regexp,
        replace: options.replace,
        search: options.searchText,
        wholeWord: options.wholeWord,
      })
    ),
  });
}

export function getCodeMirrorFindReplaceMetrics(view: EditorView | null | undefined): CodeMirrorFindReplaceMetrics {
  if (!view) {
    return { currentMatch: 0, isSearchable: false, isValid: true, matches: 0, searchText: "" };
  }

  return resolveSearchMatchState(view);
}

export function shouldAutoNavigateCodeMirrorFindReplace(
  previousRequest: CodeMirrorFindReplaceRequest | null,
  currentRequest: CodeMirrorFindReplaceRequest,
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
