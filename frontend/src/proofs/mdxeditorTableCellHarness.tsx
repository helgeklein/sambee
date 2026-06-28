import "@mdxeditor/editor/style.css";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { addTableCellEditorChild$, MDXEditor, type MDXEditorMethods, realmPlugin, tablePlugin } from "@mdxeditor/editor";
import {
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

const INITIAL_MARKDOWN = "| Col 1 | Col 2 |\n| --- | --- |\n| A1<br /><br />A3 | B1 |\n";

type NodeSummary = {
  key: string;
  type: string;
  text: string;
  isElement: boolean;
  isText: boolean;
  parentKey: string | null;
  parentType: string | null;
  prevKey: string | null;
  prevType: string | null;
  nextKey: string | null;
  nextType: string | null;
  topLevelKey: string | null;
  topLevelType: string | null;
  topLevelError: string | null;
};

type SelectionSummary = {
  kind: "range" | "other" | "none";
  isCollapsed?: boolean;
  anchor?: {
    key: string;
    offset: number;
    type: string;
    node: NodeSummary;
  };
  focus?: {
    key: string;
    offset: number;
    type: string;
    node: NodeSummary;
  };
};

type HarnessEntry = {
  reason: string;
  payload: string | null;
  markdown: string;
  selection: SelectionSummary;
  domSelection: {
    anchorNodeName: string | null;
    anchorOffset: number | null;
    focusNodeName: string | null;
    focusOffset: number | null;
  };
};

type HarnessState = {
  latestMarkdown: string;
  log: HarnessEntry[];
};

declare global {
  interface Window {
    __MDX_TABLE_CELL_HARNESS__?: {
      getState: () => HarnessState;
      clearLog: () => void;
      focusEditor: () => void;
    };
    __MDX_TABLE_CELL_HARNESS_PLUGIN__?: {
      initCount: number;
      renderCount: number;
    };
  }
}

const harnessState: HarnessState = {
  latestMarkdown: INITIAL_MARKDOWN,
  log: [],
};

function summarizeNode(node: LexicalNode): NodeSummary {
  const parent = node.getParent();
  const prevSibling = node.getPreviousSibling();
  const nextSibling = node.getNextSibling();
  let topLevelKey: string | null = null;
  let topLevelType: string | null = null;
  let topLevelError: string | null = null;

  try {
    const topLevel = node.getTopLevelElementOrThrow();
    topLevelKey = topLevel.getKey();
    topLevelType = topLevel.getType();
  } catch (error) {
    topLevelError = error instanceof Error ? error.message : String(error);
  }

  return {
    key: node.getKey(),
    type: node.getType(),
    text: node.getTextContent(),
    isElement: $isElementNode(node),
    isText: $isTextNode(node),
    parentKey: parent?.getKey() ?? null,
    parentType: parent?.getType() ?? null,
    prevKey: prevSibling?.getKey() ?? null,
    prevType: prevSibling?.getType() ?? null,
    nextKey: nextSibling?.getKey() ?? null,
    nextType: nextSibling?.getType() ?? null,
    topLevelKey,
    topLevelType,
    topLevelError,
  };
}

function summarizeSelection(selection: RangeSelection | null): SelectionSummary {
  if (selection === null) {
    return { kind: "none" };
  }

  if (!$isRangeSelection(selection)) {
    return { kind: "other" };
  }

  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();

  return {
    kind: "range",
    isCollapsed: selection.isCollapsed(),
    anchor: {
      key: selection.anchor.key,
      offset: selection.anchor.offset,
      type: selection.anchor.type,
      node: summarizeNode(anchorNode),
    },
    focus: {
      key: selection.focus.key,
      offset: selection.focus.offset,
      type: selection.focus.type,
      node: summarizeNode(focusNode),
    },
  };
}

function captureEntry(editor: LexicalEditor, reason: string, payload: string | null, getMarkdown: () => string) {
  let selectionSummary: SelectionSummary = { kind: "none" };

  editor.getEditorState().read(() => {
    const selection = $getSelection();
    selectionSummary = $isRangeSelection(selection) ? summarizeSelection(selection) : { kind: selection === null ? "none" : "other" };
  });

  const domSelection = window.getSelection();

  harnessState.latestMarkdown = getMarkdown();
  harnessState.log.push({
    reason,
    payload,
    markdown: harnessState.latestMarkdown,
    selection: selectionSummary,
    domSelection: {
      anchorNodeName: domSelection?.anchorNode?.nodeName ?? null,
      anchorOffset: domSelection?.anchorOffset ?? null,
      focusNodeName: domSelection?.focusNode?.nodeName ?? null,
      focusOffset: domSelection?.focusOffset ?? null,
    },
  });
}

function getAdjacentImportedBreakTarget(selection: RangeSelection): LexicalNode | null {
  if (!selection.isCollapsed()) {
    return null;
  }

  if (selection.anchor.type !== "element" || selection.focus.type !== "element") {
    return null;
  }

  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();

  if (anchorNode !== focusNode || anchorNode.getType() !== "generic-html") {
    return null;
  }

  const previousSibling = anchorNode.getPreviousSibling();
  const nextSibling = anchorNode.getNextSibling();

  if (previousSibling?.getType() !== "generic-html" || nextSibling?.getType() !== "text") {
    return null;
  }

  return anchorNode;
}

function TableCellSelectionProbe({ getMarkdown }: { getMarkdown: () => string }) {
  const [editor] = useLexicalComposerContext();

  if (typeof window !== "undefined") {
    window.__MDX_TABLE_CELL_HARNESS_PLUGIN__ ??= { initCount: 0, renderCount: 0 };
    window.__MDX_TABLE_CELL_HARNESS_PLUGIN__.renderCount += 1;
  }

  useEffect(() => {
    const handleBeforeInput = (event: InputEvent) => {
      captureEntry(editor, "beforeinput", typeof event.data === "string" ? event.data : null, getMarkdown);
    };

    captureEntry(editor, "probe-mounted", null, getMarkdown);

    const unregisterRootListener = editor.registerRootListener((nextRootElement, prevRootElement) => {
      prevRootElement?.removeEventListener("beforeinput", handleBeforeInput, true);
      nextRootElement?.addEventListener("beforeinput", handleBeforeInput, true);
    });

    const unregisterInsertion = editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (payload) => {
        captureEntry(editor, "controlled-text-insertion", typeof payload === "string" ? payload : null, getMarkdown);

        if (typeof payload === "string") {
          const selection = $getSelection();

          if ($isRangeSelection(selection)) {
            const importedBreakTarget = getAdjacentImportedBreakTarget(selection);

            if (importedBreakTarget !== null) {
              const textNode = $createTextNode(payload);
              importedBreakTarget.insertBefore(textNode);
              textNode.selectEnd();
              captureEntry(editor, "patched-adjacent-break-insertion", payload, getMarkdown);
              return true;
            }
          }
        }

        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        captureEntry(editor, "selection-change", null, getMarkdown);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    return () => {
      const rootElement = editor.getRootElement();
      rootElement?.removeEventListener("beforeinput", handleBeforeInput, true);
      unregisterRootListener();
      unregisterInsertion();
      unregisterSelection();
    };
  }, [editor, getMarkdown]);

  return <span data-testid="table-cell-probe" hidden />;
}

function createProbePlugin(getMarkdown: () => string) {
  const ProbeChild = () => <TableCellSelectionProbe getMarkdown={getMarkdown} />;

  return realmPlugin({
    init(realm) {
      if (typeof window !== "undefined") {
        window.__MDX_TABLE_CELL_HARNESS_PLUGIN__ ??= { initCount: 0, renderCount: 0 };
        window.__MDX_TABLE_CELL_HARNESS_PLUGIN__.initCount += 1;
      }
      realm.pub(addTableCellEditorChild$, ProbeChild);
    },
  });
}

function HarnessApp() {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const [markdown, setMarkdown] = useState(INITIAL_MARKDOWN);

  const probePluginFactory = useMemo(
    () =>
      createProbePlugin(() => {
        return editorRef.current?.getMarkdown() ?? markdown;
      }),
    [markdown]
  );

  useEffect(() => {
    harnessState.latestMarkdown = markdown;

    window.__MDX_TABLE_CELL_HARNESS__ = {
      getState: () => ({
        latestMarkdown: editorRef.current?.getMarkdown() ?? harnessState.latestMarkdown,
        log: [...harnessState.log],
      }),
      clearLog: () => {
        harnessState.log = [];
      },
      focusEditor: () => {
        editorRef.current?.focus(undefined, { defaultSelection: "rootEnd", preventScroll: true });
      },
    };

    return () => {
      delete window.__MDX_TABLE_CELL_HARNESS__;
    };
  }, [markdown]);

  return (
    <main style={{ margin: "0 auto", maxWidth: 960, padding: 24 }}>
      <h1 style={{ fontFamily: "sans-serif" }}>MDXEditor Table Cell Harness</h1>
      <p style={{ fontFamily: "sans-serif" }}>Standalone package-owned repro for loaded empty internal table-cell lines.</p>
      <MDXEditor
        ref={editorRef}
        markdown={INITIAL_MARKDOWN}
        onChange={(nextMarkdown) => {
          harnessState.latestMarkdown = nextMarkdown;
          setMarkdown(nextMarkdown);
        }}
        plugins={[tablePlugin(), probePluginFactory()]}
      />
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Expected root element to exist");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HarnessApp />
  </React.StrictMode>
);
