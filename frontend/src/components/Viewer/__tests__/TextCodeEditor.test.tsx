import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import type { TextEditorThemeOptions } from "../../Editor/buildTextEditorTheme";
import { TextCodeEditor, type TextCodeEditorHandle } from "../TextCodeEditor";

const TEST_TEXT_THEME: TextEditorThemeOptions = {
  accentColor: "rgb(194, 68, 0)",
  activeLineBackground: "rgba(244, 196, 48, 0.18)",
  borderColor: "rgba(31, 38, 43, 0.16)",
  isDarkMode: false,
  otherSearchMatchBackground: "rgba(244, 196, 48, 0.18)",
  currentSearchMatchBackground: "rgba(244, 196, 48, 0.42)",
  selectionBackground: "rgba(194, 68, 0, 0.18)",
  surfaceBackground: "rgb(251, 249, 244)",
  textColor: "rgb(31, 38, 43)",
};

describe("TextCodeEditor", () => {
  it("reconfigures line wrapping without recreating the editor", async () => {
    const { rerender } = render(
      <TextCodeEditor
        ariaLabel="Text editor"
        filename="notes.txt"
        lineWrapping={false}
        onChange={() => {}}
        text="A long line"
        theme={TEST_TEXT_THEME}
      />
    );

    const editor = await screen.findByLabelText("Text editor");
    expect(editor).not.toHaveClass("cm-lineWrapping");

    rerender(
      <TextCodeEditor
        ariaLabel="Text editor"
        filename="notes.txt"
        lineWrapping={true}
        onChange={() => {}}
        text="A long line"
        theme={TEST_TEXT_THEME}
      />
    );

    await waitFor(() => {
      expect(editor).toHaveClass("cm-lineWrapping");
    });
    expect(editor).toHaveTextContent("A long line");
  });

  it("replaces the selected and remaining CodeMirror search matches", async () => {
    const editorRef = createRef<TextCodeEditorHandle>();

    render(
      <TextCodeEditor
        ref={editorRef}
        ariaLabel="Text editor"
        filename="notes.txt"
        onChange={() => {}}
        searchOpen={true}
        searchReplaceText="done"
        searchText="alpha"
        text="alpha beta alpha"
        theme={TEST_TEXT_THEME}
      />
    );

    const editor = await screen.findByLabelText("Text editor");

    expect(editor.closest(".cm-editor")?.querySelector(".cm-selectionLayer")).not.toBeNull();
    expect(editor.closest(".cm-editor")?.querySelector(".sambee-editor-selection-layer")).toBeNull();

    editorRef.current?.replaceCurrentSearchResult();

    await waitFor(() => {
      expect(editorRef.current?.getCanonicalText()).toBe("done beta alpha");
    });

    editorRef.current?.replaceAllSearchResults();

    await waitFor(() => {
      expect(editorRef.current?.getCanonicalText()).toBe("done beta done");
    });
  });
});
