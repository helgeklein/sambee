import { findNext, findPrevious, getSearchQuery, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { buildMarkdownEditorExtensions } from "../Editor/buildMarkdownEditorExtensions";
import type { MarkdownEditorThemeOptions } from "../Editor/buildMarkdownEditorTheme";
import { SourceTextEditor } from "../Editor/SourceTextEditor";
import type { SourceTextEditorHandle } from "../Editor/sourceTextEditorTypes";

export interface MarkdownRichEditorHandle {
  focus: () => void;
  flushPendingEdits: () => Promise<void>;
  getCanonicalMarkdown: () => string;
  getPrimarySelectionText: () => string;
  preserveSelection: () => void;
  restorePreservedSelection: () => boolean;
  focusCurrentSearchResult: () => boolean;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

export interface MarkdownRichEditorSearchState {
  searchText: string;
  searchMatches: number;
  currentMatch: number;
  isSearchOpen: boolean;
  isSearchable: boolean;
  viewMode: "rich-text" | "source" | "diff";
}

export interface MarkdownRichEditorProps {
  markdown: string;
  diffMarkdown?: string;
  onChange: (markdown: string) => void;
  onUserEdit?: () => void;
  ariaLabel: string;
  theme: MarkdownEditorThemeOptions;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  searchText?: string;
  searchOpen?: boolean;
  searchAutoNavigate?: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
}

function getCurrentDoc(editorRef: React.RefObject<SourceTextEditorHandle | null>): string {
  return editorRef.current?.getValue() ?? "";
}

function updateSearchQuery(editorRef: React.RefObject<SourceTextEditorHandle | null>, searchText: string): void {
  const view = editorRef.current?.getView();

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

function countSearchMatches(editorRef: React.RefObject<SourceTextEditorHandle | null>) {
  const view = editorRef.current?.getView();

  if (!view) {
    return { matches: 0, currentMatch: 0, searchText: "", isSearchable: false };
  }

  const query = getSearchQuery(view.state);
  const normalizedSearchText = query.search;
  const isSearchable = view.state.doc.length > 0;

  if (!normalizedSearchText) {
    return { matches: 0, currentMatch: 0, searchText: normalizedSearchText, isSearchable };
  }

  const cursor = query.getCursor(view.state);
  let matches = 0;
  let currentMatch = 0;
  const mainSelection = view.state.selection.main;

  for (let nextMatch = cursor.next(); !nextMatch.done; nextMatch = cursor.next()) {
    matches += 1;
    const match = nextMatch.value;

    if (match.from === mainSelection.from && match.to === mainSelection.to) {
      currentMatch = matches;
    }
  }

  return { matches, currentMatch, searchText: normalizedSearchText, isSearchable };
}

function replaceSelectionWithText(
  editorRef: React.RefObject<SourceTextEditorHandle | null>,
  getInsert: (selectedText: string) => { insert: string; selection: { anchor: number; head: number } }
): void {
  const view = editorRef.current?.getView();

  if (!view) {
    return;
  }

  const mainSelection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(mainSelection.from, mainSelection.to);
  const nextValue = getInsert(selectedText);

  view.dispatch({
    changes: { from: mainSelection.from, to: mainSelection.to, insert: nextValue.insert },
    selection: EditorSelection.range(mainSelection.from + nextValue.selection.anchor, mainSelection.from + nextValue.selection.head),
    userEvent: "input",
  });
  view.focus();
}

function createLinkCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  replaceSelectionWithText(editorRef, (selectedText) => {
    if (selectedText.length > 0) {
      const placeholder = "https://";
      const insert = `[${selectedText}](${placeholder})`;
      const anchor = insert.indexOf(placeholder);
      return { insert, selection: { anchor, head: anchor + placeholder.length } };
    }

    const label = "link text";
    const placeholder = "https://";
    const insert = `[${label}](${placeholder})`;
    return { insert, selection: { anchor: 1, head: 1 + label.length } };
  });
}

function insertTableCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  replaceSelectionWithText(editorRef, () => {
    const insert = "| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |";
    return { insert, selection: { anchor: 2, head: 10 } };
  });
}

function insertThematicBreakCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  const view = editorRef.current?.getView();

  if (!view) {
    return;
  }

  const mainSelection = view.state.selection.main;
  const insert = view.state.doc.length === 0 ? "---\n\n" : "\n\n---\n\n";

  view.dispatch({
    changes: { from: mainSelection.from, to: mainSelection.to, insert },
    selection: { anchor: mainSelection.from + insert.length },
    userEvent: "input",
  });
  view.focus();
}

function toggleInlineCodeCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  replaceSelectionWithText(editorRef, (selectedText) => {
    if (selectedText.length === 0) {
      return { insert: "``", selection: { anchor: 1, head: 1 } };
    }

    if (selectedText.startsWith("`") && selectedText.endsWith("`") && selectedText.length >= 2) {
      const insert = selectedText.slice(1, -1);
      return { insert, selection: { anchor: 0, head: insert.length } };
    }

    const insert = `\`${selectedText}\``;
    return { insert, selection: { anchor: 1, head: insert.length - 1 } };
  });
}

function insertCodeBlockCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  replaceSelectionWithText(editorRef, (selectedText) => {
    if (selectedText.length > 0) {
      const insert = `\`\`\`\n${selectedText}\n\`\`\``;
      return { insert, selection: { anchor: 4, head: 4 + selectedText.length } };
    }

    return { insert: "```\n\n```", selection: { anchor: 4, head: 4 } };
  });
}

const MarkdownRichEditor = forwardRef<MarkdownRichEditorHandle, MarkdownRichEditorProps>(
  (
    {
      markdown,
      onChange,
      onUserEdit,
      ariaLabel,
      theme,
      autoFocus = false,
      readOnly = false,
      className,
      searchText = "",
      searchOpen = false,
      searchAutoNavigate = true,
      onSearchStateChange,
    },
    ref
  ) => {
    const editorRef = useRef<SourceTextEditorHandle | null>(null);
    const previousSearchRequestRef = useRef<{ searchText: string; searchOpen: boolean } | null>(null);
    const extensions = useMemo(() => buildMarkdownEditorExtensions(theme), [theme]);

    const reportSearchState = useCallback(() => {
      if (!onSearchStateChange) {
        return;
      }

      const metrics = countSearchMatches(editorRef);
      onSearchStateChange({
        searchText: searchOpen ? searchText : "",
        searchMatches: searchOpen ? metrics.matches : 0,
        currentMatch: searchOpen ? metrics.currentMatch : 0,
        isSearchOpen: searchOpen,
        isSearchable: metrics.isSearchable,
        viewMode: "source",
      });
    }, [onSearchStateChange, searchOpen, searchText]);

    useEffect(() => {
      const currentRequest = { searchText, searchOpen };
      const previousRequest = previousSearchRequestRef.current;
      previousSearchRequestRef.current = currentRequest;

      if (!searchOpen || searchText.trim().length === 0) {
        updateSearchQuery(editorRef, "");
        reportSearchState();
        return;
      }

      updateSearchQuery(editorRef, searchText);

      const shouldJumpToFirstResult =
        searchAutoNavigate && (!previousRequest || previousRequest.searchText !== searchText || previousRequest.searchOpen !== searchOpen);

      if (shouldJumpToFirstResult) {
        editorRef.current?.runCommand(findNext);
      }

      reportSearchState();
    }, [reportSearchState, searchAutoNavigate, searchOpen, searchText]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
        },
        flushPendingEdits: async () => {},
        getCanonicalMarkdown: () => getCurrentDoc(editorRef),
        getPrimarySelectionText: () => editorRef.current?.getPrimarySelectionText() ?? "",
        preserveSelection: () => {
          editorRef.current?.preserveSelection();
        },
        restorePreservedSelection: () => editorRef.current?.restorePreservedSelection() ?? false,
        focusCurrentSearchResult: () => {
          const view = editorRef.current?.getView();

          if (!view) {
            return false;
          }

          view.focus();
          return true;
        },
        nextSearchResult: () => {
          editorRef.current?.runCommand(findNext);
          reportSearchState();
        },
        previousSearchResult: () => {
          editorRef.current?.runCommand(findPrevious);
          reportSearchState();
        },
        createLink: () => {
          createLinkCommand(editorRef);
          reportSearchState();
        },
        insertTable: () => {
          insertTableCommand(editorRef);
          reportSearchState();
        },
        insertThematicBreak: () => {
          insertThematicBreakCommand(editorRef);
          reportSearchState();
        },
        toggleInlineCode: () => {
          toggleInlineCodeCommand(editorRef);
          reportSearchState();
        },
        insertCodeBlock: () => {
          insertCodeBlockCommand(editorRef);
          reportSearchState();
        },
      }),
      [reportSearchState]
    );

    return (
      <SourceTextEditor
        ref={editorRef}
        className={className}
        value={markdown}
        extensions={extensions}
        readOnly={readOnly}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
        onChange={(nextValue) => {
          onChange(nextValue);
        }}
        onUserEdit={onUserEdit}
        onUpdate={() => {
          reportSearchState();
        }}
      />
    );
  }
);

MarkdownRichEditor.displayName = "MarkdownRichEditor";

export default MarkdownRichEditor;
