import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MarkdownEditorThemeOptions } from "../../Editor/buildMarkdownEditorTheme";
import MarkdownRichEditor, { type MarkdownRichEditorHandle, type MarkdownRichEditorSearchState } from "../MarkdownRichEditor";

const TEST_MARKDOWN_THEME: MarkdownEditorThemeOptions = {
  activeLineBackground: "rgba(244, 196, 48, 0.18)",
  borderColor: "rgba(31, 38, 43, 0.16)",
  linkColor: "rgb(194, 68, 0)",
  selectionBackground: "rgba(194, 68, 0, 0.18)",
  surfaceBackground: "rgb(251, 249, 244)",
  textColor: "rgb(31, 38, 43)",
};

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
    expect(editorRef.current?.getCanonicalMarkdown()).toContain("| Column 1 |");
    editorRef.current?.toggleInlineCode();
    editorRef.current?.insertCodeBlock();
    editorRef.current?.insertThematicBreak();
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
});
