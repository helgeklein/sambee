import type { MarkdownRichEditorSearchState } from "./MarkdownRichEditor";

export function areMarkdownSearchStatesEqual(
  previousState: MarkdownRichEditorSearchState,
  nextState: MarkdownRichEditorSearchState
): boolean {
  return (
    previousState.searchText === nextState.searchText &&
    previousState.searchMatches === nextState.searchMatches &&
    previousState.currentMatch === nextState.currentMatch &&
    previousState.isSearchOpen === nextState.isSearchOpen &&
    previousState.isSearchable === nextState.isSearchable &&
    previousState.viewMode === nextState.viewMode
  );
}
