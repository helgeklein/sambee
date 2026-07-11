import { type CompletionSource, startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorSelection, EditorState } from "@codemirror/state";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildCommonEditorExtensions } from "../buildCommonEditorExtensions";
import {
  buildMarkdownAutocompleteUi,
  createMarkdownSnippetAutocompleter,
  MARKDOWN_SNIPPET_COMPLETIONS,
} from "../buildMarkdownAutocomplete";
import { buildMarkdownEditorExtensions, getMarkdownSelectionLineSegments } from "../buildMarkdownEditorExtensions";
import type { MarkdownEditorThemeOptions } from "../buildMarkdownEditorTheme";
import { SourceTextEditor } from "../SourceTextEditor";
import type { SourceTextEditorHandle } from "../sourceTextEditorTypes";

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

describe("SourceTextEditor", () => {
  it("renders the initial value and reports user edits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<SourceTextEditor value="Hello" ariaLabel="Source editor" onChange={onChange} />);

    const editor = await screen.findByLabelText("Source editor");
    await user.click(editor);
    await user.keyboard("!");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("!");
  });

  it("preserves and restores selection through the imperative handle", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(<SourceTextEditor ref={editorRef} value="Hello world" ariaLabel="Source editor" onChange={() => {}} />);

    const editor = await screen.findByLabelText("Source editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view || !editorRef.current) {
      throw new Error("Expected editor view to be available");
    }

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    editorRef.current.preserveSelection();
    view.dispatch({ selection: { anchor: 11, head: 11 } });

    expect(editorRef.current.restorePreservedSelection()).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });

  it("retains undo history across controlled value updates", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    const ControlledEditor = () => {
      const [value, setValue] = useState("Hello");

      return (
        <SourceTextEditor
          ref={editorRef}
          value={value}
          extensions={buildCommonEditorExtensions()}
          ariaLabel="Controlled source editor"
          onChange={(nextValue) => setValue(nextValue)}
        />
      );
    };

    render(<ControlledEditor />);

    const editor = await screen.findByLabelText("Controlled source editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await user.keyboard("!");

    await waitFor(() => {
      expect(editor.textContent).toContain("Hello!");
    });

    expect(editorRef.current?.runCommand(undo)).toBe(true);

    await waitFor(() => {
      expect(editor.textContent).toContain("Hello");
      expect(editor.textContent).not.toContain("Hello!");
    });
  });

  it("applies custom content attributes to the editable element", async () => {
    render(
      <SourceTextEditor
        value="Hello"
        ariaLabel="Source editor"
        contentAttributes={{ spellcheck: "true", autocapitalize: "sentences" }}
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Source editor");

    expect(editor).toHaveAttribute("spellcheck", "true");
    expect(editor).toHaveAttribute("autocapitalize", "sentences");
  });

  it("closes bracket pairs while typing", async () => {
    const user = userEvent.setup();

    render(<SourceTextEditor value="" extensions={buildCommonEditorExtensions()} ariaLabel="Bracket editor" onChange={() => {}} />);

    const editor = await screen.findByLabelText("Bracket editor");
    await user.click(editor);
    await user.keyboard("(");

    await waitFor(() => {
      expect(editor.textContent).toBe("()");
    });
  });

  it("registers the expected markdown snippets", () => {
    expect(MARKDOWN_SNIPPET_COMPLETIONS.some((completion) => completion.label === "task")).toBe(true);
    expect(MARKDOWN_SNIPPET_COMPLETIONS.some((completion) => completion.label === "link")).toBe(true);
  });

  it("allows a language-data autocomplete provider to coexist with markdown snippets", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();
    const markdownLanguageSupport = markdown({ codeLanguages: languages });
    const sentinelAutocomplete: CompletionSource = (context) => {
      if (!context.explicit) {
        return null;
      }

      return {
        from: context.pos,
        options: [{ label: "sentinel-provider", type: "keyword" }],
      };
    };

    render(
      <SourceTextEditor
        ref={editorRef}
        value=""
        extensions={[
          buildMarkdownAutocompleteUi(),
          markdownLanguageSupport,
          markdownLanguageSupport.language.data.of({ autocomplete: createMarkdownSnippetAutocompleter() }),
          markdownLanguageSupport.language.data.of({ autocomplete: sentinelAutocomplete }),
        ]}
        ariaLabel="Autocomplete editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Autocomplete editor");
    await user.click(editor);

    expect(editorRef.current?.runCommand(startCompletion)).toBe(true);

    await waitFor(() => {
      expect(screen.getByText("sentinel-provider")).toBeInTheDocument();
      expect(screen.getByText("task")).toBeInTheDocument();
    });
  });

  it("shows table-size completions after typing a pipe on an empty line", async () => {
    const user = userEvent.setup();

    render(
      <SourceTextEditor
        value=""
        extensions={buildMarkdownEditorExtensions(TEST_MARKDOWN_THEME)}
        ariaLabel="Table autocomplete editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Table autocomplete editor");
    await user.click(editor);
    await user.keyboard("|");

    await waitFor(() => {
      expect(screen.getByText(/2×2/)).toBeInTheDocument();
      expect(screen.getByText(/3×3/)).toBeInTheDocument();
      expect(screen.queryByText(/^table$/i)).not.toBeInTheDocument();
    });
  });

  it("uses the custom markdown selection layer without CodeMirror block selection overlays", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SourceTextEditorHandle>();

    render(
      <SourceTextEditor
        ref={editorRef}
        value={["sfd", "* list 1", "  * list 1.1"].join("\n")}
        extensions={buildMarkdownEditorExtensions(TEST_MARKDOWN_THEME)}
        ariaLabel="Markdown selection editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Markdown selection editor");
    await user.click(editor);

    const view = editorRef.current?.getView();

    if (!view) {
      throw new Error("Expected editor view to be available");
    }

    view.dispatch({ selection: EditorSelection.range(0, 14) });

    await waitFor(() => {
      expect(editor.closest(".cm-editor")?.querySelectorAll(".cm-selectionBackground")).toHaveLength(0);
      expect(editor.closest(".cm-editor")?.querySelector(".sambee-markdown-selection-layer")).not.toBeNull();
    });
  });

  it("includes empty lines in markdown selection segments", () => {
    const state = EditorState.create({ doc: ["alpha", "", "beta"].join("\n") });

    expect(getMarkdownSelectionLineSegments(state.doc, { from: 0, to: state.doc.length })).toEqual([
      { from: 0, to: 5, emptyLine: false },
      { from: 6, to: 6, emptyLine: true },
      { from: 7, to: 11, emptyLine: false },
    ]);
  });

  it("applies the markdown theme colors to text, links, and the active line", async () => {
    const user = userEvent.setup();

    render(
      <SourceTextEditor
        value="* what's [text](https://stuff)"
        extensions={buildMarkdownEditorExtensions(TEST_MARKDOWN_THEME)}
        ariaLabel="Markdown themed editor"
        onChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("Markdown themed editor");
    await user.click(editor);

    const editorRoot = editor.closest(".cm-editor");
    const activeLine = editorRoot?.querySelector(".cm-activeLine");
    const linkToken = Array.from(editor.querySelectorAll("span")).find((element) => element.textContent?.includes("https://stuff"));

    if (!(editorRoot instanceof HTMLElement) || !(activeLine instanceof HTMLElement) || !(linkToken instanceof HTMLElement)) {
      throw new Error("Expected themed CodeMirror elements to be rendered");
    }

    expect(window.getComputedStyle(editor).color).toBe(TEST_MARKDOWN_THEME.textColor);
    expect(window.getComputedStyle(activeLine).backgroundColor).toBe(TEST_MARKDOWN_THEME.activeLineBackground);
    expect(window.getComputedStyle(linkToken).color).toBe(TEST_MARKDOWN_THEME.linkColor);
  });
});
