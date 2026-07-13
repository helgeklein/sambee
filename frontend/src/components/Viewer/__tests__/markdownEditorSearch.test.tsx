import { findNext, findPrevious, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  buildPassiveSearchHighlightExtension,
  PASSIVE_SEARCH_MATCH_CLASS,
  PASSIVE_SELECTED_SEARCH_MATCH_CLASS,
} from "../../Editor/buildCodeMirrorSearchHighlights";
import { buildCommonEditorExtensions } from "../../Editor/buildCommonEditorExtensions";
import { SourceTextEditor } from "../../Editor/SourceTextEditor";
import type { SourceTextEditorHandle } from "../../Editor/sourceTextEditorTypes";
import { getRootSearchMetrics, shouldAutoNavigateSearch, updateRootSearchQuery } from "../markdownEditorSearch";

describe("markdownEditorSearch", () => {
  it("counts root-editor matches and tracks the active match across navigation", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <SourceTextEditor
        ref={editorRef}
        value="alpha\nbeta alpha"
        extensions={buildCommonEditorExtensions()}
        ariaLabel="Search editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Search editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    updateRootSearchQuery(view, "alpha");

    expect(findNext(view)).toBe(true);

    await waitFor(() => {
      expect(getRootSearchMetrics(view)).toMatchObject({
        matches: 2,
        currentMatch: 1,
        searchText: "alpha",
        isSearchable: true,
      });
    });

    expect(findNext(view)).toBe(true);

    await waitFor(() => {
      expect(getRootSearchMetrics(view).currentMatch).toBe(2);
    });

    expect(findPrevious(view)).toBe(true);

    await waitFor(() => {
      expect(getRootSearchMetrics(view).currentMatch).toBe(1);
    });
  });

  it("keeps search metrics rooted in the editor view even when focus moves elsewhere", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <>
        <SourceTextEditor
          ref={editorRef}
          value="alpha\nbeta alpha"
          extensions={buildCommonEditorExtensions()}
          ariaLabel="Search editor"
          onChange={() => {}}
        />
        <input aria-label="External focus target" />
      </>
    );

    const editor = await screen.findByLabelText("Search editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    updateRootSearchQuery(view, "alpha");
    expect(findNext(view)).toBe(true);

    const input = await screen.findByLabelText("External focus target");
    await user.click(input);

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
      expect(getRootSearchMetrics(view)).toMatchObject({
        matches: 2,
        currentMatch: 1,
        searchText: "alpha",
      });
    });

    updateRootSearchQuery(view, "");

    await waitFor(() => {
      expect(getRootSearchMetrics(view)).toMatchObject({
        matches: 0,
        currentMatch: 0,
        searchText: "",
      });
    });
  });

  it("only auto-navigates when a newly opened or changed search request asks for it", () => {
    expect(shouldAutoNavigateSearch(null, { searchText: "alpha", searchOpen: true }, true)).toBe(true);
    expect(shouldAutoNavigateSearch({ searchText: "alpha", searchOpen: true }, { searchText: "alpha", searchOpen: true }, true)).toBe(
      false
    );
    expect(shouldAutoNavigateSearch({ searchText: "alpha", searchOpen: false }, { searchText: "alpha", searchOpen: true }, true)).toBe(
      true
    );
    expect(shouldAutoNavigateSearch({ searchText: "alpha", searchOpen: true }, { searchText: "beta", searchOpen: true }, true)).toBe(true);
    expect(shouldAutoNavigateSearch(null, { searchText: "alpha", searchOpen: true }, false)).toBe(false);
  });

  it("highlights passive matches while typing before native search navigation selects one", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <SourceTextEditor
        ref={editorRef}
        value="alpha\nbeta alpha"
        extensions={[...buildCommonEditorExtensions({ highlightSelectionMatches: false }), buildPassiveSearchHighlightExtension()]}
        ariaLabel="Search editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Search editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    updateRootSearchQuery(view, "alpha");

    await waitFor(() => {
      expect(editor.querySelectorAll(`.${PASSIVE_SEARCH_MATCH_CLASS}`)).toHaveLength(2);
      expect(editor.querySelectorAll(`.${PASSIVE_SELECTED_SEARCH_MATCH_CLASS}`)).toHaveLength(0);
    });

    expect(findNext(view)).toBe(true);

    await waitFor(() => {
      expect(editor.querySelectorAll(`.${PASSIVE_SELECTED_SEARCH_MATCH_CLASS}`)).toHaveLength(1);
      expect(editor.querySelectorAll(`.${PASSIVE_SEARCH_MATCH_CLASS}`)).toHaveLength(2);
      expect(editor.querySelectorAll(".cm-selectionMatch")).toHaveLength(0);
    });
  });

  it("treats the first contained match as current when the main selection is broader than the search hit", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <SourceTextEditor
        ref={editorRef}
        value="* list 1\n* list 2\n* list 3"
        extensions={[...buildCommonEditorExtensions({ highlightSelectionMatches: false }), buildPassiveSearchHighlightExtension()]}
        ariaLabel="Search editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Search editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    view.dispatch({
      selection: EditorSelection.range(0, 8),
    });

    updateRootSearchQuery(view, "li");

    await waitFor(() => {
      expect(getRootSearchMetrics(view)).toMatchObject({
        matches: 3,
        currentMatch: 1,
        searchText: "li",
      });
      expect(editor.querySelectorAll(`.${PASSIVE_SELECTED_SEARCH_MATCH_CLASS}`)).toHaveLength(1);
    });

    expect(findNext(view)).toBe(true);

    await waitFor(() => {
      expect(getRootSearchMetrics(view).currentMatch).toBe(2);
    });
  });

  it("keeps a current-match decoration when the search panel is open and the current match is only contained by the selection", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <SourceTextEditor
        ref={editorRef}
        value="* list 1\n* list 2\n* list 3"
        extensions={[...buildCommonEditorExtensions({ highlightSelectionMatches: false }), buildPassiveSearchHighlightExtension()]}
        ariaLabel="Search editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Search editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    view.dispatch({
      selection: EditorSelection.range(0, 8),
    });

    expect(openSearchPanel(view)).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(true);

    updateRootSearchQuery(view, "li");

    await waitFor(() => {
      expect(getRootSearchMetrics(view)).toMatchObject({
        matches: 3,
        currentMatch: 1,
        searchText: "li",
      });
      expect(editor.querySelectorAll(`.${PASSIVE_SELECTED_SEARCH_MATCH_CLASS}`)).toHaveLength(1);
      expect(editor.querySelectorAll(`.${PASSIVE_SEARCH_MATCH_CLASS}`)).toHaveLength(1);
    });
  });
});
