import { findNext, findPrevious, replaceAll, replaceNext } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { insertEmptyMarkdownTable } from "codemirror-markdown-tables";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildMarkdownEditorExtensions } from "../Editor/buildMarkdownEditorExtensions";
import type { MarkdownEditorThemeOptions } from "../Editor/buildMarkdownEditorTheme";
import { SourceTextEditor } from "../Editor/SourceTextEditor";
import type { SourceTextEditorHandle } from "../Editor/sourceTextEditorTypes";
import {
  getCodeMirrorFindReplaceMetrics,
  shouldAutoNavigateCodeMirrorFindReplace,
  updateCodeMirrorFindReplaceQuery,
} from "./codeMirrorFindReplace";
import {
  normalizeMarkdownTableCellLineBreaks,
  prepareMarkdownTableCellLineBreaksForEditor,
  preserveUnchangedMarkdownTableSource,
} from "./markdownTableCellLineBreaks";

const insertDefaultMarkdownTable = insertEmptyMarkdownTable({
  size: { rows: 2, cols: 2 },
});

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
  replaceAllSearchResults: () => void;
  replaceCurrentSearchResult: () => void;
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

export interface MarkdownRichEditorSearchState {
  searchText: string;
  searchMatches: number;
  currentMatch: number;
  isSearchOpen: boolean;
  isSearchable: boolean;
  isValid: boolean;
  viewMode: "rich-text" | "source" | "diff";
}

export interface MarkdownRichEditorProps {
  markdown: string;
  diffMarkdown?: string;
  onChange: (markdown: string) => void;
  onUserEdit?: (viewUpdate?: ViewUpdate) => void;
  ariaLabel: string;
  theme: MarkdownEditorThemeOptions;
  autoFocus?: boolean;
  readOnly?: boolean;
  lineWrapping?: boolean;
  className?: string;
  searchText?: string;
  searchOpen?: boolean;
  searchAutoNavigate?: boolean;
  searchCaseSensitive?: boolean;
  searchRegexp?: boolean;
  searchReplaceText?: string;
  searchWholeWord?: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
}

interface NestedPublicationState {
  observedGeneration: number;
  publishedGeneration: number;
  pendingPromise: Promise<void> | null;
  resolvePending: (() => void) | null;
}

function normalizeTableCellBreaksIfNeeded(markdown: string): string {
  return markdown.includes("<br") ? normalizeMarkdownTableCellLineBreaks(markdown) : markdown;
}

function getCurrentDoc(editorRef: React.RefObject<SourceTextEditorHandle | null>, previousMarkdown: string): string {
  return preserveUnchangedMarkdownTableSource(previousMarkdown, normalizeTableCellBreaksIfNeeded(editorRef.current?.getValue() ?? ""));
}

function getEventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Text) {
    return target.parentElement;
  }

  return null;
}

function replaceSelectionWithText(
  editorRef: React.RefObject<SourceTextEditorHandle | null>,
  getInsert: (
    selectedText: string,
    adjacentText: { before: string; after: string }
  ) => { insert: string; selection: { anchor: number; head: number }; replaceFromOffset?: number; replaceToOffset?: number }
): void {
  const view = editorRef.current?.getView();

  if (!view) {
    return;
  }

  const mainSelection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(mainSelection.from, mainSelection.to);
  const adjacentText = {
    before: view.state.sliceDoc(0, mainSelection.from),
    after: view.state.sliceDoc(mainSelection.to),
  };
  const nextValue = getInsert(selectedText, adjacentText);
  const replaceFrom = mainSelection.from + (nextValue.replaceFromOffset ?? 0);
  const replaceTo = mainSelection.to + (nextValue.replaceToOffset ?? 0);

  view.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert: nextValue.insert },
    selection: EditorSelection.range(replaceFrom + nextValue.selection.anchor, replaceFrom + nextValue.selection.head),
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
  const view = editorRef.current?.getView();

  if (!view) {
    return;
  }

  insertDefaultMarkdownTable({
    state: view.state,
    dispatch: view.dispatch.bind(view),
  });
  view.focus();
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

function toggleDelimitedMarkdownCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>, delimiter: string): void {
  replaceSelectionWithText(editorRef, (selectedText, adjacentText) => {
    if (selectedText.length === 0) {
      return { insert: `${delimiter}${delimiter}`, selection: { anchor: delimiter.length, head: delimiter.length } };
    }

    if (selectedText.startsWith(delimiter) && selectedText.endsWith(delimiter) && selectedText.length >= delimiter.length * 2) {
      const insert = selectedText.slice(delimiter.length, -delimiter.length);
      return { insert, selection: { anchor: 0, head: insert.length } };
    }

    if (adjacentText.before.endsWith(delimiter) && adjacentText.after.startsWith(delimiter)) {
      return {
        insert: selectedText,
        selection: { anchor: 0, head: selectedText.length },
        replaceFromOffset: -delimiter.length,
        replaceToOffset: delimiter.length,
      };
    }

    const insert = `${delimiter}${selectedText}${delimiter}`;
    return { insert, selection: { anchor: delimiter.length, head: insert.length - delimiter.length } };
  });
}

function toggleBoldCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  toggleDelimitedMarkdownCommand(editorRef, "**");
}

function toggleItalicCommand(editorRef: React.RefObject<SourceTextEditorHandle | null>): void {
  toggleDelimitedMarkdownCommand(editorRef, "*");
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
      diffMarkdown,
      onChange,
      onUserEdit,
      ariaLabel,
      theme,
      autoFocus = false,
      readOnly = false,
      lineWrapping = true,
      className,
      searchText = "",
      searchOpen = false,
      searchAutoNavigate = true,
      searchCaseSensitive = false,
      searchRegexp = false,
      searchReplaceText = "",
      searchWholeWord = false,
      onSearchStateChange,
    },
    ref
  ) => {
    const editorRef = useRef<SourceTextEditorHandle | null>(null);
    const previousSearchRequestRef = useRef<{
      caseSensitive: boolean;
      regexp: boolean;
      searchText: string;
      searchOpen: boolean;
      wholeWord: boolean;
    } | null>(null);
    const lastPublishedCanonicalMarkdownRef = useRef<string | null>(null);
    const nestedPublicationStateRef = useRef<NestedPublicationState>({
      observedGeneration: 0,
      publishedGeneration: 0,
      pendingPromise: null,
      resolvePending: null,
    });
    const extensions = useMemo(() => buildMarkdownEditorExtensions(theme, lineWrapping), [lineWrapping, theme]);
    const [editorMarkdown, setEditorMarkdown] = useState(() => prepareMarkdownTableCellLineBreaksForEditor(markdown));

    useEffect(() => {
      if (markdown === lastPublishedCanonicalMarkdownRef.current) {
        return;
      }

      setEditorMarkdown(prepareMarkdownTableCellLineBreaksForEditor(markdown));
      lastPublishedCanonicalMarkdownRef.current = null;
    }, [markdown]);

    const markNestedPublicationPending = useCallback(() => {
      const publicationState = nestedPublicationStateRef.current;

      publicationState.observedGeneration += 1;

      if (publicationState.pendingPromise) {
        return;
      }

      publicationState.pendingPromise = new Promise<void>((resolve) => {
        publicationState.resolvePending = resolve;
      });
    }, []);

    const resolveNestedPublication = useCallback(() => {
      const publicationState = nestedPublicationStateRef.current;

      if (publicationState.observedGeneration <= publicationState.publishedGeneration) {
        return;
      }

      publicationState.publishedGeneration = publicationState.observedGeneration;
      const resolvePending = publicationState.resolvePending;
      publicationState.pendingPromise = null;
      publicationState.resolvePending = null;
      resolvePending?.();
    }, []);

    const flushNestedPublication = useCallback(async () => {
      const publicationState = nestedPublicationStateRef.current;

      if (publicationState.observedGeneration <= publicationState.publishedGeneration) {
        return;
      }

      await publicationState.pendingPromise;
    }, []);

    const handleChange = useCallback(
      (nextValue: string) => {
        resolveNestedPublication();
        setEditorMarkdown(nextValue);
        const canonicalMarkdown = normalizeTableCellBreaksIfNeeded(nextValue);
        lastPublishedCanonicalMarkdownRef.current = canonicalMarkdown;
        onChange(canonicalMarkdown);
      },
      [onChange, resolveNestedPublication]
    );

    const reportSearchState = useCallback(() => {
      if (!onSearchStateChange) {
        return;
      }

      const metrics = getCodeMirrorFindReplaceMetrics(editorRef.current?.getView());
      onSearchStateChange({
        searchText: searchOpen ? searchText : "",
        searchMatches: searchOpen ? metrics.matches : 0,
        currentMatch: searchOpen ? metrics.currentMatch : 0,
        isSearchOpen: searchOpen,
        isSearchable: metrics.isSearchable,
        isValid: metrics.isValid,
        viewMode: "source",
      });
    }, [onSearchStateChange, searchOpen, searchText]);

    useEffect(() => {
      const currentRequest = {
        caseSensitive: searchCaseSensitive,
        regexp: searchRegexp,
        searchText,
        searchOpen,
        wholeWord: searchWholeWord,
      };
      const previousRequest = previousSearchRequestRef.current;
      previousSearchRequestRef.current = currentRequest;

      if (!searchOpen || searchText.trim().length === 0) {
        updateCodeMirrorFindReplaceQuery(editorRef.current?.getView(), {
          caseSensitive: searchCaseSensitive,
          regexp: searchRegexp,
          replace: searchReplaceText,
          searchText: "",
          wholeWord: searchWholeWord,
        });
        reportSearchState();
        return;
      }

      updateCodeMirrorFindReplaceQuery(editorRef.current?.getView(), {
        caseSensitive: searchCaseSensitive,
        regexp: searchRegexp,
        replace: searchReplaceText,
        searchText,
        wholeWord: searchWholeWord,
      });

      const shouldJumpToFirstResult = shouldAutoNavigateCodeMirrorFindReplace(previousRequest, currentRequest, searchAutoNavigate);

      if (shouldJumpToFirstResult) {
        editorRef.current?.runCommand(findNext);
      }

      reportSearchState();
    }, [
      reportSearchState,
      searchAutoNavigate,
      searchCaseSensitive,
      searchOpen,
      searchRegexp,
      searchReplaceText,
      searchText,
      searchWholeWord,
    ]);

    useEffect(() => {
      const rootView = editorRef.current?.getView();

      if (!rootView) {
        return;
      }

      const handlePotentialNestedEdit = (event: Event) => {
        const targetElement = getEventTargetElement(event.target);

        if (!targetElement || !rootView.dom.contains(targetElement) || !targetElement.closest(".tbl-cell-editor")) {
          return;
        }

        markNestedPublicationPending();
      };

      rootView.dom.addEventListener("beforeinput", handlePotentialNestedEdit, true);
      rootView.dom.addEventListener("compositionend", handlePotentialNestedEdit, true);
      rootView.dom.addEventListener("paste", handlePotentialNestedEdit, true);
      rootView.dom.addEventListener("cut", handlePotentialNestedEdit, true);

      return () => {
        rootView.dom.removeEventListener("beforeinput", handlePotentialNestedEdit, true);
        rootView.dom.removeEventListener("compositionend", handlePotentialNestedEdit, true);
        rootView.dom.removeEventListener("paste", handlePotentialNestedEdit, true);
        rootView.dom.removeEventListener("cut", handlePotentialNestedEdit, true);
        nestedPublicationStateRef.current.resolvePending?.();
        nestedPublicationStateRef.current.pendingPromise = null;
        nestedPublicationStateRef.current.resolvePending = null;
        nestedPublicationStateRef.current.publishedGeneration = nestedPublicationStateRef.current.observedGeneration;
      };
    }, [markNestedPublicationPending]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
        },
        flushPendingEdits: flushNestedPublication,
        getCanonicalMarkdown: () => getCurrentDoc(editorRef, diffMarkdown ?? markdown),
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
          editorRef.current?.getView()?.focus();
          editorRef.current?.runCommand(findNext);
          reportSearchState();
        },
        previousSearchResult: () => {
          editorRef.current?.getView()?.focus();
          editorRef.current?.runCommand(findPrevious);
          reportSearchState();
        },
        replaceCurrentSearchResult: () => {
          editorRef.current?.runCommand(replaceNext);
          reportSearchState();
        },
        replaceAllSearchResults: () => {
          editorRef.current?.runCommand(replaceAll);
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
        toggleBold: () => {
          toggleBoldCommand(editorRef);
          reportSearchState();
        },
        toggleItalic: () => {
          toggleItalicCommand(editorRef);
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
      [diffMarkdown, flushNestedPublication, markdown, reportSearchState]
    );

    return (
      <SourceTextEditor
        ref={editorRef}
        className={className}
        value={editorMarkdown}
        extensions={extensions}
        readOnly={readOnly}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
        onChange={handleChange}
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
