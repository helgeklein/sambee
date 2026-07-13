import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { findNext, findPrevious } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildPassiveSearchHighlightExtension } from "../Editor/buildCodeMirrorSearchHighlights";
import { buildSelectionLayerExtension } from "../Editor/buildEditorSelectionLayer";
import { buildCommonEditorExtensions } from "../Editor/buildCommonEditorExtensions";
import { buildTextEditorTheme, type TextEditorThemeOptions } from "../Editor/buildTextEditorTheme";
import { SourceTextEditor } from "../Editor/SourceTextEditor";
import type { SourceTextEditorHandle } from "../Editor/sourceTextEditorTypes";
import { getRootSearchMetrics, shouldAutoNavigateSearch, updateRootSearchQuery } from "./markdownEditorSearch";

export interface TextCodeEditorHandle {
  focus: () => void;
  flushPendingEdits: () => Promise<void>;
  getCanonicalText: () => string;
  getPrimarySelectionText: () => string;
  preserveSelection: () => void;
  restorePreservedSelection: () => boolean;
  focusCurrentSearchResult: () => boolean;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
}

export interface TextCodeEditorSearchState {
  searchText: string;
  searchMatches: number;
  currentMatch: number;
  isSearchOpen: boolean;
  isSearchable: boolean;
  viewMode: "source";
}

export interface TextCodeEditorProps {
  text: string;
  filename: string;
  onChange: (text: string) => void;
  onUserEdit?: () => void;
  ariaLabel: string;
  theme: TextEditorThemeOptions;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  searchText?: string;
  searchOpen?: boolean;
  searchAutoNavigate?: boolean;
  onSearchStateChange?: (state: TextCodeEditorSearchState) => void;
}

const EMPTY_EXTENSIONS: Extension[] = [];

export const TextCodeEditor = forwardRef<TextCodeEditorHandle, TextCodeEditorProps>(
  (
    {
      text,
      filename,
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
    const [languageExtensions, setLanguageExtensions] = useState<Extension[]>(EMPTY_EXTENSIONS);
    const previousSearchRequestRef = useRef<{ searchText: string; searchOpen: boolean } | null>(null);
    const extensions = useMemo(
      () => [
        ...buildCommonEditorExtensions({ drawSelection: false, highlightSelectionMatches: false, lineWrapping: false }),
        ...buildTextEditorTheme(theme),
        buildSelectionLayerExtension(),
        buildPassiveSearchHighlightExtension(),
        ...languageExtensions,
      ],
      [languageExtensions, theme]
    );

    useEffect(() => {
      let cancelled = false;
      const languageDescription = LanguageDescription.matchFilename(languages, filename);

      if (!languageDescription) {
        setLanguageExtensions(EMPTY_EXTENSIONS);
        return;
      }

      void languageDescription
        .load()
        .then((support) => {
          if (cancelled) {
            return;
          }

          setLanguageExtensions([support]);
        })
        .catch(() => {
          if (!cancelled) {
            setLanguageExtensions(EMPTY_EXTENSIONS);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [filename]);

    const reportSearchState = useCallback(() => {
      if (!onSearchStateChange) {
        return;
      }

      const metrics = getRootSearchMetrics(editorRef.current?.getView());
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
        updateRootSearchQuery(editorRef.current?.getView(), "");
        reportSearchState();
        return;
      }

      updateRootSearchQuery(editorRef.current?.getView(), searchText);

      if (shouldAutoNavigateSearch(previousRequest, currentRequest, searchAutoNavigate)) {
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
        getCanonicalText: () => editorRef.current?.getValue() ?? text,
        getPrimarySelectionText: () => editorRef.current?.getPrimarySelectionText() ?? "",
        preserveSelection: () => {
          editorRef.current?.preserveSelection();
        },
        restorePreservedSelection: () => editorRef.current?.restorePreservedSelection() ?? false,
        focusCurrentSearchResult: () => {
          editorRef.current?.focus();
          return editorRef.current?.getView()?.hasFocus ?? false;
        },
        nextSearchResult: () => {
          editorRef.current?.runCommand(findNext);
          reportSearchState();
        },
        previousSearchResult: () => {
          editorRef.current?.runCommand(findPrevious);
          reportSearchState();
        },
      }),
      [reportSearchState, text]
    );

    return (
      <SourceTextEditor
        ref={editorRef}
        className={className}
        value={text}
        extensions={extensions}
        readOnly={readOnly}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
        onChange={onChange}
        onUserEdit={onUserEdit}
      />
    );
  }
);

TextCodeEditor.displayName = "TextCodeEditor";
