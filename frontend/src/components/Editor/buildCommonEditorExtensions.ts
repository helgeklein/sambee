import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { buildSelectionLayerExtension } from "./buildEditorSelectionLayer";

interface CommonEditorExtensionsOptions {
  defaultSyntaxHighlighting?: boolean;
  drawSelection?: boolean;
  highlightSelectionMatches?: boolean;
  lineWrapping?: boolean;
}

export function buildCommonEditorExtensions({
  defaultSyntaxHighlighting = true,
  drawSelection: includeDrawSelection = true,
  highlightSelectionMatches: includeSelectionMatches = true,
  lineWrapping = false,
}: CommonEditorExtensionsOptions = {}): Extension[] {
  return [
    history(),
    ...(includeDrawSelection ? [drawSelection()] : []),
    ...(includeDrawSelection ? [buildSelectionLayerExtension()] : []),
    EditorState.allowMultipleSelections.of(true),
    closeBrackets(),
    indentOnInput(),
    ...(defaultSyntaxHighlighting ? [syntaxHighlighting(defaultHighlightStyle, { fallback: true })] : []),
    bracketMatching(),
    search({ top: true }),
    ...(includeSelectionMatches ? [highlightSelectionMatches()] : []),
    highlightActiveLine(),
    ...(lineWrapping ? [EditorView.lineWrapping] : []),
    keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
  ];
}
