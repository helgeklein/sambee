import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";

interface CommonEditorExtensionsOptions {
  defaultSyntaxHighlighting?: boolean;
  lineWrapping?: boolean;
}

export function buildCommonEditorExtensions({
  defaultSyntaxHighlighting = true,
  lineWrapping = false,
}: CommonEditorExtensionsOptions = {}): Extension[] {
  return [
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    closeBrackets(),
    indentOnInput(),
    ...(defaultSyntaxHighlighting ? [syntaxHighlighting(defaultHighlightStyle, { fallback: true })] : []),
    bracketMatching(),
    search({ top: true }),
    highlightSelectionMatches(),
    highlightActiveLine(),
    ...(lineWrapping ? [EditorView.lineWrapping] : []),
    keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
  ];
}
