import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MarkdownEditorThemeOptions } from "../../Editor/buildMarkdownEditorTheme";
import MarkdownRichEditor, { type MarkdownRichEditorHandle, type MarkdownRichEditorSearchState } from "../MarkdownRichEditor";

const TEST_MARKDOWN_THEME: MarkdownEditorThemeOptions = {
  activeLineBackground: "rgba(244, 196, 48, 0.18)",
  borderColor: "rgba(31, 38, 43, 0.16)",
  isDarkMode: false,
  linkColor: "rgb(194, 68, 0)",
  selectionBackground: "rgba(194, 68, 0, 0.18)",
  surfaceBackground: "rgb(251, 249, 244)",
  tableAlternateRowBackground: "rgb(245, 243, 238)",
  tableBackground: "rgb(251, 249, 244)",
  tableBorderColor: "rgb(212, 196, 174)",
  tableHeaderBackground: "rgb(234, 232, 227)",
  tableHeaderText: "rgb(31, 38, 43)",
  textColor: "rgb(31, 38, 43)",
};

function appendNestedEditorTarget(editor: HTMLElement): HTMLElement {
  const editorRoot = editor.closest(".cm-editor");

  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected the CodeMirror editor root to be rendered");
  }

  const nestedEditor = document.createElement("div");
  nestedEditor.className = "tbl-cell-editor";

  const nestedEditable = document.createElement("div");
  nestedEditable.contentEditable = "true";
  nestedEditable.setAttribute("role", "textbox");
  nestedEditor.appendChild(nestedEditable);
  editorRoot.appendChild(nestedEditor);

  return nestedEditable;
}

describe("MarkdownRichEditor", () => {
  it("reports source-mode search state and navigates matches", async () => {
    const states: MarkdownRichEditorSearchState[] = [];

    render(
      <MarkdownRichEditor
        markdown="alpha\nbeta alpha"
        ariaLabel="Markdown editor"
        theme={TEST_MARKDOWN_THEME}
        onChange={() => {}}
        searchText="alpha"
        searchOpen={true}
        onSearchStateChange={(state) => {
          states.push(state);
        }}
      />
    );

    await waitFor(() => {
      expect(states.length).toBeGreaterThan(0);
    });

    const latestState = states.at(-1);
    expect(latestState).toMatchObject({
      searchText: "alpha",
      isSearchOpen: true,
      isSearchable: true,
      viewMode: "source",
    });
    expect(latestState?.searchMatches).toBe(2);
  });

  it("supports the command bridge methods", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(
      <MarkdownRichEditor ref={editorRef} markdown="alpha" ariaLabel="Markdown editor" theme={TEST_MARKDOWN_THEME} onChange={onChange} />
    );

    const editor = await screen.findByLabelText("Markdown editor");
    await user.click(editor);

    editorRef.current?.createLink();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(editorRef.current?.getCanonicalMarkdown()).toContain("[");
    editorRef.current?.insertTable();
    expect(editorRef.current?.getCanonicalMarkdown()).toContain("|   |   |");
    expect(editorRef.current?.getCanonicalMarkdown()).toContain("| - | - |");
    expect(editorRef.current?.getCanonicalMarkdown()).not.toContain("Column 1");
    editorRef.current?.toggleInlineCode();
    editorRef.current?.insertCodeBlock();
    editorRef.current?.insertThematicBreak();
  });

  it("keeps canonical table-cell breaks at the editor boundary", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(
      <MarkdownRichEditor
        ref={editorRef}
        markdown={["| Column |", "| --- |", "| foo<br />bar |", "", "tail"].join("\n")}
        ariaLabel="Markdown editor"
        theme={TEST_MARKDOWN_THEME}
        onChange={onChange}
      />
    );

    const editor = await screen.findByLabelText("Markdown editor");
    await user.click(editor);
    await user.keyboard("!");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(editorRef.current?.getCanonicalMarkdown()).toContain("foo<br />bar");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("foo<br />bar");
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("foo<br>bar");
  });

  it("preserves unrelated markdown formatting while adapting table-cell breaks for the editor", async () => {
    const editorRef = createRef<MarkdownRichEditorHandle>();
    const markdown = ["Outside <br /> stays literal.", "", "* one", "* two", "", "| A |", "| - |", "| foo<br />bar |", ""].join("\n");

    render(
      <MarkdownRichEditor
        ref={editorRef}
        markdown={markdown}
        diffMarkdown={markdown}
        ariaLabel="Markdown editor"
        theme={TEST_MARKDOWN_THEME}
        onChange={() => {}}
      />
    );

    await screen.findByLabelText("Markdown editor");

    expect(editorRef.current?.getCanonicalMarkdown()).toBe(markdown);
  });

  it("keeps focus in the editor when tabbing indentation in markdown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(<MarkdownRichEditor ref={editorRef} markdown="" ariaLabel="Markdown editor" theme={TEST_MARKDOWN_THEME} onChange={onChange} />);

    const editor = await screen.findByLabelText("Markdown editor");
    await user.click(editor);

    await user.keyboard("{Tab}");

    await waitFor(() => {
      expect(editorRef.current?.getCanonicalMarkdown()).toBe("  ");
    });

    expect(document.activeElement).toBe(editor);

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    await waitFor(() => {
      expect(editorRef.current?.getCanonicalMarkdown()).toBe("");
    });

    expect(document.activeElement).toBe(editor);
  });

  it("waits for the next root publication after a nested table edit signal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(
      <MarkdownRichEditor ref={editorRef} markdown="alpha" ariaLabel="Markdown editor" theme={TEST_MARKDOWN_THEME} onChange={onChange} />
    );

    const editor = await screen.findByLabelText("Markdown editor");
    const nestedEditable = appendNestedEditorTarget(editor);

    nestedEditable.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: "x" }));

    let flushResolved = false;
    const flushPromise = editorRef.current?.flushPendingEdits().then(() => {
      flushResolved = true;
    });

    await Promise.resolve();
    expect(flushResolved).toBe(false);

    await user.click(editor);
    await user.keyboard("!");

    await flushPromise;

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(flushResolved).toBe(true);
    expect(editorRef.current?.getCanonicalMarkdown()).toContain("!");
  });

  it("keeps root search metrics and navigation authoritative while focus is inside a nested table editor subtree", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<MarkdownRichEditorHandle>();
    const states: MarkdownRichEditorSearchState[] = [];

    render(
      <MarkdownRichEditor
        ref={editorRef}
        markdown="alpha\nbeta alpha"
        ariaLabel="Markdown editor"
        theme={TEST_MARKDOWN_THEME}
        onChange={() => {}}
        searchText="alpha"
        searchOpen={true}
        onSearchStateChange={(state) => {
          states.push(state);
        }}
      />
    );

    const editor = await screen.findByLabelText("Markdown editor");
    const nestedEditable = appendNestedEditorTarget(editor);
    nestedEditable.focus();
    await user.click(nestedEditable);

    await waitFor(() => {
      expect(states.at(-1)).toMatchObject({
        searchText: "alpha",
        searchMatches: 2,
        currentMatch: 1,
        isSearchOpen: true,
      });
    });

    editorRef.current?.nextSearchResult();

    await waitFor(() => {
      expect(states.at(-1)?.currentMatch).toBe(2);
      expect(states.at(-1)?.searchMatches).toBe(2);
    });

    editorRef.current?.previousSearchResult();

    await waitFor(() => {
      expect(states.at(-1)?.currentMatch).toBe(1);
      expect(states.at(-1)?.searchMatches).toBe(2);
    });
  });
});
