import {
  $isCodeBlockNode,
  $isTableNode,
  activeEditor$,
  addTableCellEditorChild$,
  applyBlockType$,
  applyFormat$,
  applyListType$,
  BlockTypeSelect,
  ButtonWithTooltip,
  CodeMirrorEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  currentBlockType$,
  currentFormat$,
  currentListType$,
  diffSourcePlugin,
  editorInTable$,
  headingsPlugin,
  type IconKey,
  IS_APPLE,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_UNDERLINE,
  iconComponentFor$,
  insertCodeBlock$,
  insertTable$,
  insertThematicBreak$,
  ListsToggle,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  MultipleChoiceToggleGroup,
  markdownShortcutPlugin,
  lexicalTheme as mdxEditorLexicalTheme,
  markdown$ as mdxEditorMarkdown$,
  NESTED_EDITOR_UPDATED_COMMAND,
  quotePlugin,
  realmPlugin,
  rootEditor$,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCellValue,
  useEditorSearch,
  viewMode$,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { useCellValues, useCellValue as useGurxCellValue, usePublisher } from "@mdxeditor/gurx";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GlobalStyles,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";
import {
  $createNodeSelection,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type NodeKey,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  type ComponentProps,
  createContext,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MARKDOWN_EDITOR_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { useSambeeTheme } from "../../theme";
import {
  getSecondaryActionStripStyle,
  getSecondaryToolbarSelectedBackground,
  getSecondaryToolbarSurfaceColors,
} from "../../theme/commonStyles";
import { Z_INDEX } from "../../theme/constants";
import {
  getMarkdownCodeSurfaceColors,
  getMarkdownEditorContentStyles,
  getMarkdownTableSurfaceColors,
  getViewerColors,
  MARKDOWN_CONTENT_PADDING,
  MARKDOWN_TABLE_CELL_PADDING_BLOCK,
  MARKDOWN_TABLE_CELL_PADDING_INLINE,
  MARKDOWN_TABLE_FONT_SIZE,
  MARKDOWN_TABLE_HEADER_FONT_SIZE,
  MARKDOWN_TABLE_HEADER_LETTER_SPACING,
} from "../../theme/viewerStyles";
import { scheduleRetriableFocusRestore } from "./focusRestoration";
import { emitMarkdownDebugTrace } from "./markdownDebugTrace";
import { MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS } from "./markdownEditorConstants";
import { areMarkdownSearchStatesEqual } from "./markdownSearchState";
import { normalizeMarkdownTableCellLineBreaks } from "./markdownTableCellLineBreaks";
import { mdxEditorSearchPlugin } from "./mdxEditorSearchPlugin";
import { insertTextAtAdjacentImportedBreak } from "./tableCellAdjacentBreakInsertion";

const MARKDOWN_EDITOR_POPUP_CLASS = "sambee-markdown-editor-popup";
const MARKDOWN_EDITOR_POPUP_Z_INDEX = Z_INDEX.VIEWER_TOOLBAR + 1;
const MARKDOWN_EDITOR_CONTENT_CLASS = "sambee-markdown-editor-content";
const MARKDOWN_EDITOR_SOURCE_FONT_SIZE_PX = 15;
const MARKDOWN_TABLE_TOOL_OFFSET_PX = 4;
const MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX = 32;
const MARKDOWN_TABLE_TOOL_GUTTER_PX = MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX + MARKDOWN_TABLE_TOOL_OFFSET_PX * 2;
const NESTED_TABLE_CELL_EDITABLE_SELECTOR = 'table [contenteditable="true"][data-lexical-editor="true"]';
const MARKDOWN_CODE_BLOCK_DEFAULT_LANGUAGE = "txt";
const MARKDOWN_LINK_DIALOG_MAX_WIDTH = "sm";
const MARKDOWN_EDITOR_LEXICAL_THEME = mdxEditorLexicalTheme;
const MARKDOWN_CODE_BLOCK_LANGUAGES = {
  txt: "Plain text",
  css: "CSS",
  js: "JavaScript",
  jsx: "JavaScript (React)",
  ts: "TypeScript",
  tsx: "TypeScript (React)",
};

type TableCellDirection = "down" | "left" | "right" | "up";
type TableCellBoundaryDirection = Extract<TableCellDirection, "down" | "up">;

interface TableCellPosition {
  columnIndex: number;
  rowIndex: number;
  tableDecoratorElement: HTMLElement;
  tableElement: HTMLElement;
}

function getEditableCellElements(rowElement: HTMLElement): HTMLElement[] {
  return Array.from(rowElement.querySelectorAll('[contenteditable="true"][data-lexical-editor="true"]')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  );
}

function getLogicalTableCellEditable(tableElement: HTMLElement, coords: [number, number]): HTMLElement | null {
  const targetRow = getTableRowElements(tableElement)[coords[1]];

  if (!targetRow) {
    return null;
  }

  return getEditableCellElements(targetRow)[coords[0]] ?? null;
}

function getTableRowElements(tableElement: HTMLElement): HTMLTableRowElement[] {
  return Array.from(tableElement.querySelectorAll("tr")).filter(
    (row) => row.querySelector('[contenteditable="true"][data-lexical-editor="true"]') !== null
  );
}

function getTableCellPosition(cellEditable: HTMLElement): TableCellPosition | null {
  const tableDecoratorElement = cellEditable.closest("[data-lexical-decorator='true']");
  const tableElement = tableDecoratorElement?.querySelector("table");
  const cellElement = cellEditable.closest("th, td");
  const rowElement = cellElement?.closest("tr");

  if (
    !(tableDecoratorElement instanceof HTMLElement) ||
    !(tableElement instanceof HTMLElement) ||
    !(cellElement instanceof HTMLElement) ||
    !(rowElement instanceof HTMLElement)
  ) {
    return null;
  }

  const rowElements = getTableRowElements(tableElement);
  const rowIndex = rowElements.indexOf(rowElement);

  if (rowIndex < 0) {
    return null;
  }

  const rowEditables = getEditableCellElements(rowElement);
  const columnIndex = rowEditables.indexOf(cellEditable);

  if (columnIndex < 0) {
    return null;
  }

  return {
    columnIndex,
    rowIndex,
    tableDecoratorElement,
    tableElement,
  };
}

function isCaretAtEditableBoundary(element: HTMLElement, direction: TableCellBoundaryDirection, allowSingleLineFallback = false): boolean {
  const selection = window.getSelection();

  if (!selection?.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const selectionRange = selection.getRangeAt(0).cloneRange();

  if (!element.contains(selectionRange.startContainer)) {
    return false;
  }

  const prefixRange = document.createRange();
  const contentsRange = document.createRange();
  const startBoundaryRange = document.createRange();
  const endBoundaryRange = document.createRange();
  prefixRange.selectNodeContents(element);
  contentsRange.selectNodeContents(element);
  startBoundaryRange.selectNodeContents(element);
  startBoundaryRange.collapse(true);
  endBoundaryRange.selectNodeContents(element);
  endBoundaryRange.collapse(false);
  prefixRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);

  const elementTextLength = element.textContent?.length ?? 0;
  const caretTextOffset = prefixRange.toString().length;
  const textNodeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.textContent?.length ?? 0) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];

  while (textNodeWalker.nextNode()) {
    const currentNode = textNodeWalker.currentNode;

    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
  }

  const firstTextNode = textNodes[0];
  const lastTextNode = textNodes[textNodes.length - 1];
  const isAtFirstTextBoundary = selectionRange.startContainer === firstTextNode && selectionRange.startOffset === 0;
  const isAtLastTextBoundary =
    selectionRange.endContainer === lastTextNode && selectionRange.endOffset >= (lastTextNode?.textContent?.length ?? 0);

  const caretRect = getRangeBoundingRect(selectionRange);
  const elementRect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
  const hasVisualGeometry =
    caretRect !== null &&
    elementRect !== null &&
    (caretRect.height > 0 || caretRect.width > 0 || caretRect.top !== 0 || caretRect.bottom !== 0);

  if (hasVisualGeometry) {
    const boundaryTolerancePx = 4;

    if (direction === "up" && startBoundaryRange.compareBoundaryPoints(Range.START_TO_START, selectionRange) === 0) {
      return true;
    }

    if (direction === "down" && endBoundaryRange.compareBoundaryPoints(Range.END_TO_END, selectionRange) === 0) {
      return true;
    }

    if (direction === "up" && caretTextOffset === 0) {
      return true;
    }

    if (direction === "down" && caretTextOffset >= elementTextLength) {
      return true;
    }

    if (direction === "up" && isAtFirstTextBoundary) {
      return true;
    }

    if (direction === "down" && isAtLastTextBoundary) {
      return true;
    }

    return direction === "down"
      ? caretRect.bottom >= elementRect.bottom - boundaryTolerancePx
      : caretRect.top <= elementRect.top + boundaryTolerancePx;
  }

  if (allowSingleLineFallback && getRangeClientRectCount(contentsRange) <= 1) {
    return true;
  }

  if (direction === "up" && isAtFirstTextBoundary) {
    return true;
  }

  if (direction === "down" && isAtLastTextBoundary) {
    return true;
  }

  return direction === "down" ? caretTextOffset >= elementTextLength : caretTextOffset === 0;
}

function isCaretAtEditableHorizontalBoundary(element: HTMLElement, direction: Extract<TableCellDirection, "left" | "right">): boolean {
  const selection = window.getSelection();

  if (!selection?.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const selectionRange = selection.getRangeAt(0).cloneRange();

  if (!element.contains(selectionRange.startContainer)) {
    return false;
  }

  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(element);
  prefixRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);

  const elementTextLength = element.textContent?.length ?? 0;
  const caretTextOffset = prefixRange.toString().length;

  return direction === "right" ? caretTextOffset >= elementTextLength : caretTextOffset === 0;
}

function moveWithinTableByArrow(cellEditable: HTMLElement, direction: TableCellDirection): boolean {
  const position = getTableCellPosition(cellEditable);

  if (!position) {
    return false;
  }

  if ((direction === "left" || direction === "right") && !isCaretAtEditableHorizontalBoundary(cellEditable, direction)) {
    return false;
  }

  if ((direction === "up" || direction === "down") && !isCaretAtEditableBoundary(cellEditable, direction, true)) {
    return false;
  }

  const targetCoords: [number, number] | null =
    direction === "left"
      ? position.columnIndex > 0
        ? [position.columnIndex - 1, position.rowIndex]
        : null
      : direction === "right"
        ? [position.columnIndex + 1, position.rowIndex]
        : direction === "up"
          ? position.rowIndex > 0
            ? [position.columnIndex, position.rowIndex - 1]
            : null
          : [position.columnIndex, position.rowIndex + 1];

  if (!targetCoords) {
    return false;
  }

  if (getLogicalTableCellEditable(position.tableElement, targetCoords) === null) {
    return false;
  }

  const attemptMove = () => focusLogicalTableCell(position.tableElement, targetCoords, direction);

  window.requestAnimationFrame(() => {
    if (attemptMove()) {
      scheduleRetriableFocusRestore({
        delaysMs: [16, 48, 120],
        attemptRestore: attemptMove,
      });
      return;
    }

    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48, 120],
      attemptRestore: attemptMove,
    });
  });

  return true;
}

function moveOutOfTableVertically(
  rootEditor: LexicalEditor,
  rootEditorElement: HTMLElement,
  cellEditable: HTMLElement,
  direction: TableCellBoundaryDirection
): boolean {
  const position = getTableCellPosition(cellEditable);

  if (!position || !isCaretAtEditableBoundary(cellEditable, direction, true)) {
    return false;
  }

  const rowCount = getTableRowElements(position.tableElement).length;
  const isBoundaryRow = direction === "up" ? position.rowIndex === 0 : position.rowIndex === rowCount - 1;

  if (!isBoundaryRow) {
    return false;
  }

  const adjacentElement = getAdjacentTopLevelElement(position.tableDecoratorElement, direction);

  if (!(adjacentElement instanceof HTMLElement)) {
    return false;
  }

  const attemptExit = () => {
    if (adjacentElement.getAttribute("data-lexical-decorator") === "true") {
      return moveIntoAdjacentTopLevelElement(rootEditor, rootEditorElement, adjacentElement, direction);
    }

    return focusRootBlockBoundary(rootEditorElement, adjacentElement, direction);
  };

  window.requestAnimationFrame(() => {
    const attemptRestore = attemptExit;

    if (attemptRestore()) {
      scheduleRetriableFocusRestore({
        delaysMs: [0, 16, 48, 120],
        attemptRestore,
      });

      return;
    }

    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48, 120],
      attemptRestore,
    });
  });

  return true;
}

const TableCellKeyboardBridge = () => {
  const [editor] = useLexicalComposerContext();
  const rootEditor = useCellValue(rootEditor$);

  useEffect(() => {
    const cellEditorRoot = editor.getRootElement();
    const rootEditorElement = rootEditor?.getRootElement();

    if (!(cellEditorRoot instanceof HTMLElement) || !(rootEditorElement instanceof HTMLElement) || !rootEditor) {
      return;
    }

    const handleKeyboardEvent = (event: KeyboardEvent) => {
      const cellEditable = cellEditorRoot.closest('table [contenteditable="true"][data-lexical-editor="true"]');

      if (!(cellEditable instanceof HTMLElement)) {
        return false;
      }

      if (event.key === "Tab" && event.shiftKey) {
        const tableDecoratorElement = cellEditable.closest("[data-lexical-decorator='true']");

        if (!(tableDecoratorElement instanceof HTMLElement) || tableDecoratorElement.querySelector("table") === null) {
          return false;
        }

        const tableEditables = Array.from(
          tableDecoratorElement.querySelectorAll('table [contenteditable="true"][data-lexical-editor="true"]')
        ).filter((element): element is HTMLElement => element instanceof HTMLElement);

        if (tableEditables[0] !== cellEditable) {
          return false;
        }

        const adjacentElement = getAdjacentTopLevelElement(tableDecoratorElement, "up");

        if (!(adjacentElement instanceof HTMLElement)) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();
        moveIntoAdjacentTopLevelElement(rootEditor, rootEditorElement, adjacentElement, "up");
        return true;
      }

      const direction =
        event.key === "ArrowDown"
          ? "down"
          : event.key === "ArrowUp"
            ? "up"
            : event.key === "ArrowLeft"
              ? "left"
              : event.key === "ArrowRight"
                ? "right"
                : null;

      if (!direction) {
        return false;
      }

      const movedWithinTable = moveWithinTableByArrow(cellEditable, direction);

      if (movedWithinTable) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      const movedOutOfTable =
        (direction === "up" || direction === "down") && moveOutOfTableVertically(rootEditor, rootEditorElement, cellEditable, direction);

      if (movedOutOfTable) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      return false;
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (!handleKeyboardEvent(event)) {
        return;
      }

      event.stopImmediatePropagation();
    };

    cellEditorRoot.addEventListener("keydown", handleKeyDownCapture, true);
    const unregisterKeyboardCommand = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => handleKeyboardEvent(event),
      COMMAND_PRIORITY_HIGH
    );
    const unregisterInsertionCommand = editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (payload) => {
        if (typeof payload !== "string") {
          return false;
        }

        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
          return false;
        }

        // The loaded empty-internal-line bug is package-owned: imported
        // canonical <br /> nodes leave the collapsed caret on an adjacent
        // generic-html break boundary. Claim insertion ownership here so the
        // default path does not build the wrong topology before save/export.
        return insertTextAtAdjacentImportedBreak(selection, payload);
      },
      COMMAND_PRIORITY_CRITICAL
    );

    return () => {
      cellEditorRoot.removeEventListener("keydown", handleKeyDownCapture, true);
      unregisterKeyboardCommand();
      unregisterInsertionCommand();
    };
  }, [editor, rootEditor]);

  return null;
};

const tableCellShiftTabBridgePlugin = realmPlugin({
  init(realm) {
    realm.pub(addTableCellEditorChild$, TableCellKeyboardBridge);
  },
});

const MarkdownCodeBlockEditor = (props: ComponentProps<typeof CodeMirrorEditor>) => <CodeMirrorEditor {...props} />;

const MARKDOWN_CODE_BLOCK_EDITOR_DESCRIPTOR = {
  match: (_language: string | null | undefined, meta: string | null | undefined) => !meta,
  priority: 2,
  Editor: MarkdownCodeBlockEditor,
} as const;

type CodeBlockBoundaryDirection = "down" | "left" | "right" | "up";

interface CodeMirrorViewLike {
  dispatch: (spec: { selection: { anchor: number; head?: number } }) => void;
  focus: () => void;
  state: {
    doc: {
      length: number;
      lines?: number;
      lineAt?: (position: number) => { number: number };
    };
    selection?: {
      main?: {
        anchor: number;
        from: number;
        head: number;
        to: number;
      };
    };
  };
}

interface CodeMirrorContentElement extends HTMLElement {
  cmTile?: {
    view?: CodeMirrorViewLike;
  };
}

interface NestedLexicalContentEditableElement extends HTMLElement {
  __lexicalEditor?: Pick<LexicalEditor, "dispatchCommand" | "focus" | "update">;
}

interface AdjacentTableNode {
  getColCount: () => number;
  getRowCount: () => number;
  select: (coords?: [number, number]) => void;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

type VerticalNavigationContext =
  | {
      kind: "root-block";
      boundaryElement: HTMLElement;
      topLevelElement: HTMLElement;
    }
  | {
      kind: "code-block";
      boundaryElement: HTMLElement;
      topLevelElement: HTMLElement;
    }
  | {
      kind: "table-cell";
      boundaryElement: HTMLElement;
      topLevelElement: HTMLElement;
    };

interface DecoratorFocusTarget {
  selectTarget: () => void;
  attemptFocus: () => boolean;
  successRetryDelaysMs?: readonly number[];
}

interface KeyboardNavigationEventLike {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function getDirectChildAncestor(rootElement: HTMLElement, node: Node | null): HTMLElement | null {
  let current: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current && current.parentElement !== rootElement) {
    current = current.parentElement;
  }

  return current?.parentElement === rootElement ? current : null;
}

function getRangeBoundingRect(range: Range): DOMRect | null {
  const getBoundingClientRect = (range as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;

  if (typeof getBoundingClientRect !== "function") {
    return null;
  }

  return getBoundingClientRect.call(range);
}

function getRangeClientRectCount(range: Range): number {
  const getClientRects = (range as Range & { getClientRects?: () => DOMRectList }).getClientRects;

  if (typeof getClientRects !== "function") {
    return 0;
  }

  return getClientRects.call(range).length;
}

function getSelectionAnchorElement(): HTMLElement | null {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;

  if (!anchorNode) {
    return null;
  }

  return anchorNode instanceof HTMLElement ? anchorNode : (anchorNode.parentElement ?? null);
}

function getAdjacentTopLevelElement(
  topLevelElement: HTMLElement,
  direction: Extract<CodeBlockBoundaryDirection, "down" | "up">
): HTMLElement | null {
  const adjacentElement = direction === "down" ? topLevelElement.nextElementSibling : topLevelElement.previousElementSibling;
  return adjacentElement instanceof HTMLElement ? adjacentElement : null;
}

function getAdjacentDecoratorElement(rootElement: HTMLElement, direction: CodeBlockBoundaryDirection): HTMLElement | null {
  const domSelection = window.getSelection();

  if (!domSelection?.isCollapsed) {
    return null;
  }

  const blockElement = getDirectChildAncestor(rootElement, domSelection.anchorNode);

  if (!(blockElement instanceof HTMLElement) || blockElement.matches("[data-lexical-decorator='true']")) {
    return null;
  }

  const adjacentElement =
    direction === "down" || direction === "right" ? blockElement.nextElementSibling : blockElement.previousElementSibling;

  if (!(adjacentElement instanceof HTMLElement) || adjacentElement.getAttribute("data-lexical-decorator") !== "true") {
    return null;
  }

  return adjacentElement;
}

function isCaretAtBlockBoundary(rootElement: HTMLElement, direction: CodeBlockBoundaryDirection): boolean {
  const domSelection = window.getSelection();

  if (!domSelection?.isCollapsed || domSelection.rangeCount === 0) {
    return false;
  }

  const blockElement = getDirectChildAncestor(rootElement, domSelection.anchorNode);

  if (!(blockElement instanceof HTMLElement) || blockElement.matches("[data-lexical-decorator='true']")) {
    return false;
  }

  const selectionRange = domSelection.getRangeAt(0).cloneRange();
  const blockPrefixRange = document.createRange();
  const blockContentsRange = document.createRange();
  blockPrefixRange.selectNodeContents(blockElement);
  blockContentsRange.selectNodeContents(blockElement);
  blockPrefixRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);

  const blockTextLength = blockElement.textContent?.length ?? 0;
  const caretTextOffset = blockPrefixRange.toString().length;

  if (direction === "up" || direction === "down") {
    const adjacentElement = direction === "down" ? blockElement.nextElementSibling : blockElement.previousElementSibling;
    const hasAdjacentDecorator =
      adjacentElement instanceof HTMLElement && adjacentElement.getAttribute("data-lexical-decorator") === "true";

    const caretRect = getRangeBoundingRect(selectionRange);
    const blockRect = typeof blockElement.getBoundingClientRect === "function" ? blockElement.getBoundingClientRect() : null;
    const hasVisualGeometry =
      caretRect !== null &&
      blockRect !== null &&
      (caretRect.height > 0 || caretRect.width > 0 || caretRect.top !== 0 || caretRect.bottom !== 0);

    if (hasVisualGeometry) {
      const boundaryTolerancePx = 4;

      return direction === "down"
        ? caretRect.bottom >= blockRect.bottom - boundaryTolerancePx
        : caretRect.top <= blockRect.top + boundaryTolerancePx;
    }

    const blockVisualLineCount = getRangeClientRectCount(blockContentsRange);

    if (hasAdjacentDecorator && blockVisualLineCount <= 1) {
      return true;
    }
  }

  return direction === "down" || direction === "right" ? caretTextOffset >= blockTextLength : caretTextOffset === 0;
}

function isCaretAtElementBoundary(
  element: HTMLElement,
  direction: Extract<CodeBlockBoundaryDirection, "down" | "up">,
  allowSingleLineFallback: boolean
): boolean {
  const selection = window.getSelection();

  if (!selection?.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const selectionRange = selection.getRangeAt(0).cloneRange();

  if (!element.contains(selectionRange.startContainer)) {
    return false;
  }

  const prefixRange = document.createRange();
  const contentsRange = document.createRange();
  prefixRange.selectNodeContents(element);
  contentsRange.selectNodeContents(element);
  prefixRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);

  const elementTextLength = element.textContent?.length ?? 0;
  const caretTextOffset = prefixRange.toString().length;
  const caretRect = getRangeBoundingRect(selectionRange);
  const elementRect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
  const hasVisualGeometry =
    caretRect !== null &&
    elementRect !== null &&
    (caretRect.height > 0 || caretRect.width > 0 || caretRect.top !== 0 || caretRect.bottom !== 0);

  if (hasVisualGeometry) {
    const boundaryTolerancePx = 4;

    return direction === "down"
      ? caretRect.bottom >= elementRect.bottom - boundaryTolerancePx
      : caretRect.top <= elementRect.top + boundaryTolerancePx;
  }

  if (allowSingleLineFallback && getRangeClientRectCount(contentsRange) <= 1) {
    return true;
  }

  return direction === "down" ? caretTextOffset >= elementTextLength : caretTextOffset === 0;
}

function getAdjacentCodeBlockContent(rootElement: HTMLElement, direction: CodeBlockBoundaryDirection): HTMLElement | null {
  const adjacentElement = getAdjacentDecoratorElement(rootElement, direction);

  if (!(adjacentElement instanceof HTMLElement)) {
    return null;
  }

  const codeContent = adjacentElement.querySelector(".cm-content[role='textbox']");
  return codeContent instanceof HTMLElement ? codeContent : null;
}

function isFocusWithinElement(element: HTMLElement): boolean {
  const ownerDocument = element.ownerDocument;
  const activeElement = ownerDocument?.activeElement;
  const elementConstructor = ownerDocument?.defaultView?.HTMLElement;

  if (!element.isConnected || !activeElement || !elementConstructor) {
    return false;
  }

  return activeElement instanceof elementConstructor && element.contains(activeElement);
}

function getAdjacentTableContent(rootElement: HTMLElement, direction: CodeBlockBoundaryDirection): HTMLElement | null {
  const adjacentElement = getAdjacentDecoratorElement(rootElement, direction);

  if (!(adjacentElement instanceof HTMLElement)) {
    return null;
  }

  const tableElement = adjacentElement.querySelector("table");
  return tableElement instanceof HTMLElement ? tableElement : null;
}

function getAdjacentTableEntryCoords(tableNode: AdjacentTableNode, direction: CodeBlockBoundaryDirection): [number, number] {
  if (direction === "down" || direction === "right") {
    return [0, 0];
  }

  return [Math.max(tableNode.getColCount() - 1, 0), Math.max(tableNode.getRowCount() - 1, 0)];
}

function focusLogicalTableCell(tableElement: HTMLElement, coords: [number, number], direction: CodeBlockBoundaryDirection): boolean {
  const rowCells = getTableRowElements(tableElement);
  const targetRow = rowCells[coords[1]];

  if (!isHtmlElement(targetRow)) {
    return false;
  }

  const editable = getEditableCellElements(targetRow)[coords[0]];

  if (!isHtmlElement(editable)) {
    return false;
  }

  const nestedEditor = (editable as NestedLexicalContentEditableElement).__lexicalEditor;

  const selection = window.getSelection();
  if (!selection) {
    return isFocusWithinElement(tableElement);
  }

  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
  }

  const getLastVisualLineStartPosition = (): { offset: number; textNode: Text } | null => {
    const lastTextNode = textNodes[textNodes.length - 1];

    if (!(lastTextNode instanceof Text)) {
      return null;
    }

    const endRange = document.createRange();
    endRange.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
    endRange.collapse(true);

    const endRect = getRangeBoundingRect(endRange);

    if (!endRect) {
      return null;
    }

    const lineTopTolerancePx = 1;
    let foundSameLine = false;
    let candidate: { offset: number; textNode: Text } = {
      offset: lastTextNode.textContent?.length ?? 0,
      textNode: lastTextNode,
    };

    for (let nodeIndex = textNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const textNode = textNodes[nodeIndex];

      if (!textNode || !(textNode instanceof Text)) {
        continue;
      }

      const textLength = textNode.textContent?.length ?? 0;

      for (let offset = textLength; offset >= 0; offset -= 1) {
        const probeRange = document.createRange();
        probeRange.setStart(textNode, offset);
        probeRange.collapse(true);

        const probeRect = getRangeBoundingRect(probeRange);

        if (!probeRect) {
          continue;
        }

        if (Math.abs(probeRect.top - endRect.top) <= lineTopTolerancePx) {
          candidate = { offset, textNode };
          foundSameLine = true;
          continue;
        }

        if (foundSameLine && probeRect.top < endRect.top - lineTopTolerancePx) {
          return candidate;
        }
      }
    }

    return candidate;
  };

  const upwardTextBoundary = direction === "up" ? getLastVisualLineStartPosition() : null;
  const targetTextNode =
    direction === "up"
      ? upwardTextBoundary?.textNode
      : direction === "down" || direction === "right"
        ? textNodes[0]
        : textNodes[textNodes.length - 1];

  const applyNestedSelection = () => {
    nestedEditor?.update(() => {
      const boundaryLexicalNode = targetTextNode ? $getNearestNodeFromDOMNode(targetTextNode) : null;

      if ($isTextNode(boundaryLexicalNode)) {
        const targetOffset =
          direction === "up"
            ? (upwardTextBoundary?.offset ?? 0)
            : direction === "down" || direction === "right"
              ? 0
              : (targetTextNode?.textContent?.length ?? 0);
        boundaryLexicalNode.select(targetOffset, targetOffset);
        return;
      }

      if (direction === "down" || direction === "right") {
        $getRoot().selectStart();
        return;
      }

      $getRoot().selectEnd();
    });
  };

  if (nestedEditor) {
    applyNestedSelection();
    nestedEditor.focus(
      () => {
        applyNestedSelection();
      },
      {
        defaultSelection: direction === "down" || direction === "right" ? "rootStart" : "rootEnd",
      }
    );
  } else {
    editable.focus({ preventScroll: true });
  }

  const range = document.createRange();

  if (targetTextNode instanceof Text) {
    const targetOffset =
      direction === "up"
        ? (upwardTextBoundary?.offset ?? 0)
        : direction === "down" || direction === "right"
          ? 0
          : (targetTextNode.textContent?.length ?? 0);
    range.setStart(targetTextNode, targetOffset);
  } else {
    range.selectNodeContents(editable);
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return isFocusWithinElement(tableElement);
}

function focusAdjacentTableCell(tableElement: HTMLElement, coords: [number, number], direction: CodeBlockBoundaryDirection): boolean {
  const rowCells = Array.from(tableElement.querySelectorAll("tbody tr"));
  const targetRow = rowCells[coords[1]];

  if (!isHtmlElement(targetRow)) {
    return false;
  }

  const targetCell = targetRow.querySelectorAll("th, td")[coords[0]];

  if (!isHtmlElement(targetCell)) {
    return false;
  }

  const editable = targetCell.querySelector('[contenteditable="true"][data-lexical-editor="true"]');

  if (!isHtmlElement(editable)) {
    return false;
  }

  const nestedEditor = (editable as NestedLexicalContentEditableElement).__lexicalEditor;

  if (nestedEditor) {
    nestedEditor.update(() => {
      if (direction === "down" || direction === "right") {
        $getRoot().selectStart();
        return;
      }

      $getRoot().selectEnd();
    });
    nestedEditor.focus(undefined, {
      defaultSelection: direction === "down" || direction === "right" ? "rootStart" : "rootEnd",
    });
  }

  editable.focus({ preventScroll: true });

  const selection = window.getSelection();
  if (!selection) {
    return isFocusWithinElement(tableElement);
  }

  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
  }

  const targetTextNode = direction === "down" || direction === "right" ? textNodes[0] : textNodes[textNodes.length - 1];
  const range = document.createRange();

  if (targetTextNode instanceof Text) {
    const targetOffset = direction === "down" || direction === "right" ? 0 : (targetTextNode.textContent?.length ?? 0);
    range.setStart(targetTextNode, targetOffset);
  } else {
    range.selectNodeContents(editable);
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return isFocusWithinElement(tableElement);
}

function focusRootBlockBoundary(
  rootElement: HTMLElement,
  blockElement: HTMLElement,
  direction: Extract<CodeBlockBoundaryDirection, "down" | "up">
): boolean {
  // Prefer Lexical's own selection model when re-entering the root editor from a nested decorator.
  const lexicalEditor = (rootElement as NestedLexicalContentEditableElement).__lexicalEditor;

  const walker = document.createTreeWalker(blockElement, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
  }

  const targetTextNode = direction === "down" ? textNodes[0] : textNodes[textNodes.length - 1];

  const getLastVisualLineStartPosition = (): { offset: number; textNode: Text } | null => {
    if (!(targetTextNode instanceof Text)) {
      return null;
    }

    const endRange = document.createRange();
    endRange.setStart(targetTextNode, targetTextNode.textContent?.length ?? 0);
    endRange.collapse(true);

    const endRect = getRangeBoundingRect(endRange);

    if (!endRect) {
      return null;
    }

    const lineTopTolerancePx = 1;
    let foundSameLine = false;
    let candidate: { offset: number; textNode: Text } = {
      offset: targetTextNode.textContent?.length ?? 0,
      textNode: targetTextNode,
    };

    for (let nodeIndex = textNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const textNode = textNodes[nodeIndex];

      if (!textNode || !(textNode instanceof Text)) {
        continue;
      }

      const textLength = textNode.textContent?.length ?? 0;

      for (let offset = textLength; offset >= 0; offset -= 1) {
        const probeRange = document.createRange();
        probeRange.setStart(textNode, offset);
        probeRange.collapse(true);

        const probeRect = getRangeBoundingRect(probeRange);

        if (!probeRect) {
          continue;
        }

        if (Math.abs(probeRect.top - endRect.top) <= lineTopTolerancePx) {
          candidate = { offset, textNode };
          foundSameLine = true;
          continue;
        }

        if (foundSameLine && probeRect.top < endRect.top - lineTopTolerancePx) {
          return candidate;
        }
      }
    }

    return candidate;
  };

  const upwardTextBoundary = direction === "up" ? getLastVisualLineStartPosition() : null;

  const selectLexicalBoundary = () => {
    lexicalEditor?.update(() => {
      const targetDomTextNode = upwardTextBoundary?.textNode ?? targetTextNode;
      const targetTextLexicalNode = targetDomTextNode ? $getNearestNodeFromDOMNode(targetDomTextNode) : null;

      if ($isTextNode(targetTextLexicalNode)) {
        const targetOffset = direction === "down" ? 0 : (upwardTextBoundary?.offset ?? targetDomTextNode?.textContent?.length ?? 0);
        targetTextLexicalNode.select(targetOffset, targetOffset);
        return;
      }

      const lexicalNode = $getNearestNodeFromDOMNode(blockElement);

      if ($isElementNode(lexicalNode)) {
        const descendant = direction === "down" ? lexicalNode.getFirstDescendant() : lexicalNode.getLastDescendant();

        if ($isTextNode(descendant)) {
          const descendantTextLength = descendant.getTextContent().length;
          const targetOffset = direction === "down" ? 0 : descendantTextLength;
          descendant.select(targetOffset, targetOffset);
          return;
        }
      }

      if ($isTextNode(lexicalNode)) {
        if (direction === "down") {
          lexicalNode.selectStart();
          return;
        }

        lexicalNode.selectEnd();
        return;
      }

      const selectableNode = lexicalNode as { selectStart?: () => void; selectEnd?: () => void } | null;

      if (direction === "down") {
        selectableNode?.selectStart?.();
        return;
      }

      selectableNode?.selectEnd?.();
    });
  };

  const placeDomSelection = () => {
    const selection = window.getSelection();

    if (!selection) {
      return false;
    }
    const range = document.createRange();

    if (direction === "up" && upwardTextBoundary) {
      range.setStart(upwardTextBoundary.textNode, upwardTextBoundary.offset);
    } else if (targetTextNode instanceof Text) {
      range.setStart(targetTextNode, direction === "down" ? 0 : (targetTextNode.textContent?.length ?? 0));
    } else {
      range.selectNodeContents(blockElement);
    }

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    return blockElement.contains(selection.anchorNode);
  };

  if (lexicalEditor) {
    selectLexicalBoundary();

    lexicalEditor.focus(
      () => {
        selectLexicalBoundary();
        placeDomSelection();
      },
      {
        defaultSelection: direction === "down" ? "rootStart" : "rootEnd",
      }
    );
  } else {
    rootElement.focus({ preventScroll: true });
  }

  return placeDomSelection();
}

function getVerticalNavigationContext(rootElement: HTMLElement): VerticalNavigationContext | null {
  const selection = window.getSelection();

  if (!selection?.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const anchorElement = getSelectionAnchorElement();

  if (!anchorElement) {
    return null;
  }

  const decoratorElement = anchorElement.closest("[data-lexical-decorator='true']");

  if (decoratorElement instanceof HTMLElement && rootElement.contains(decoratorElement)) {
    const codeContent = decoratorElement.querySelector(".cm-content[role='textbox']");

    if (codeContent instanceof HTMLElement && codeContent.contains(anchorElement)) {
      return {
        kind: "code-block",
        boundaryElement: codeContent,
        topLevelElement: decoratorElement,
      };
    }

    const tableEditable = anchorElement.closest('table [contenteditable="true"][data-lexical-editor="true"]');

    if (tableEditable instanceof HTMLElement && decoratorElement.contains(tableEditable)) {
      return {
        kind: "table-cell",
        boundaryElement: tableEditable,
        topLevelElement: decoratorElement,
      };
    }
  }

  const blockElement = getDirectChildAncestor(rootElement, selection.anchorNode);

  if (!(blockElement instanceof HTMLElement) || blockElement.matches("[data-lexical-decorator='true']")) {
    return null;
  }

  return {
    kind: "root-block",
    boundaryElement: blockElement,
    topLevelElement: blockElement,
  };
}

function getDecoratorFocusTarget(
  activeEditor: LexicalEditor,
  adjacentElement: HTMLElement,
  direction: Extract<CodeBlockBoundaryDirection, "down" | "up">
): DecoratorFocusTarget | null {
  const codeContent = adjacentElement.querySelector(".cm-content[role='textbox']");

  if (codeContent instanceof HTMLElement) {
    let adjacentCodeBlockNode: { select: () => void } | null = null;

    activeEditor.update(() => {
      const adjacentNode = $getNearestNodeFromDOMNode(adjacentElement);

      if ($isCodeBlockNode(adjacentNode)) {
        adjacentCodeBlockNode = adjacentNode;
      }
    });

    if (!adjacentCodeBlockNode) {
      return null;
    }

    return {
      selectTarget: () => {
        adjacentCodeBlockNode?.select();
      },
      attemptFocus: () => focusCodeBlockContent(codeContent, direction),
      successRetryDelaysMs: [16, 48, 120, 300],
    };
  }

  const tableElement = adjacentElement.querySelector("table");

  if (tableElement instanceof HTMLElement) {
    let adjacentTableNode: AdjacentTableNode | null = null;

    activeEditor.update(() => {
      const adjacentNode = $getNearestNodeFromDOMNode(adjacentElement);

      if ($isTableNode(adjacentNode)) {
        adjacentTableNode = adjacentNode;
      }
    });

    if (!adjacentTableNode) {
      return null;
    }

    const entryCoords = getAdjacentTableEntryCoords(adjacentTableNode, direction);

    return {
      selectTarget: () => {
        adjacentTableNode?.select(entryCoords);
      },
      attemptFocus: () => focusAdjacentTableCell(tableElement, entryCoords, direction) || isFocusWithinElement(tableElement),
      successRetryDelaysMs: [16, 48, 120, 300],
    };
  }

  return null;
}

function getFocusedTopLevelElement(rootElement: HTMLElement): HTMLElement | null {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLElement) || !rootElement.contains(activeElement)) {
    return null;
  }

  const decoratorElement = activeElement.closest("[data-lexical-decorator='true']");

  if (decoratorElement instanceof HTMLElement && rootElement.contains(decoratorElement)) {
    return decoratorElement;
  }

  return getDirectChildAncestor(rootElement, activeElement);
}

function moveIntoAdjacentTopLevelElement(
  activeEditor: LexicalEditor,
  rootElement: HTMLElement,
  adjacentElement: HTMLElement,
  direction: Extract<CodeBlockBoundaryDirection, "down" | "up">
): boolean {
  if (adjacentElement.getAttribute("data-lexical-decorator") === "true") {
    const focusTarget = getDecoratorFocusTarget(activeEditor, adjacentElement, direction);

    if (!focusTarget) {
      return false;
    }

    focusTarget.selectTarget();

    const attemptDecoratorFocus = () => {
      if (focusTarget.attemptFocus()) {
        if (focusTarget.successRetryDelaysMs) {
          scheduleRetriableFocusRestore({
            delaysMs: focusTarget.successRetryDelaysMs,
            attemptRestore: focusTarget.attemptFocus,
          });
        }

        return true;
      }

      return false;
    };

    if (attemptDecoratorFocus()) {
      return true;
    }

    window.requestAnimationFrame(() => {
      if (attemptDecoratorFocus()) {
        return;
      }

      scheduleRetriableFocusRestore({
        delaysMs: [0, 16, 48, 120],
        attemptRestore: focusTarget.attemptFocus,
      });
    });

    return true;
  }

  const tryFocusAdjacentRootBlock = () => focusRootBlockBoundary(rootElement, adjacentElement, direction);
  const scheduleRootBlockRestore = () => {
    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48],
      attemptRestore: tryFocusAdjacentRootBlock,
    });
  };

  if (tryFocusAdjacentRootBlock()) {
    scheduleRootBlockRestore();

    return true;
  }

  scheduleRootBlockRestore();

  window.requestAnimationFrame(() => {
    const tryFocusAdjacentRootBlockInFrame = () => focusRootBlockBoundary(rootElement, adjacentElement, direction);

    if (tryFocusAdjacentRootBlockInFrame()) {
      return;
    }

    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48],
      attemptRestore: tryFocusAdjacentRootBlockInFrame,
    });
  });

  return true;
}

function tryMoveOutOfTableWithTab(activeEditor: LexicalEditor, event: KeyboardNavigationEventLike & { shiftKey?: boolean }): boolean {
  if (event.key !== "Tab" || event.shiftKey) {
    return false;
  }

  const direction = "down";
  const rootElement = activeEditor.getRootElement();

  if (!(rootElement instanceof HTMLElement)) {
    return false;
  }

  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  const boundaryEditable = activeElement.closest('table [contenteditable="true"][data-lexical-editor="true"]');

  if (!(boundaryEditable instanceof HTMLElement) || !rootElement.contains(boundaryEditable)) {
    return false;
  }

  const tableDecoratorElement = boundaryEditable.closest("[data-lexical-decorator='true']");

  if (!(tableDecoratorElement instanceof HTMLElement) || tableDecoratorElement.querySelector("table") === null) {
    return false;
  }

  const tableEditables = Array.from(
    tableDecoratorElement.querySelectorAll('table [contenteditable="true"][data-lexical-editor="true"]')
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);

  if (tableEditables.length === 0) {
    return false;
  }

  const boundaryTarget = tableEditables[tableEditables.length - 1];

  if (!boundaryTarget) {
    return false;
  }

  if (boundaryEditable !== boundaryTarget) {
    return false;
  }

  const adjacentElement = getAdjacentTopLevelElement(tableDecoratorElement, direction);

  if (!(adjacentElement instanceof HTMLElement)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  return moveIntoAdjacentTopLevelElement(activeEditor, rootElement, adjacentElement, direction);
}

function tryMoveVerticallyAcrossDocument(activeEditor: LexicalEditor, event: KeyboardNavigationEventLike): boolean {
  const direction = event.key === "ArrowDown" ? "down" : event.key === "ArrowUp" ? "up" : null;

  if (!direction) {
    return false;
  }

  const rootElement = activeEditor.getRootElement();

  if (!(rootElement instanceof HTMLElement)) {
    return false;
  }

  const context = getVerticalNavigationContext(rootElement);

  if (!context) {
    return false;
  }

  const adjacentElement = getAdjacentTopLevelElement(context.topLevelElement, direction);

  if (!(adjacentElement instanceof HTMLElement)) {
    return false;
  }

  if (context.kind === "root-block" && adjacentElement.getAttribute("data-lexical-decorator") !== "true") {
    return false;
  }

  const allowSingleLineFallback = context.kind !== "root-block" || adjacentElement.getAttribute("data-lexical-decorator") === "true";

  const isAtBoundary =
    context.kind === "code-block"
      ? isCodeBlockCaretAtBoundary(context.boundaryElement, direction)
      : isCaretAtElementBoundary(context.boundaryElement, direction, allowSingleLineFallback);

  if (!isAtBoundary) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  return moveIntoAdjacentTopLevelElement(activeEditor, rootElement, adjacentElement, direction);
}

function isCodeBlockContentFocused(codeContent: HTMLElement): boolean {
  const activeElement = document.activeElement;

  if (activeElement !== codeContent) {
    return false;
  }

  return codeContent.closest(".cm-editor")?.classList.contains("cm-focused") ?? false;
}

function isCodeBlockCaretAtBoundary(codeContent: HTMLElement, direction: Extract<CodeBlockBoundaryDirection, "down" | "up">): boolean {
  const codeMirrorView = (codeContent as CodeMirrorContentElement).cmTile?.view;
  const selection = codeMirrorView?.state.selection?.main;
  const codeMirrorDoc = codeMirrorView?.state.doc;
  const lineCount = codeMirrorDoc?.lines;

  if (selection && selection.from === selection.to) {
    const caretPosition = typeof selection.head === "number" ? selection.head : selection.from;

    if (typeof codeMirrorDoc?.lineAt === "function" && typeof lineCount === "number") {
      const caretLineNumber = codeMirrorDoc.lineAt(caretPosition).number;
      return direction === "down" ? caretLineNumber >= lineCount : caretLineNumber <= 1;
    }

    return direction === "down" ? caretPosition >= codeMirrorView.state.doc.length : caretPosition <= 0;
  }

  return isCaretAtElementBoundary(codeContent, direction, true);
}

function focusCodeBlockContent(codeContent: HTMLElement, direction: CodeBlockBoundaryDirection): boolean {
  const codeMirrorView = (codeContent as CodeMirrorContentElement).cmTile?.view;

  if (codeMirrorView) {
    const targetOffset = direction === "down" || direction === "right" ? 0 : codeMirrorView.state.doc.length;

    codeMirrorView.dispatch({
      selection: {
        anchor: targetOffset,
        head: targetOffset,
      },
    });
    codeMirrorView.focus();

    if (isCodeBlockContentFocused(codeContent)) {
      return true;
    }
  }

  codeContent.focus({ preventScroll: true });

  const domSelection = window.getSelection();

  if (!domSelection) {
    return isCodeBlockContentFocused(codeContent);
  }

  const lines = Array.from(codeContent.querySelectorAll(".cm-line"));
  const targetLine = direction === "down" || direction === "right" ? lines[0] : lines[lines.length - 1];

  if (!(targetLine instanceof HTMLElement)) {
    return isCodeBlockContentFocused(codeContent);
  }

  const textWalker = document.createTreeWalker(targetLine, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (textWalker.nextNode()) {
    const currentNode = textWalker.currentNode;
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
  }

  const targetTextNode = direction === "down" || direction === "right" ? textNodes[0] : textNodes[textNodes.length - 1];
  const range = document.createRange();

  if (targetTextNode instanceof Text) {
    range.setStart(targetTextNode, direction === "down" || direction === "right" ? 0 : (targetTextNode.textContent?.length ?? 0));
  } else {
    range.selectNodeContents(targetLine);
  }

  range.collapse(true);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return isCodeBlockContentFocused(codeContent);
}

function tryMoveIntoAdjacentCodeBlock(
  activeEditor: LexicalEditor,
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">
): boolean {
  const direction =
    event.key === "ArrowDown"
      ? "down"
      : event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowRight"
          ? "right"
          : event.key === "ArrowLeft"
            ? "left"
            : null;

  if (!direction) {
    return false;
  }

  const rootElement = activeEditor.getRootElement();

  if (!(rootElement instanceof HTMLElement) || !isCaretAtBlockBoundary(rootElement, direction)) {
    return false;
  }

  const adjacentCodeContent = getAdjacentCodeBlockContent(rootElement, direction);

  let adjacentCodeBlockNode: { select: () => void } | null = null;

  activeEditor.getEditorState().read(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return;
    }

    const topLevelNode = selection.anchor.getNode().getTopLevelElementOrThrow();
    const adjacentNode = direction === "down" || direction === "right" ? topLevelNode.getNextSibling() : topLevelNode.getPreviousSibling();

    if ($isCodeBlockNode(adjacentNode)) {
      adjacentCodeBlockNode = adjacentNode;
    }
  });

  if (!adjacentCodeBlockNode) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  window.requestAnimationFrame(() => {
    const tryFocusAdjacentCodeBlock = () => (adjacentCodeContent ? focusCodeBlockContent(adjacentCodeContent, direction) : false);

    adjacentCodeBlockNode?.select();

    if (tryFocusAdjacentCodeBlock()) {
      return;
    }

    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48, 120],
      attemptRestore: tryFocusAdjacentCodeBlock,
    });
  });

  return true;
}

function tryMoveIntoAdjacentTable(
  activeEditor: LexicalEditor,
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">
): boolean {
  const direction =
    event.key === "ArrowDown"
      ? "down"
      : event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowRight"
          ? "right"
          : event.key === "ArrowLeft"
            ? "left"
            : null;

  if (!direction) {
    return false;
  }

  const rootElement = activeEditor.getRootElement();

  if (!(rootElement instanceof HTMLElement) || !isCaretAtBlockBoundary(rootElement, direction)) {
    return false;
  }

  const adjacentTableContent = getAdjacentTableContent(rootElement, direction);

  let adjacentTableNode: AdjacentTableNode | null = null;

  activeEditor.getEditorState().read(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return;
    }

    const topLevelNode = selection.anchor.getNode().getTopLevelElementOrThrow();
    const adjacentNode = direction === "down" || direction === "right" ? topLevelNode.getNextSibling() : topLevelNode.getPreviousSibling();

    if ($isTableNode(adjacentNode)) {
      adjacentTableNode = adjacentNode;
    }
  });

  if (!adjacentTableNode) {
    return false;
  }

  const entryCoords = getAdjacentTableEntryCoords(adjacentTableNode, direction);

  event.preventDefault();
  event.stopPropagation();

  window.requestAnimationFrame(() => {
    const tryFocusAdjacentTable = () => {
      if (!adjacentTableContent) {
        return false;
      }

      return focusAdjacentTableCell(adjacentTableContent, entryCoords, direction) || isFocusWithinElement(adjacentTableContent);
    };

    adjacentTableNode?.select(entryCoords);

    if (tryFocusAdjacentTable()) {
      scheduleRetriableFocusRestore({
        delaysMs: [16, 48, 120],
        attemptRestore: tryFocusAdjacentTable,
      });

      return;
    }

    scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48, 120],
      attemptRestore: tryFocusAdjacentTable,
    });
  });

  return true;
}

export interface MarkdownRichEditorHandle {
  focus: () => void;
  flushPendingEdits: () => Promise<void>;
  getCanonicalMarkdown: () => string;
  preserveSelection: () => void;
  restorePreservedSelection: () => boolean;
  focusCurrentSearchResult: () => boolean;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

interface MarkdownRichEditorViewportAnchor {
  element: HTMLElement;
  scrollTop: number;
  scrollLeft: number;
}

interface MarkdownRichEditorViewportSnapshot {
  anchors: MarkdownRichEditorViewportAnchor[];
}

type MarkdownRichEditorSelectionSnapshot =
  | {
      type: "textarea";
      start: number;
      end: number;
      direction: "forward" | "backward" | "none";
      viewport: MarkdownRichEditorViewportSnapshot;
    }
  | {
      type: "lexical-range";
      anchor: {
        key: NodeKey;
        offset: number;
        type: "text" | "element";
      };
      focus: {
        key: NodeKey;
        offset: number;
        type: "text" | "element";
      };
      format: number;
      style: string;
      viewport: MarkdownRichEditorViewportSnapshot;
    }
  | {
      type: "lexical-node";
      keys: NodeKey[];
      viewport: MarkdownRichEditorViewportSnapshot;
    };

export interface MarkdownRichEditorSearchState {
  searchText: string;
  searchMatches: number;
  currentMatch: number;
  isSearchOpen: boolean;
  isSearchable: boolean;
  viewMode: "rich-text" | "source" | "diff";
}

export interface MarkdownRichEditorProps {
  markdown: string;
  diffMarkdown?: string;
  onChange: (markdown: string) => void;
  onUserEdit?: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  searchText?: string;
  searchOpen?: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
}

interface MarkdownRichEditorSearchCommands {
  nextSearchResult: () => void;
  previousSearchResult: () => void;
}

interface MarkdownRichEditorCommands {
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

type MarkdownViewModeRequestHandler = (
  viewMode: Extract<MarkdownEditorViewMode, "rich-text" | "source">,
  commitViewMode: (viewMode: Extract<MarkdownEditorViewMode, "rich-text" | "source">) => void
) => void;

interface MarkdownRichEditorSearchBridgeProps {
  searchText: string;
  searchOpen: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
  onCurrentRangeChange: (range: Range | null) => void;
  onCommandsChange: (commands: MarkdownRichEditorSearchCommands | null) => void;
}

const NOOP_SEARCH_COMMANDS: MarkdownRichEditorSearchCommands = {
  nextSearchResult: () => {},
  previousSearchResult: () => {},
};

const NOOP_EDITOR_COMMANDS: MarkdownRichEditorCommands = {
  createLink: () => {},
  insertTable: () => {},
  insertThematicBreak: () => {},
  toggleInlineCode: () => {},
  insertCodeBlock: () => {},
};

const MarkdownActiveEditorBridge = ({ onActiveEditorChange }: { onActiveEditorChange: (editor: LexicalEditor | null) => void }) => {
  const activeEditor = useCellValue(activeEditor$);

  useEffect(() => {
    onActiveEditorChange(activeEditor);

    return () => {
      onActiveEditorChange(null);
    };
  }, [activeEditor, onActiveEditorChange]);

  return null;
};

const MarkdownViewModeBridge = ({ onViewModeChange }: { onViewModeChange: (viewMode: MarkdownEditorViewMode) => void }) => {
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const previousViewModeRef = useRef<MarkdownEditorViewMode | null>(null);

  useEffect(() => {
    const previousViewMode = previousViewModeRef.current;
    previousViewModeRef.current = viewMode;

    if (previousViewMode === null || previousViewMode === viewMode) {
      return;
    }

    onViewModeChange(viewMode);
  }, [onViewModeChange, viewMode]);

  return null;
};

const MarkdownSourceModeSeedBridge = ({ onPublisherChange }: { onPublisherChange: (publisher: (markdown: string) => void) => void }) => {
  const publishSourceModeMarkdown = usePublisher(mdxEditorMarkdown$);

  useEffect(() => {
    onPublisherChange(publishSourceModeMarkdown);

    return () => {
      onPublisherChange(() => {});
    };
  }, [onPublisherChange, publishSourceModeMarkdown]);

  return null;
};

const MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS = {
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  underline: "Ctrl+U",
  undo: IS_APPLE ? "Cmd+Z" : "Ctrl+Z",
  redo: IS_APPLE ? "Cmd+Y" : "Ctrl+Y",
} as const;

function formatEditorTooltip(label: string, shortcutLabel?: string): string {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

const MarkdownLinkDialogContext = createContext<(() => void) | null>(null);

function useMarkdownLinkDialog(): () => void {
  return useContext(MarkdownLinkDialogContext) ?? (() => {});
}

const MarkdownLinkDialogProvider = ({
  children,
  onLinkApplied,
  preserveEditorSelection,
  readOnly,
  restoreEditorSelection,
}: {
  children: ReactNode;
  onLinkApplied?: () => void;
  preserveEditorSelection: () => void;
  readOnly: boolean;
  restoreEditorSelection: () => boolean;
}) => {
  const { t } = useTranslation();
  const activeEditor = useCellValue(activeEditor$);
  const [isOpen, setIsOpen] = useState(false);
  const [dialogSessionId, setDialogSessionId] = useState(0);
  const linkUrlInputRef = useRef<HTMLInputElement | null>(null);
  const shouldRestoreSelectionOnCloseRef = useRef(false);

  const openLinkDialog = useCallback(() => {
    if (!activeEditor) {
      return;
    }

    preserveEditorSelection();
    shouldRestoreSelectionOnCloseRef.current = true;
    setDialogSessionId((currentSessionId) => currentSessionId + 1);
    setIsOpen(true);
  }, [activeEditor, preserveEditorSelection]);

  const closeLinkDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  const submitLinkDialog = useCallback(() => {
    const normalizedUrl = linkUrlInputRef.current?.value.trim() ?? "";
    if (!normalizedUrl) {
      return;
    }

    shouldRestoreSelectionOnCloseRef.current = false;
    restoreEditorSelection();
    activeEditor?.dispatchCommand(TOGGLE_LINK_COMMAND, {
      url: normalizedUrl,
    });
    onLinkApplied?.();
    closeLinkDialog();
  }, [activeEditor, closeLinkDialog, onLinkApplied, restoreEditorSelection]);

  useEffect(() => {
    if (!activeEditor || readOnly) {
      return;
    }

    return activeEditor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (event.key.toLowerCase() !== "k" || !(IS_APPLE ? event.metaKey : event.ctrlKey)) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();
        openLinkDialog();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [activeEditor, openLinkDialog, readOnly]);

  return (
    <MarkdownLinkDialogContext.Provider value={openLinkDialog}>
      {children}
      <Dialog
        open={isOpen}
        onClose={closeLinkDialog}
        fullWidth
        maxWidth={MARKDOWN_LINK_DIALOG_MAX_WIDTH}
        slotProps={{
          transition: {
            onExited: () => {
              if (!shouldRestoreSelectionOnCloseRef.current) {
                return;
              }

              shouldRestoreSelectionOnCloseRef.current = false;
              restoreEditorSelection();
            },
          },
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) {
            event.preventDefault();
            submitLinkDialog();
          }
        }}
      >
        <DialogTitle>{t("viewer.edit.createLink", { defaultValue: "Create link" })}</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2, overflow: "visible", pt: 2.5 }}>
          <TextField
            key={`markdown-link-url-${dialogSessionId}`}
            autoFocus
            inputRef={linkUrlInputRef}
            label={t("viewer.edit.linkUrl", { defaultValue: "Link URL" })}
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeLinkDialog}>{t("common.cancel", { defaultValue: "Cancel" })}</Button>
          <Button variant="contained" onClick={submitLinkDialog}>
            {t("common.apply", { defaultValue: "Apply" })}
          </Button>
        </DialogActions>
      </Dialog>
    </MarkdownLinkDialogContext.Provider>
  );
};

const MarkdownRichEditorCommandBridge = ({
  onCommandsChange,
}: {
  onCommandsChange: (commands: MarkdownRichEditorCommands | null) => void;
}) => {
  const applyFormat = usePublisher(applyFormat$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertTable = usePublisher(insertTable$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const openLinkDialog = useMarkdownLinkDialog();

  useEffect(() => {
    onCommandsChange({
      createLink: () => {
        openLinkDialog();
      },
      insertTable: () => {
        insertTable({ rows: 3, columns: 3 });
      },
      insertThematicBreak: () => {
        insertThematicBreak();
      },
      toggleInlineCode: () => {
        applyFormat("code");
      },
      insertCodeBlock: () => {
        insertCodeBlock({});
      },
    });

    return () => {
      onCommandsChange(null);
    };
  }, [applyFormat, insertCodeBlock, insertTable, insertThematicBreak, onCommandsChange, openLinkDialog]);

  return null;
};

const MarkdownDecoratorArrowNavigationBridge = () => {
  const activeEditor = useCellValue(activeEditor$);

  useEffect(() => {
    if (!activeEditor) {
      return;
    }

    const rootElement = activeEditor.getRootElement();
    const handleRootKeyDown = (event: KeyboardEvent) => {
      const handled =
        tryMoveOutOfTableWithTab(activeEditor, event) ||
        tryMoveVerticallyAcrossDocument(activeEditor, event) ||
        tryMoveIntoAdjacentCodeBlock(activeEditor, event) ||
        tryMoveIntoAdjacentTable(activeEditor, event);

      if (handled) {
        event.stopImmediatePropagation();
      }
    };

    if (rootElement instanceof HTMLElement) {
      rootElement.addEventListener("keydown", handleRootKeyDown, true);
    }

    const unregisterCommand = activeEditor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) =>
        tryMoveOutOfTableWithTab(activeEditor, event) ||
        tryMoveVerticallyAcrossDocument(activeEditor, event) ||
        tryMoveIntoAdjacentCodeBlock(activeEditor, event) ||
        tryMoveIntoAdjacentTable(activeEditor, event),
      COMMAND_PRIORITY_HIGH
    );

    const unregisterUpdateListener =
      typeof activeEditor.registerUpdateListener === "function"
        ? activeEditor.registerUpdateListener(({ editorState }) => {
            if (!(rootElement instanceof HTMLElement)) {
              return;
            }

            let selectedDecoratorElement: HTMLElement | null = null;
            const focusedTopLevelElement = getFocusedTopLevelElement(rootElement);
            let selectionTopLevelKey: NodeKey | null = null;

            editorState.read(() => {
              const selection = $getSelection();

              if ($isRangeSelection(selection)) {
                selectionTopLevelKey = selection.anchor.getNode().getTopLevelElementOrThrow().getKey();
                return;
              }

              if (!$isNodeSelection(selection)) {
                return;
              }

              const selectedNodes = selection.getNodes();

              if (selectedNodes.length !== 1) {
                return;
              }

              const [selectedNode] = selectedNodes;

              if (!$isCodeBlockNode(selectedNode) && !$isTableNode(selectedNode)) {
                return;
              }

              const element = activeEditor.getElementByKey(selectedNode.getKey());

              if (!(element instanceof HTMLElement)) {
                return;
              }

              selectedDecoratorElement = element;
            });

            if (
              !isHtmlElement(focusedTopLevelElement) ||
              focusedTopLevelElement.getAttribute("data-lexical-decorator") !== "true" ||
              focusedTopLevelElement.querySelector("table") === null
            ) {
              return;
            }

            const previousElement = focusedTopLevelElement.previousElementSibling;

            if (!isHtmlElement(previousElement) || previousElement.getAttribute("data-lexical-decorator") !== "true") {
              return;
            }

            if (!isHtmlElement(selectedDecoratorElement)) {
              if (selectionTopLevelKey === null) {
                return;
              }

              const selectionTopLevelElement = activeEditor.getElementByKey(selectionTopLevelKey);

              if (!isHtmlElement(selectionTopLevelElement)) {
                return;
              }

              const relation = selectionTopLevelElement.compareDocumentPosition(focusedTopLevelElement);

              if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
                return;
              }

              selectedDecoratorElement = previousElement;
            }

            if (
              focusedTopLevelElement.previousElementSibling !== selectedDecoratorElement ||
              isFocusWithinElement(selectedDecoratorElement)
            ) {
              return;
            }

            const focusTarget = getDecoratorFocusTarget(activeEditor, selectedDecoratorElement, "up");

            if (!focusTarget) {
              return;
            }

            focusTarget.attemptFocus();
            scheduleRetriableFocusRestore({
              delaysMs: focusTarget.successRetryDelaysMs ?? [0, 16, 48, 120],
              attemptRestore: focusTarget.attemptFocus,
            });
          })
        : () => {};

    return () => {
      unregisterUpdateListener();
      unregisterCommand();
      if (rootElement instanceof HTMLElement) {
        rootElement.removeEventListener("keydown", handleRootKeyDown, true);
      }
    };
  }, [activeEditor]);

  return null;
};

interface MarkdownFormattingToggleDefinition {
  format: number;
  formatName: "bold" | "italic" | "underline";
  icon: IconKey;
  shortcutLabel: string;
  addLabel: string;
  removeLabel: string;
}

const MarkdownInlineFormattingToggles = ({ includeUnderline = true }: { includeUnderline?: boolean }) => {
  const { t } = useTranslation();
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const toggleDefinitions: readonly MarkdownFormattingToggleDefinition[] = [
    {
      format: IS_BOLD,
      formatName: "bold",
      icon: "format_bold",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.bold,
      addLabel: t("viewer.edit.bold", { defaultValue: "Bold" }),
      removeLabel: t("viewer.edit.removeBold", { defaultValue: "Remove bold" }),
    },
    {
      format: IS_ITALIC,
      formatName: "italic",
      icon: "format_italic",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.italic,
      addLabel: t("viewer.edit.italic", { defaultValue: "Italic" }),
      removeLabel: t("viewer.edit.removeItalic", { defaultValue: "Remove italic" }),
    },
    {
      format: IS_UNDERLINE,
      formatName: "underline",
      icon: "format_underlined",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.underline,
      addLabel: t("viewer.edit.underline", { defaultValue: "Underline" }),
      removeLabel: t("viewer.edit.removeUnderline", { defaultValue: "Remove underline" }),
    },
  ];

  const visibleToggleDefinitions = includeUnderline
    ? toggleDefinitions
    : toggleDefinitions.filter((definition) => definition.formatName !== "underline");

  return (
    <MultipleChoiceToggleGroup
      items={visibleToggleDefinitions.map(({ addLabel, format, formatName, icon, removeLabel, shortcutLabel }) => {
        const active = (currentFormat & format) !== 0;

        return {
          title: formatEditorTooltip(active ? removeLabel : addLabel, shortcutLabel),
          contents: iconComponentFor(icon),
          active,
          onChange: () => {
            applyFormat(formatName);
          },
        };
      })}
    />
  );
};

const MarkdownUndoRedoControls = () => {
  const { t } = useTranslation();
  const [iconComponentFor, activeEditor] = useCellValues(iconComponentFor$, activeEditor$);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!activeEditor) {
      return;
    }

    return mergeRegister(
      activeEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      activeEditor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }, [activeEditor]);

  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title: formatEditorTooltip(t("viewer.edit.undo", { defaultValue: "Undo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.undo),
          disabled: !canUndo,
          contents: iconComponentFor("undo"),
          active: false,
          onChange: () => {
            activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
          },
        },
        {
          title: formatEditorTooltip(t("viewer.edit.redo", { defaultValue: "Redo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.redo),
          disabled: !canRedo,
          contents: iconComponentFor("redo"),
          active: false,
          onChange: () => {
            activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
          },
        },
      ]}
    />
  );
};

const InlineCodeToggle = () => {
  const { t } = useTranslation();
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const codeIsOn = (currentFormat & IS_CODE) !== 0;
  const label = codeIsOn
    ? t("viewer.edit.removeInlineCode", { defaultValue: "Remove code format" })
    : t("viewer.edit.inlineCode", { defaultValue: "Inline code format" });
  const title = formatEditorTooltip(label, MARKDOWN_EDITOR_SHORTCUTS.INLINE_CODE.label);

  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title,
          contents: iconComponentFor("code"),
          active: codeIsOn,
          onChange: () => {
            applyFormat("code");
          },
        },
      ]}
    />
  );
};

const MarkdownViewModeToggle = ({ onRequestViewModeChange }: { onRequestViewModeChange: MarkdownViewModeRequestHandler }) => {
  const { t } = useTranslation();
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const setViewMode = usePublisher(viewMode$);

  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title: t("viewer.edit.richTextMode", { defaultValue: "Rich-text mode" }),
          contents: iconComponentFor("rich_text"),
          active: viewMode === "rich-text",
          onChange: () => {
            onRequestViewModeChange("rich-text", setViewMode);
          },
        },
        {
          title: t("viewer.edit.sourceMode", { defaultValue: "Source mode" }),
          contents: iconComponentFor("markdown"),
          active: viewMode === "source",
          onChange: () => {
            onRequestViewModeChange("source", setViewMode);
          },
        },
      ]}
    />
  );
};

const InsertCodeBlockButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CODE_BLOCK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertCodeBlock({});
      }}
    >
      {iconComponentFor("frame_source")}
    </ButtonWithTooltip>
  );
};

const CreateLinkButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const openLinkDialog = useMarkdownLinkDialog();
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CREATE_LINK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        openLinkDialog();
      }}
    >
      {iconComponentFor("link")}
    </ButtonWithTooltip>
  );
};

const InsertTableButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertTable = usePublisher(insertTable$);
  const isDisabled = useCellValue(editorInTable$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.INSERT_TABLE);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertTable({ rows: 3, columns: 3 });
      }}
      {...(isDisabled ? { "aria-disabled": true, "data-disabled": true, disabled: true } : {})}
    >
      {iconComponentFor("table")}
    </ButtonWithTooltip>
  );
};

const InsertThematicBreakButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.INSERT_THEMATIC_BREAK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertThematicBreak();
      }}
    >
      {iconComponentFor("horizontal_rule")}
    </ButtonWithTooltip>
  );
};

type MarkdownEditorViewMode = "rich-text" | "source" | "diff";
type MarkdownEditorListType = "" | "bullet" | "number" | "check";
type MarkdownEditorBlockType = "paragraph" | "quote" | "h1" | "h2" | "h3";
type MarkdownMobileExtraActionKey = "list" | "link" | "inline-code" | "underline";

const MARKDOWN_MOBILE_TOOLBAR_CLASS = "sambee-markdown-editor-mobile-toolbar";
const MOBILE_TOOLBAR_ACTION_SIZE_PX = 44;
const MOBILE_TOOLBAR_ACTION_GAP_PX = 4;
const MOBILE_TOOLBAR_HORIZONTAL_PADDING_PX = 16;
const MOBILE_TOOLBAR_GROUP_GAP_PX = 8;
const MOBILE_TOOLBAR_DEFAULT_WIDTH_PX = 320;
const MOBILE_TOOLBAR_BASE_ACTIONS_COUNT = 4;
const MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY: readonly MarkdownMobileExtraActionKey[] = ["list", "link", "inline-code", "underline"];

function getVisibleMobileExtraActionCount(toolbarWidth: number): number {
  const availableLeftGroupWidth =
    toolbarWidth - MOBILE_TOOLBAR_HORIZONTAL_PADDING_PX - MOBILE_TOOLBAR_ACTION_SIZE_PX - MOBILE_TOOLBAR_GROUP_GAP_PX;
  const baseActionsWidth =
    MOBILE_TOOLBAR_BASE_ACTIONS_COUNT * MOBILE_TOOLBAR_ACTION_SIZE_PX +
    (MOBILE_TOOLBAR_BASE_ACTIONS_COUNT - 1) * MOBILE_TOOLBAR_ACTION_GAP_PX;
  const remainingWidth = availableLeftGroupWidth - baseActionsWidth;

  if (remainingWidth <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY.length,
      Math.floor(remainingWidth / (MOBILE_TOOLBAR_ACTION_SIZE_PX + MOBILE_TOOLBAR_ACTION_GAP_PX))
    )
  );
}

const MarkdownMobileToolbarButton = ({
  active = false,
  activeBackground,
  hoverBackground,
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  active?: boolean;
  activeBackground: string;
  hoverBackground: string;
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) => {
  return (
    <IconButton
      aria-label={ariaLabel}
      color="inherit"
      data-toolbar-item
      data-editor-tooltip={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      size="medium"
      sx={{
        flexShrink: 0,
        width: MOBILE_TOOLBAR_ACTION_SIZE_PX,
        height: MOBILE_TOOLBAR_ACTION_SIZE_PX,
        borderRadius: 1,
        bgcolor: active ? activeBackground : "transparent",
        "&:hover": {
          bgcolor: hoverBackground,
        },
      }}
    >
      {children}
    </IconButton>
  );
};

const MarkdownMobileUndoRedoButtons = ({ activeBackground, hoverBackground }: { activeBackground: string; hoverBackground: string }) => {
  const { t } = useTranslation();
  const [iconComponentFor, activeEditor] = useCellValues(iconComponentFor$, activeEditor$);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!activeEditor) {
      return;
    }

    return mergeRegister(
      activeEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      activeEditor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }, [activeEditor]);

  return (
    <>
      <MarkdownMobileToolbarButton
        activeBackground={activeBackground}
        hoverBackground={hoverBackground}
        ariaLabel={formatEditorTooltip(t("viewer.edit.undo", { defaultValue: "Undo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.undo)}
        disabled={!canUndo}
        onClick={() => {
          activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
        }}
      >
        {iconComponentFor("undo")}
      </MarkdownMobileToolbarButton>
      <MarkdownMobileToolbarButton
        activeBackground={activeBackground}
        hoverBackground={hoverBackground}
        ariaLabel={formatEditorTooltip(t("viewer.edit.redo", { defaultValue: "Redo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.redo)}
        disabled={!canRedo}
        onClick={() => {
          activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
        }}
      >
        {iconComponentFor("redo")}
      </MarkdownMobileToolbarButton>
    </>
  );
};

const MarkdownMobileFormatButton = ({
  activeLabel,
  activeBackground,
  hoverBackground,
  format,
  formatName,
  icon,
  inactiveLabel,
  shortcutLabel,
}: {
  activeLabel: string;
  activeBackground: string;
  hoverBackground: string;
  format: number;
  formatName: "bold" | "italic" | "underline" | "code";
  icon: IconKey;
  inactiveLabel: string;
  shortcutLabel: string;
}) => {
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const isActive = (currentFormat & format) !== 0;

  return (
    <MarkdownMobileToolbarButton
      active={isActive}
      activeBackground={activeBackground}
      hoverBackground={hoverBackground}
      ariaLabel={formatEditorTooltip(isActive ? activeLabel : inactiveLabel, shortcutLabel)}
      onClick={() => {
        applyFormat(formatName);
      }}
    >
      {iconComponentFor(icon)}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileBulletListButton = ({ activeBackground, hoverBackground }: { activeBackground: string; hoverBackground: string }) => {
  const { t } = useTranslation();
  const [currentListType, iconComponentFor, isInTable] = useCellValues(currentListType$, iconComponentFor$, editorInTable$);
  const applyListType = usePublisher(applyListType$);

  return (
    <MarkdownMobileToolbarButton
      active={currentListType === "bullet"}
      activeBackground={activeBackground}
      hoverBackground={hoverBackground}
      ariaLabel={t("viewer.edit.bulletedList", { defaultValue: "Bulleted list" })}
      disabled={isInTable}
      onClick={() => {
        applyListType(currentListType === "bullet" ? "" : "bullet");
      }}
    >
      {iconComponentFor("format_list_bulleted")}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileLinkButton = ({ activeBackground, hoverBackground }: { activeBackground: string; hoverBackground: string }) => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const openLinkDialog = useMarkdownLinkDialog();
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CREATE_LINK);

  return (
    <MarkdownMobileToolbarButton
      activeBackground={activeBackground}
      hoverBackground={hoverBackground}
      ariaLabel={title}
      onClick={() => {
        openLinkDialog();
      }}
    >
      {iconComponentFor("link")}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileMoreActionsMenu = ({ onRequestViewModeChange }: { onRequestViewModeChange: MarkdownViewModeRequestHandler }) => {
  const { t } = useTranslation();
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const currentBlockType = useCellValue(currentBlockType$) as MarkdownEditorBlockType;
  const currentListType = useCellValue(currentListType$) as MarkdownEditorListType;
  const isInTable = useCellValue(editorInTable$);
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const applyBlockType = usePublisher(applyBlockType$);
  const applyFormat = usePublisher(applyFormat$);
  const applyListType = usePublisher(applyListType$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertTable = usePublisher(insertTable$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const openLinkDialog = useMarkdownLinkDialog();
  const setViewMode = usePublisher(viewMode$);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const isOpen = Boolean(anchorEl);
  const menuId = "markdown-mobile-more-actions-menu";
  const menuLabel = t("viewer.edit.moreActions", { defaultValue: "More actions" });

  const closeMenu = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const runMenuAction = useCallback(
    (action: () => void) => {
      action();
      closeMenu();
    },
    [closeMenu]
  );

  const handleListAction = useCallback(
    (listType: Exclude<MarkdownEditorListType, "">) => {
      runMenuAction(() => {
        applyListType(currentListType === listType ? "" : listType);
      });
    },
    [applyListType, currentListType, runMenuAction]
  );

  const handleBlockTypeAction = useCallback(
    (blockType: MarkdownEditorBlockType) => {
      runMenuAction(() => {
        applyBlockType(blockType);
      });
    },
    [applyBlockType, runMenuAction]
  );

  const handleModeAction = useCallback(
    (nextViewMode: Extract<MarkdownEditorViewMode, "rich-text" | "source">) => {
      runMenuAction(() => {
        onRequestViewModeChange(nextViewMode, setViewMode);
      });
    },
    [onRequestViewModeChange, runMenuAction, setViewMode]
  );

  return (
    <>
      <IconButton
        aria-label={menuLabel}
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen ? "true" : undefined}
        aria-haspopup="menu"
        color="inherit"
        data-toolbar-item
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        size="medium"
        sx={{ flexShrink: 0, width: 44, height: 44 }}
      >
        {iconComponentFor("more_vert")}
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={isOpen}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 220,
              maxWidth: "min(280px, calc(100vw - 16px))",
            },
          },
        }}
      >
        {viewMode === "rich-text" && [
          <MenuItem
            key="list-bullet"
            selected={currentListType === "bullet"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("bullet");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_bulleted")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.bulletedList", { defaultValue: "Bulleted list" })} />
          </MenuItem>,
          <MenuItem
            key="list-number"
            selected={currentListType === "number"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("number");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_numbered")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.numberedList", { defaultValue: "Numbered list" })} />
          </MenuItem>,
          <MenuItem
            key="list-check"
            selected={currentListType === "check"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("check");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_checked")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.checkList", { defaultValue: "Checklist" })} />
          </MenuItem>,
          <MenuItem
            key="block-paragraph"
            selected={currentBlockType === "paragraph"}
            onClick={() => {
              handleBlockTypeAction("paragraph");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.paragraph", { defaultValue: "Paragraph" })} />
          </MenuItem>,
          <MenuItem
            key="block-h1"
            selected={currentBlockType === "h1"}
            onClick={() => {
              handleBlockTypeAction("h1");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading1", { defaultValue: "Heading 1" })} />
          </MenuItem>,
          <MenuItem
            key="block-h2"
            selected={currentBlockType === "h2"}
            onClick={() => {
              handleBlockTypeAction("h2");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading2", { defaultValue: "Heading 2" })} />
          </MenuItem>,
          <MenuItem
            key="block-h3"
            selected={currentBlockType === "h3"}
            onClick={() => {
              handleBlockTypeAction("h3");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading3", { defaultValue: "Heading 3" })} />
          </MenuItem>,
          <MenuItem
            key="block-quote"
            selected={currentBlockType === "quote"}
            onClick={() => {
              handleBlockTypeAction("quote");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.quote", { defaultValue: "Quote" })} />
          </MenuItem>,
          <MenuItem
            key="link"
            onClick={() => {
              runMenuAction(() => {
                openLinkDialog();
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("link")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.createLink", { defaultValue: "Create link" })} />
          </MenuItem>,
          <MenuItem
            key="inline-code"
            onClick={() => {
              runMenuAction(() => {
                applyFormat("code");
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("code")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.inlineCode", { defaultValue: "Inline code format" })} />
          </MenuItem>,
          <MenuItem
            key="table"
            disabled={isInTable}
            onClick={() => {
              runMenuAction(() => {
                insertTable({ rows: 3, columns: 3 });
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("table")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertTable", { defaultValue: "Insert table" })} />
          </MenuItem>,
          <MenuItem
            key="thematic-break"
            onClick={() => {
              runMenuAction(() => {
                insertThematicBreak();
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("horizontal_rule")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertThematicBreak", { defaultValue: "Insert thematic break" })} />
          </MenuItem>,
          <MenuItem
            key="code-block"
            onClick={() => {
              runMenuAction(() => {
                insertCodeBlock({});
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("frame_source")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertCodeBlock", { defaultValue: "Insert code block" })} />
          </MenuItem>,
        ]}
        {viewMode === "rich-text" ? (
          <MenuItem
            selected={false}
            onClick={() => {
              handleModeAction("source");
            }}
          >
            <ListItemIcon>{iconComponentFor("markdown")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.sourceMode", { defaultValue: "Source mode" })} />
          </MenuItem>
        ) : (
          <MenuItem
            selected={false}
            onClick={() => {
              handleModeAction("rich-text");
            }}
          >
            <ListItemIcon>{iconComponentFor("rich_text")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.richTextMode", { defaultValue: "Rich-text mode" })} />
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

const MarkdownMobileToolbar = ({
  activeBackground,
  hoverBackground,
  onRequestViewModeChange,
}: {
  activeBackground: string;
  hoverBackground: string;
  onRequestViewModeChange: MarkdownViewModeRequestHandler;
}) => {
  const { t } = useTranslation();
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(MOBILE_TOOLBAR_DEFAULT_WIDTH_PX);

  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) {
      return;
    }

    const measureWidth = () => {
      const measuredWidth = element.offsetWidth || window.innerWidth || MOBILE_TOOLBAR_DEFAULT_WIDTH_PX;
      if (measuredWidth > 0) {
        setToolbarWidth(measuredWidth);
      }
    };

    measureWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
          if (width > 0) {
            setToolbarWidth(width);
          }
        }
      });

      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measureWidth);
    return () => {
      window.removeEventListener("resize", measureWidth);
    };
  }, []);

  const visibleExtraActions =
    viewMode === "rich-text" ? MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY.slice(0, getVisibleMobileExtraActionCount(toolbarWidth)) : [];

  return (
    <Box
      ref={toolbarRef}
      className={MARKDOWN_MOBILE_TOOLBAR_CLASS}
      sx={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
          flexShrink: 1,
          overflow: "hidden",
        }}
      >
        {viewMode === "rich-text" && (
          <>
            <MarkdownMobileUndoRedoButtons activeBackground={activeBackground} hoverBackground={hoverBackground} />
            <MarkdownMobileFormatButton
              activeLabel={t("viewer.edit.removeBold", { defaultValue: "Remove bold" })}
              activeBackground={activeBackground}
              hoverBackground={hoverBackground}
              format={IS_BOLD}
              formatName="bold"
              icon="format_bold"
              inactiveLabel={t("viewer.edit.bold", { defaultValue: "Bold" })}
              shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.bold}
            />
            <MarkdownMobileFormatButton
              activeLabel={t("viewer.edit.removeItalic", { defaultValue: "Remove italic" })}
              activeBackground={activeBackground}
              hoverBackground={hoverBackground}
              format={IS_ITALIC}
              formatName="italic"
              icon="format_italic"
              inactiveLabel={t("viewer.edit.italic", { defaultValue: "Italic" })}
              shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.italic}
            />
            {visibleExtraActions.includes("list") ? (
              <MarkdownMobileBulletListButton activeBackground={activeBackground} hoverBackground={hoverBackground} />
            ) : null}
            {visibleExtraActions.includes("link") ? (
              <MarkdownMobileLinkButton activeBackground={activeBackground} hoverBackground={hoverBackground} />
            ) : null}
            {visibleExtraActions.includes("inline-code") ? (
              <MarkdownMobileFormatButton
                activeLabel={t("viewer.edit.removeInlineCode", { defaultValue: "Remove code format" })}
                activeBackground={activeBackground}
                hoverBackground={hoverBackground}
                format={IS_CODE}
                formatName="code"
                icon="code"
                inactiveLabel={t("viewer.edit.inlineCode", { defaultValue: "Inline code format" })}
                shortcutLabel={MARKDOWN_EDITOR_SHORTCUTS.INLINE_CODE.label}
              />
            ) : null}
            {visibleExtraActions.includes("underline") ? (
              <MarkdownMobileFormatButton
                activeLabel={t("viewer.edit.removeUnderline", { defaultValue: "Remove underline" })}
                activeBackground={activeBackground}
                hoverBackground={hoverBackground}
                format={IS_UNDERLINE}
                formatName="underline"
                icon="format_underlined"
                inactiveLabel={t("viewer.edit.underline", { defaultValue: "Underline" })}
                shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.underline}
              />
            ) : null}
          </>
        )}
      </Box>
      <MarkdownMobileMoreActionsMenu onRequestViewModeChange={onRequestViewModeChange} />
    </Box>
  );
};

const MarkdownDesktopToolbar = ({ onRequestViewModeChange }: { onRequestViewModeChange: MarkdownViewModeRequestHandler }) => {
  return (
    <>
      <MarkdownUndoRedoControls />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <MarkdownInlineFormattingToggles />
      <InlineCodeToggle />
      <Separator />
      <ListsToggle />
      <Separator />
      <CreateLinkButton />
      <InsertTableButton />
      <InsertThematicBreakButton />
      <Separator />
      <InsertCodeBlockButton />
      <Separator />
      <MarkdownViewModeToggle onRequestViewModeChange={onRequestViewModeChange} />
    </>
  );
};

const MarkdownResponsiveToolbar = ({
  activeBackground,
  hoverBackground,
  isMobile,
  onRequestViewModeChange,
  onLinkApplied,
  onViewModeChange,
  preserveEditorSelection,
  readOnly,
  restoreEditorSelection,
  onSearchStateChange,
  onCurrentRangeChange,
  onSearchCommandsChange,
  onActiveEditorChange,
  onSourceEditorPublisherChange,
  onEditorCommandsChange,
  searchOpen,
  searchText,
}: {
  activeBackground: string;
  hoverBackground: string;
  isMobile: boolean;
  onRequestViewModeChange: MarkdownViewModeRequestHandler;
  onLinkApplied?: () => void;
  onViewModeChange: (viewMode: MarkdownEditorViewMode) => void;
  preserveEditorSelection: () => void;
  readOnly: boolean;
  restoreEditorSelection: () => boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
  onCurrentRangeChange: (range: Range | null) => void;
  onSearchCommandsChange: (commands: MarkdownRichEditorSearchCommands | null) => void;
  onActiveEditorChange: (editor: LexicalEditor | null) => void;
  onSourceEditorPublisherChange: (publisher: (markdown: string) => void) => void;
  onEditorCommandsChange: (commands: MarkdownRichEditorCommands | null) => void;
  searchOpen: boolean;
  searchText: string;
}) => {
  return (
    <MarkdownLinkDialogProvider
      onLinkApplied={onLinkApplied}
      preserveEditorSelection={preserveEditorSelection}
      readOnly={readOnly}
      restoreEditorSelection={restoreEditorSelection}
    >
      <MarkdownRichEditorSearchBridge
        searchText={searchText}
        searchOpen={searchOpen}
        onSearchStateChange={onSearchStateChange}
        onCurrentRangeChange={onCurrentRangeChange}
        onCommandsChange={onSearchCommandsChange}
      />
      <MarkdownViewModeBridge onViewModeChange={onViewModeChange} />
      <MarkdownSourceModeSeedBridge onPublisherChange={onSourceEditorPublisherChange} />
      <MarkdownActiveEditorBridge onActiveEditorChange={onActiveEditorChange} />
      <MarkdownDecoratorArrowNavigationBridge />
      <MarkdownRichEditorCommandBridge onCommandsChange={onEditorCommandsChange} />
      {isMobile ? (
        <MarkdownMobileToolbar
          activeBackground={activeBackground}
          hoverBackground={hoverBackground}
          onRequestViewModeChange={onRequestViewModeChange}
        />
      ) : (
        <MarkdownDesktopToolbar onRequestViewModeChange={onRequestViewModeChange} />
      )}
    </MarkdownLinkDialogProvider>
  );
};

const MarkdownRichEditorSearchBridge = ({
  searchText,
  searchOpen,
  onSearchStateChange,
  onCurrentRangeChange,
  onCommandsChange,
}: MarkdownRichEditorSearchBridgeProps) => {
  const { closeSearch, currentRange, cursor, isSearchOpen, next, openSearch, prev, search, setSearch, total } = useEditorSearch();
  const viewMode = useCellValue(viewMode$);
  const isSearchable = viewMode === "rich-text";
  const lastReportedSearchStateRef = useRef<MarkdownRichEditorSearchState | null>(null);
  const requestedSearchValueRef = useRef<string | null | undefined>(undefined);
  const requestedSearchOpenRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    onCommandsChange(isSearchable ? { nextSearchResult: next, previousSearchResult: prev } : NOOP_SEARCH_COMMANDS);

    return () => {
      onCommandsChange(null);
    };
  }, [isSearchable, next, onCommandsChange, prev]);

  useLayoutEffect(() => {
    const nextSearchValue = searchText.trim().length > 0 ? searchText : null;

    if (!isSearchable) {
      if (search === null) {
        requestedSearchValueRef.current = null;
      } else if (requestedSearchValueRef.current !== null) {
        setSearch(null);
        requestedSearchValueRef.current = null;
      }

      if (isSearchOpen) {
        closeSearch();
        requestedSearchOpenRef.current = false;
      } else {
        requestedSearchOpenRef.current = false;
      }

      return;
    }

    if (search === nextSearchValue) {
      requestedSearchValueRef.current = nextSearchValue;
      return;
    }

    if (requestedSearchValueRef.current !== nextSearchValue) {
      setSearch(nextSearchValue);
      requestedSearchValueRef.current = nextSearchValue;
    }
  }, [closeSearch, isSearchOpen, isSearchable, search, searchText, setSearch]);

  useLayoutEffect(() => {
    if (!isSearchable) {
      onCurrentRangeChange(null);
      return;
    }

    if (searchOpen) {
      if (isSearchOpen) {
        requestedSearchOpenRef.current = true;
      } else if (requestedSearchOpenRef.current !== true) {
        openSearch();
        requestedSearchOpenRef.current = true;
      }

      return;
    }

    onCurrentRangeChange(null);

    if (isSearchOpen) {
      closeSearch();
      requestedSearchOpenRef.current = false;
    } else {
      requestedSearchOpenRef.current = false;
    }
  }, [closeSearch, isSearchOpen, isSearchable, onCurrentRangeChange, openSearch, searchOpen]);

  useEffect(() => {
    onCurrentRangeChange(isSearchable ? currentRange : null);
  }, [currentRange, isSearchable, onCurrentRangeChange]);

  useEffect(() => {
    if (!isSearchable || !searchOpen || !search.trim() || total === 0 || cursor !== 0) {
      return;
    }

    next();
  }, [cursor, isSearchable, next, search, searchOpen, total]);

  useEffect(() => {
    const nextSearchState: MarkdownRichEditorSearchState = {
      searchText: search,
      searchMatches: total,
      currentMatch: total > 0 ? Math.max(cursor, 1) : 0,
      isSearchOpen,
      isSearchable,
      viewMode,
    };

    const lastSearchState = lastReportedSearchStateRef.current;
    if (lastSearchState && areMarkdownSearchStatesEqual(lastSearchState, nextSearchState)) {
      return;
    }

    lastReportedSearchStateRef.current = nextSearchState;
    onSearchStateChange?.(nextSearchState);
  }, [cursor, isSearchOpen, isSearchable, onSearchStateChange, search, total, viewMode]);

  return null;
};

const MarkdownRichEditor = forwardRef<MarkdownRichEditorHandle, MarkdownRichEditorProps>(
  (
    {
      markdown,
      diffMarkdown = markdown,
      onChange,
      onUserEdit,
      ariaLabel,
      autoFocus = false,
      readOnly = false,
      className,
      searchText = "",
      searchOpen = false,
      onSearchStateChange,
    },
    ref
  ) => {
    const editorRef = useRef<MDXEditorMethods>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const activeEditorRef = useRef<LexicalEditor | null>(null);
    const activeSearchRangeRef = useRef<Range | null>(null);
    const preservedSelectionRef = useRef<MarkdownRichEditorSelectionSnapshot | null>(null);
    const searchCommandsRef = useRef<MarkdownRichEditorSearchCommands>(NOOP_SEARCH_COMMANDS);
    const commandsRef = useRef<MarkdownRichEditorCommands>(NOOP_EDITOR_COMMANDS);
    const pendingPublicationGenerationRef = useRef(0);
    const pendingPublicationScheduledRef = useRef(false);
    const inFlightPublicationGenerationRef = useRef(0);
    const needsPublicationRetriggerRef = useRef(false);
    const pendingPublicationPromiseRef = useRef<Promise<void> | null>(null);
    const resolvePendingPublicationPromiseRef = useRef<(() => void) | null>(null);
    const hasAttemptedAutoFocusRef = useRef(false);
    const sourceEditorPublisherRef = useRef<(markdown: string) => void>(() => {});
    const [viewModeTransitionError, setViewModeTransitionError] = useState<string | null>(null);
    const { t } = useTranslation();
    const { currentTheme } = useSambeeTheme();
    const muiTheme = useTheme();
    const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));
    const {
      viewerBg,
      toolbarBg: _toolbarBg,
      toolbarText: _toolbarText,
      viewerText,
      linkColor,
      linkHoverColor,
    } = getViewerColors(currentTheme, "markdown");
    const secondaryToolbarSelectedBackground = getSecondaryToolbarSelectedBackground(muiTheme, currentTheme);
    const secondaryToolbarColors = getSecondaryToolbarSurfaceColors(muiTheme, {
      pillBackground: secondaryToolbarSelectedBackground,
      activeBackground: secondaryToolbarSelectedBackground,
      hoverBackground: secondaryToolbarSelectedBackground,
    });
    const secondaryToolbarCssVars = {
      "--basePageBg": secondaryToolbarColors.popupBackground,
      "--baseBg": secondaryToolbarColors.stripBackground,
      "--baseBgSubtle": secondaryToolbarColors.pillBackground,
      "--baseBgHover": secondaryToolbarColors.hoverBackground,
      "--baseBgActive": secondaryToolbarColors.pillBackground,
      "--baseBorder": secondaryToolbarColors.borderColor,
      "--baseBase": secondaryToolbarColors.groupedBackground,
      "--baseTextContrast": secondaryToolbarColors.textColor,
    };
    const markdownEditorContentStyles = getMarkdownEditorContentStyles(
      viewerText,
      linkColor,
      linkHoverColor
    ) as unknown as SystemStyleObject<Theme>;
    const editorRootClassName = [className, MARKDOWN_EDITOR_POPUP_CLASS].filter(Boolean).join(" ");

    const syncPopupContainerLayering = useCallback(() => {
      const popupContainers = document.querySelectorAll<HTMLElement>(`.mdxeditor-popup-container.${MARKDOWN_EDITOR_POPUP_CLASS}`);

      popupContainers.forEach((popupContainer) => {
        const zIndex = String(MARKDOWN_EDITOR_POPUP_Z_INDEX);
        if (popupContainer.style.zIndex !== zIndex) {
          popupContainer.style.zIndex = zIndex;
        }
      });
    }, []);

    const syncTableToolButtonLabels = useCallback(() => {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      const buttonLabels = [
        {
          selector: ".mdxeditor [class*='addColumnButton']",
          label: t("viewer.edit.addColumn", { defaultValue: "Add column" }),
        },
        {
          selector: ".mdxeditor [class*='addRowButton']",
          label: t("viewer.edit.addRow", { defaultValue: "Add row" }),
        },
      ];

      for (const { selector, label } of buttonLabels) {
        for (const button of container.querySelectorAll<HTMLButtonElement>(selector)) {
          if (button.getAttribute("aria-label") !== label) {
            button.setAttribute("aria-label", label);
          }

          if (button.getAttribute("title") !== label) {
            button.setAttribute("title", label);
          }

          if (button.getAttribute("data-editor-tooltip") !== label) {
            button.setAttribute("data-editor-tooltip", label);
          }

          if (!button.hasAttribute("data-toolbar-item")) {
            button.setAttribute("data-toolbar-item", "");
          }
        }
      }
    }, [t]);

    const focusEditableArea = useCallback((preventScroll = false, preferredViewMode?: MarkdownEditorViewMode) => {
      const container = containerRef.current;

      if (!container) {
        return false;
      }

      const selectorGroups: Record<MarkdownEditorViewMode, string[]> = {
        "rich-text": ['[role="textbox"][aria-label="Markdown editor"][contenteditable="true"]'],
        source: ['.mdxeditor-source-editor .cm-content[contenteditable="true"]'],
        diff: ['.mdxeditor-diff-source-wrapper .cm-merge-b .cm-content[contenteditable="true"]'],
      };
      const selectors = preferredViewMode
        ? [...selectorGroups[preferredViewMode], "textarea"]
        : [
            '[role="textbox"][aria-label="Markdown editor"][contenteditable="true"]',
            '.cm-content[contenteditable="true"]',
            "textarea",
            '[contenteditable="true"]',
          ];

      const editable = selectors
        .flatMap((selector) => Array.from(container.querySelectorAll<HTMLElement>(selector)))
        .find((element) => {
          const computedStyle = getComputedStyle(element);
          return computedStyle.display !== "none" && computedStyle.visibility !== "hidden";
        });

      if (!(editable instanceof HTMLElement)) {
        return false;
      }

      editable.focus({ preventScroll });
      return document.activeElement === editable;
    }, []);

    const restoreFocusAfterViewModeChange = useCallback(
      (viewMode: MarkdownEditorViewMode) => {
        if (readOnly) {
          return;
        }

        const interactionRoot = containerRef.current;
        const activeElement = document.activeElement;

        if (interactionRoot && activeElement instanceof HTMLElement && !interactionRoot.contains(activeElement)) {
          return;
        }

        let cleanupRetryFocus: (() => void) | null = null;
        let focusComplete = false;

        const stopFocusRestore = () => {
          if (focusComplete) {
            return;
          }

          focusComplete = true;
          cleanupRetryFocus?.();
        };

        const attemptFocus = () => {
          if (focusComplete) {
            return true;
          }

          editorRef.current?.focus();
          const restored = focusEditableArea(true, viewMode);

          if (restored) {
            stopFocusRestore();
          }

          return restored;
        };

        cleanupRetryFocus = scheduleRetriableFocusRestore({
          delaysMs: MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS,
          attemptRestore: attemptFocus,
        });

        requestAnimationFrame(() => {
          attemptFocus();
        });
      },
      [focusEditableArea, readOnly]
    );

    const captureViewport = useCallback((editable: HTMLElement): MarkdownRichEditorViewportSnapshot => {
      const anchors: MarkdownRichEditorViewportAnchor[] = [];
      let element: HTMLElement | null = editable;

      while (element) {
        if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
          anchors.push({
            element,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft,
          });
        }

        element = element.parentElement;
      }

      return { anchors };
    }, []);

    const restoreViewport = useCallback((viewport: MarkdownRichEditorViewportSnapshot) => {
      const applyViewport = () => {
        for (const anchor of [...viewport.anchors].reverse()) {
          if (!anchor.element.isConnected) {
            continue;
          }

          anchor.element.scrollTop = anchor.scrollTop;
          anchor.element.scrollLeft = anchor.scrollLeft;
        }
      };

      applyViewport();
      requestAnimationFrame(applyViewport);
    }, []);

    const captureSelection = useCallback((): MarkdownRichEditorSelectionSnapshot | null => {
      const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');

      if (editable instanceof HTMLTextAreaElement) {
        return {
          type: "textarea",
          start: editable.selectionStart ?? 0,
          end: editable.selectionEnd ?? 0,
          direction: editable.selectionDirection ?? "none",
          viewport: captureViewport(editable),
        };
      }

      if (!(editable instanceof HTMLElement)) {
        return null;
      }

      const activeEditor = activeEditorRef.current;

      if (!activeEditor) {
        return null;
      }

      return activeEditor.getEditorState().read(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          return {
            type: "lexical-range",
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
            format: selection.format,
            style: selection.style,
            viewport: captureViewport(editable),
          };
        }

        if ($isNodeSelection(selection)) {
          return {
            type: "lexical-node",
            keys: selection.getNodes().map((node) => node.getKey()),
            viewport: captureViewport(editable),
          };
        }

        return null;
      });
    }, [captureViewport]);

    const focusCurrentSearchRange = useCallback((): boolean => {
      const currentRange = activeSearchRangeRef.current;

      if (!currentRange) {
        return focusEditableArea(true);
      }

      const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');
      const activeEditor = activeEditorRef.current;

      if (!(editable instanceof HTMLElement) || !activeEditor) {
        return focusEditableArea(true);
      }

      let restored = false;

      editable.focus({ preventScroll: true });
      activeEditor.update(
        () => {
          const startNode = $getNearestNodeFromDOMNode(currentRange.startContainer);
          const endNode = $getNearestNodeFromDOMNode(currentRange.endContainer);

          if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
            return;
          }

          const rangeSelection = $createRangeSelection();
          rangeSelection.anchor.set(startNode.getKey(), currentRange.startOffset, "text");
          rangeSelection.focus.set(endNode.getKey(), currentRange.endOffset, "text");
          $setSelection(rangeSelection);
          restored = true;
        },
        { discrete: true }
      );

      return restored || focusEditableArea(true);
    }, [focusEditableArea]);

    const restoreSelection = useCallback(
      (selectionSnapshot: MarkdownRichEditorSelectionSnapshot | null): boolean => {
        if (!selectionSnapshot) {
          return focusEditableArea();
        }

        const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');

        if (selectionSnapshot.type === "textarea") {
          if (!(editable instanceof HTMLTextAreaElement)) {
            return focusEditableArea();
          }

          editable.focus({ preventScroll: true });
          editable.setSelectionRange(selectionSnapshot.start, selectionSnapshot.end, selectionSnapshot.direction);
          restoreViewport(selectionSnapshot.viewport);
          return document.activeElement === editable;
        }

        const activeEditor = activeEditorRef.current;

        if (!(editable instanceof HTMLElement) || !activeEditor) {
          return focusEditableArea();
        }

        let restored = false;

        editable.focus({ preventScroll: true });
        activeEditor.update(
          () => {
            if (selectionSnapshot.type === "lexical-range") {
              if (!$getNodeByKey(selectionSnapshot.anchor.key) || !$getNodeByKey(selectionSnapshot.focus.key)) {
                return;
              }

              const rangeSelection = $createRangeSelection();
              rangeSelection.anchor.set(selectionSnapshot.anchor.key, selectionSnapshot.anchor.offset, selectionSnapshot.anchor.type);
              rangeSelection.focus.set(selectionSnapshot.focus.key, selectionSnapshot.focus.offset, selectionSnapshot.focus.type);
              rangeSelection.format = selectionSnapshot.format;
              rangeSelection.style = selectionSnapshot.style;
              $setSelection(rangeSelection);
              restored = true;
              return;
            }

            const restoredNodeKeys = selectionSnapshot.keys.filter((key) => $getNodeByKey(key) !== null);

            if (restoredNodeKeys.length === 0) {
              return;
            }

            const nodeSelection = $createNodeSelection();

            for (const key of restoredNodeKeys) {
              nodeSelection.add(key);
            }

            $setSelection(nodeSelection);
            restored = true;
          },
          { discrete: true }
        );

        if (restored) {
          restoreViewport(selectionSnapshot.viewport);
        }

        return restored || focusEditableArea();
      },
      [focusEditableArea, restoreViewport]
    );

    const schedulePendingPublicationDispatch = useCallback(() => {
      emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:enter", {
        pendingScheduled: pendingPublicationScheduledRef.current,
        inFlightGeneration: inFlightPublicationGenerationRef.current,
        pendingGeneration: pendingPublicationGenerationRef.current,
      });

      if (pendingPublicationScheduledRef.current || inFlightPublicationGenerationRef.current !== 0) {
        emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:skipped", {
          reason: pendingPublicationScheduledRef.current ? "already-scheduled" : "in-flight",
          inFlightGeneration: inFlightPublicationGenerationRef.current,
          pendingGeneration: pendingPublicationGenerationRef.current,
        });
        return;
      }

      pendingPublicationScheduledRef.current = true;

      queueMicrotask(() => {
        pendingPublicationScheduledRef.current = false;

        emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:microtask", {
          inFlightGeneration: inFlightPublicationGenerationRef.current,
          pendingGeneration: pendingPublicationGenerationRef.current,
          hasActiveEditor: activeEditorRef.current !== null,
        });

        if (inFlightPublicationGenerationRef.current !== 0 || pendingPublicationGenerationRef.current === 0) {
          emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:microtask-skipped", {
            reason: inFlightPublicationGenerationRef.current !== 0 ? "in-flight" : "no-pending-generation",
            inFlightGeneration: inFlightPublicationGenerationRef.current,
            pendingGeneration: pendingPublicationGenerationRef.current,
          });
          return;
        }

        const activeEditor = activeEditorRef.current;

        if (!activeEditor) {
          emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:no-active-editor", {
            pendingGeneration: pendingPublicationGenerationRef.current,
          });
          const resolvePendingPublication = resolvePendingPublicationPromiseRef.current;

          pendingPublicationPromiseRef.current = null;
          resolvePendingPublicationPromiseRef.current = null;
          needsPublicationRetriggerRef.current = false;
          inFlightPublicationGenerationRef.current = 0;
          resolvePendingPublication?.();
          return;
        }

        inFlightPublicationGenerationRef.current = pendingPublicationGenerationRef.current;
        emitMarkdownDebugTrace("MarkdownRichEditor", "schedulePendingPublicationDispatch:dispatch", {
          dispatchGeneration: inFlightPublicationGenerationRef.current,
          pendingGeneration: pendingPublicationGenerationRef.current,
        });
        activeEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
      });
    }, []);

    const completePendingPublicationFlush = useCallback(() => {
      emitMarkdownDebugTrace("MarkdownRichEditor", "completePendingPublicationFlush:enter", {
        inFlightGeneration: inFlightPublicationGenerationRef.current,
        pendingGeneration: pendingPublicationGenerationRef.current,
        needsRetrigger: needsPublicationRetriggerRef.current,
      });

      if (inFlightPublicationGenerationRef.current === 0) {
        emitMarkdownDebugTrace("MarkdownRichEditor", "completePendingPublicationFlush:skipped", {
          reason: "no-in-flight-generation",
        });
        return;
      }

      if (needsPublicationRetriggerRef.current && pendingPublicationGenerationRef.current > inFlightPublicationGenerationRef.current) {
        emitMarkdownDebugTrace("MarkdownRichEditor", "completePendingPublicationFlush:retrigger", {
          inFlightGeneration: inFlightPublicationGenerationRef.current,
          pendingGeneration: pendingPublicationGenerationRef.current,
        });
        inFlightPublicationGenerationRef.current = 0;
        needsPublicationRetriggerRef.current = false;
        schedulePendingPublicationDispatch();
        return;
      }

      const resolvePendingPublication = resolvePendingPublicationPromiseRef.current;

      pendingPublicationPromiseRef.current = null;
      resolvePendingPublicationPromiseRef.current = null;
      inFlightPublicationGenerationRef.current = 0;
      needsPublicationRetriggerRef.current = false;
      emitMarkdownDebugTrace("MarkdownRichEditor", "completePendingPublicationFlush:resolved", {
        pendingGeneration: pendingPublicationGenerationRef.current,
      });
      resolvePendingPublication?.();
    }, [schedulePendingPublicationDispatch]);

    const requestPendingPublication = useCallback(
      (ensurePromise: boolean) => {
        pendingPublicationGenerationRef.current += 1;

        emitMarkdownDebugTrace("MarkdownRichEditor", "requestPendingPublication", {
          ensurePromise,
          pendingGeneration: pendingPublicationGenerationRef.current,
          inFlightGeneration: inFlightPublicationGenerationRef.current,
          hasPromise: pendingPublicationPromiseRef.current !== null,
        });

        if (ensurePromise && pendingPublicationPromiseRef.current === null) {
          pendingPublicationPromiseRef.current = new Promise<void>((resolve) => {
            resolvePendingPublicationPromiseRef.current = resolve;
          });

          emitMarkdownDebugTrace("MarkdownRichEditor", "requestPendingPublication:created-promise", {
            pendingGeneration: pendingPublicationGenerationRef.current,
          });
        }

        if (inFlightPublicationGenerationRef.current !== 0) {
          needsPublicationRetriggerRef.current = true;
          emitMarkdownDebugTrace("MarkdownRichEditor", "requestPendingPublication:marked-retrigger", {
            inFlightGeneration: inFlightPublicationGenerationRef.current,
            pendingGeneration: pendingPublicationGenerationRef.current,
          });
        }

        schedulePendingPublicationDispatch();
        return pendingPublicationPromiseRef.current;
      },
      [schedulePendingPublicationDispatch]
    );

    const synchronizeFocusedNestedTableCell = useCallback(async () => {
      const activeEditorRoot = activeEditorRef.current?.getRootElement();

      if (!(activeEditorRoot instanceof HTMLElement) || !activeEditorRoot.closest(NESTED_TABLE_CELL_EDITABLE_SELECTOR)) {
        emitMarkdownDebugTrace("MarkdownRichEditor", "synchronizeFocusedNestedTableCell:skipped", {
          reason: "no-focused-nested-editor",
        });
        return false;
      }

      emitMarkdownDebugTrace("MarkdownRichEditor", "synchronizeFocusedNestedTableCell:dispatch");
      activeEditorRef.current?.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });

      emitMarkdownDebugTrace("MarkdownRichEditor", "synchronizeFocusedNestedTableCell:resolved");
      return true;
    }, []);

    const flushPendingEdits = useCallback(() => {
      emitMarkdownDebugTrace("MarkdownRichEditor", "flushPendingEdits:start", {
        pendingGeneration: pendingPublicationGenerationRef.current,
        inFlightGeneration: inFlightPublicationGenerationRef.current,
      });

      // Save/source-mode callers use this as a boundary wait. If there is no
      // nested publication work in flight already, creating a new request here
      // re-enters the table publication path unnecessarily and can hang.
      if (pendingPublicationGenerationRef.current === 0 && inFlightPublicationGenerationRef.current === 0) {
        return synchronizeFocusedNestedTableCell().then((didSynchronizeNestedCell) => {
          emitMarkdownDebugTrace("MarkdownRichEditor", "flushPendingEdits:resolved-no-pending-work", {
            didSynchronizeNestedCell,
          });
        });
      }

      const pendingPublicationPromise = requestPendingPublication(true);

      if (pendingPublicationPromise === null) {
        emitMarkdownDebugTrace("MarkdownRichEditor", "flushPendingEdits:resolved-immediately");
        return Promise.resolve();
      }

      return pendingPublicationPromise.then(() => {
        emitMarkdownDebugTrace("MarkdownRichEditor", "flushPendingEdits:resolved", {
          pendingGeneration: pendingPublicationGenerationRef.current,
          inFlightGeneration: inFlightPublicationGenerationRef.current,
        });
      });
    }, [requestPendingPublication, synchronizeFocusedNestedTableCell]);

    const handleMdxEditorChange = useCallback(
      (nextMarkdown: string) => {
        const isPublicationDrivenUpdate = inFlightPublicationGenerationRef.current !== 0 || pendingPublicationGenerationRef.current !== 0;
        const reportedMarkdown = isPublicationDrivenUpdate ? normalizeMarkdownTableCellLineBreaks(nextMarkdown) : nextMarkdown;

        emitMarkdownDebugTrace("MarkdownRichEditor", "handleMdxEditorChange", {
          isPublicationDrivenUpdate,
          nextMarkdownLength: nextMarkdown.length,
          reportedMarkdownLength: reportedMarkdown.length,
          inFlightGeneration: inFlightPublicationGenerationRef.current,
          pendingGeneration: pendingPublicationGenerationRef.current,
        });

        onChange(reportedMarkdown);
        completePendingPublicationFlush();
      },
      [completePendingPublicationFlush, onChange]
    );

    const getCanonicalMarkdown = useCallback(() => {
      const markdown = editorRef.current?.getMarkdown();

      if (typeof markdown !== "string") {
        throw new Error("Canonical markdown export is unavailable");
      }

      // MDXEditor is the only authoritative rich-text payload. The outer draft
      // can lag while a nested table cell still owns focus, so every save/source
      // transition re-normalizes the live export instead of trusting draft state.
      return normalizeMarkdownTableCellLineBreaks(markdown);
    }, []);

    const requestViewModeChange = useCallback<MarkdownViewModeRequestHandler>(
      async (nextViewMode, commitViewMode) => {
        setViewModeTransitionError(null);

        if (nextViewMode === "rich-text") {
          commitViewMode(nextViewMode);
          return;
        }

        preservedSelectionRef.current = captureSelection();

        try {
          await flushPendingEdits();

          const canonicalMarkdown = getCanonicalMarkdown();
          onChange(canonicalMarkdown);

          // Source mode must consume canonical markdown after MDXEditor finishes
          // its own rich-text exit synchronization. Seeding the markdown cell
          // before the mode commit gets overwritten by that internal sync.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });

          commitViewMode("source");

          requestAnimationFrame(() => {
            sourceEditorPublisherRef.current(canonicalMarkdown);
          });
        } catch (error) {
          setViewModeTransitionError(
            error instanceof Error && error.message
              ? error.message
              : t("viewer.edit.sourceModeFailed", { defaultValue: "Unable to switch to source mode." })
          );

          requestAnimationFrame(() => {
            restoreSelection(preservedSelectionRef.current);
          });
        }
      },
      [captureSelection, flushPendingEdits, getCanonicalMarkdown, onChange, restoreSelection, t]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
          requestAnimationFrame(() => {
            focusEditableArea();
          });
        },
        flushPendingEdits,
        getCanonicalMarkdown,
        preserveSelection: () => {
          preservedSelectionRef.current = captureSelection();
        },
        restorePreservedSelection: () => {
          const restored = restoreSelection(preservedSelectionRef.current);

          if (restored) {
            preservedSelectionRef.current = null;
          }

          return restored;
        },
        focusCurrentSearchResult: () => focusCurrentSearchRange(),
        nextSearchResult: () => {
          searchCommandsRef.current.nextSearchResult();
        },
        previousSearchResult: () => {
          searchCommandsRef.current.previousSearchResult();
        },
        createLink: () => {
          commandsRef.current.createLink();
        },
        insertTable: () => {
          commandsRef.current.insertTable();
        },
        insertThematicBreak: () => {
          commandsRef.current.insertThematicBreak();
        },
        toggleInlineCode: () => {
          commandsRef.current.toggleInlineCode();
        },
        insertCodeBlock: () => {
          commandsRef.current.insertCodeBlock();
        },
      }),
      [captureSelection, flushPendingEdits, focusCurrentSearchRange, focusEditableArea, getCanonicalMarkdown, restoreSelection]
    );

    useEffect(() => {
      return () => {
        const resolvePendingPublication = resolvePendingPublicationPromiseRef.current;

        pendingPublicationPromiseRef.current = null;
        resolvePendingPublicationPromiseRef.current = null;
        inFlightPublicationGenerationRef.current = 0;
        needsPublicationRetriggerRef.current = false;
        pendingPublicationScheduledRef.current = false;
        resolvePendingPublication?.();
      };
    }, []);

    useEffect(() => {
      syncPopupContainerLayering();
      syncTableToolButtonLabels();

      const observer = new MutationObserver(() => {
        syncPopupContainerLayering();
        syncTableToolButtonLabels();
      });

      observer.observe(document.body, { childList: true, subtree: true });

      return () => {
        observer.disconnect();
      };
    }, [syncPopupContainerLayering, syncTableToolButtonLabels]);

    useEffect(() => {
      if (!autoFocus || readOnly || hasAttemptedAutoFocusRef.current) {
        return;
      }

      hasAttemptedAutoFocusRef.current = true;

      let autofocusComplete = false;
      let cleanupRetryFocus: (() => void) | null = null;
      const interactionRoot = containerRef.current;

      const handleFocusIn = (event: FocusEvent) => {
        const target = event.target;

        if (target instanceof HTMLElement && target.matches('[contenteditable="true"], textarea')) {
          stopAutoFocus();
        }
      };

      const observer = new MutationObserver(() => {
        attemptFocus();
      });

      const stopAutoFocus = () => {
        if (autofocusComplete) {
          return;
        }

        autofocusComplete = true;
        observer.disconnect();
        interactionRoot?.removeEventListener("focusin", handleFocusIn);
        cleanupRetryFocus?.();
      };

      const attemptFocus = () => {
        if (autofocusComplete) {
          return;
        }

        editorRef.current?.focus();

        if (focusEditableArea()) {
          stopAutoFocus();
        }
      };

      cleanupRetryFocus = scheduleRetriableFocusRestore({
        delaysMs: MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS,
        attemptRestore: () => {
          attemptFocus();
          return autofocusComplete;
        },
      });

      if (interactionRoot) {
        interactionRoot.addEventListener("focusin", handleFocusIn);
        observer.observe(interactionRoot, { childList: true, subtree: true });
      }

      return () => {
        stopAutoFocus();
      };
    }, [autoFocus, focusEditableArea, readOnly]);

    useEffect(() => {
      if (readOnly) {
        return;
      }

      const interactionRoot = containerRef.current;

      if (!interactionRoot) {
        return;
      }

      const handleUserEdit = (event: Event) => {
        const target = event.target;

        if (!(target instanceof HTMLElement) || !target.closest('[contenteditable="true"], textarea')) {
          return;
        }

        onUserEdit?.();

        if (target.closest(NESTED_TABLE_CELL_EDITABLE_SELECTOR)) {
          // Publishing from nested beforeinput was the crash trigger for
          // Shift+Enter + continued typing. We only publish after the nested
          // edit has actually landed in editor state.
          if (event.type === "beforeinput") {
            emitMarkdownDebugTrace("MarkdownRichEditor", "handleUserEdit:nested-skipped", {
              eventType: event.type,
              reason: "beforeinput",
            });
            return;
          }

          emitMarkdownDebugTrace("MarkdownRichEditor", "handleUserEdit:nested", {
            eventType: event.type,
          });
          requestPendingPublication(false);
        }
      };

      const eventNames = ["beforeinput", "input", "change", "paste", "cut", "drop"];
      for (const eventName of eventNames) {
        interactionRoot.addEventListener(eventName, handleUserEdit);
      }

      return () => {
        for (const eventName of eventNames) {
          interactionRoot.removeEventListener(eventName, handleUserEdit);
        }
      };
    }, [onUserEdit, readOnly, requestPendingPublication]);

    useEffect(() => {
      if (readOnly) {
        return;
      }

      const interactionRoot = containerRef.current;

      if (!interactionRoot) {
        return;
      }

      const handleNestedShiftEnter = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }

        const target = event.target;

        if (!(target instanceof HTMLElement)) {
          return;
        }

        const nestedEditable = target.closest(NESTED_TABLE_CELL_EDITABLE_SELECTOR);

        if (!(nestedEditable instanceof HTMLElement)) {
          return;
        }

        const nestedEditor = (nestedEditable as NestedLexicalContentEditableElement).__lexicalEditor;

        if (!nestedEditor) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        onUserEdit?.();
        emitMarkdownDebugTrace("MarkdownRichEditor", "handleNestedShiftEnter", {
          eventType: event.type,
        });
        nestedEditor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
      };

      interactionRoot.addEventListener("keydown", handleNestedShiftEnter, true);

      return () => {
        interactionRoot.removeEventListener("keydown", handleNestedShiftEnter, true);
      };
    }, [onUserEdit, readOnly]);

    useEffect(() => {
      const currentMarkdown = editorRef.current?.getMarkdown();
      if (editorRef.current && currentMarkdown !== markdown) {
        editorRef.current.setMarkdown(markdown);
      }
    }, [markdown]);

    useEffect(() => {
      const editable = containerRef.current?.querySelector('[contenteditable="true"]');
      if (editable instanceof HTMLElement) {
        editable.setAttribute("aria-label", ariaLabel);
      }
    }, [ariaLabel]);

    const plugins = useMemo(
      () => [
        headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        tablePlugin(),
        tableCellShiftTabBridgePlugin(),
        codeBlockPlugin({
          defaultCodeBlockLanguage: MARKDOWN_CODE_BLOCK_DEFAULT_LANGUAGE,
          codeBlockEditorDescriptors: [MARKDOWN_CODE_BLOCK_EDITOR_DESCRIPTOR],
        }),
        codeMirrorPlugin({ codeBlockLanguages: MARKDOWN_CODE_BLOCK_LANGUAGES }),
        linkPlugin(),
        markdownShortcutPlugin(),
        mdxEditorSearchPlugin(),
        diffSourcePlugin({ viewMode: "rich-text", diffMarkdown }),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <MarkdownResponsiveToolbar
                activeBackground={secondaryToolbarColors.pillBackground}
                hoverBackground={secondaryToolbarColors.hoverBackground}
                isMobile={isMobile}
                onRequestViewModeChange={requestViewModeChange}
                onLinkApplied={onUserEdit}
                onViewModeChange={restoreFocusAfterViewModeChange}
                preserveEditorSelection={() => {
                  preservedSelectionRef.current = captureSelection();
                }}
                readOnly={readOnly}
                restoreEditorSelection={() => restoreSelection(preservedSelectionRef.current)}
                searchText={searchText}
                searchOpen={searchOpen}
                onSearchStateChange={onSearchStateChange}
                onCurrentRangeChange={(range) => {
                  activeSearchRangeRef.current = range;
                }}
                onSearchCommandsChange={(commands) => {
                  searchCommandsRef.current = commands ?? NOOP_SEARCH_COMMANDS;
                }}
                onActiveEditorChange={(editor) => {
                  activeEditorRef.current = editor;
                }}
                onSourceEditorPublisherChange={(publisher) => {
                  sourceEditorPublisherRef.current = publisher;
                }}
                onEditorCommandsChange={(commands) => {
                  commandsRef.current = commands ?? NOOP_EDITOR_COMMANDS;
                }}
              />
            </>
          ),
        }),
      ],
      [
        diffMarkdown,
        isMobile,
        onUserEdit,
        readOnly,
        onSearchStateChange,
        searchOpen,
        searchText,
        secondaryToolbarColors.hoverBackground,
        secondaryToolbarColors.pillBackground,
        captureSelection,
        restoreSelection,
        restoreFocusAfterViewModeChange,
        requestViewModeChange,
      ]
    );

    return (
      <>
        <GlobalStyles
          styles={{
            [`.${MARKDOWN_EDITOR_POPUP_CLASS}`]: {
              ...secondaryToolbarCssVars,
              color: secondaryToolbarColors.textColor,
            },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectContainer'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarButtonDropdownContainer'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectContainer']`]:
              {
                backgroundColor: secondaryToolbarColors.popupBackground,
                color: secondaryToolbarColors.textColor,
                boxShadow: secondaryToolbarColors.shadow,
              },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='tableColumnEditorPopoverContent']`]: {
              backgroundColor: viewerBg,
              color: viewerText,
              border: `1px solid ${secondaryToolbarColors.borderColor}`,
              boxShadow: secondaryToolbarColors.shadow,
            },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='tableColumnEditorToolbar']`]: {
              backgroundColor: viewerBg,
              color: viewerText,
            },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='tableColumnEditorPopoverContent'] [class*='popoverArrow'] polygon`]: {
              fill: viewerBg,
            },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectItem'][data-highlighted], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectItem'][data-state='checked'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectItem'][data-highlighted], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectItem'][data-state='checked']`]:
              {
                backgroundColor: secondaryToolbarColors.pillBackground,
              },
          }}
        />
        <Box
          ref={containerRef}
          className={className}
          sx={{
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            "& .mdxeditor": {
              ...secondaryToolbarCssVars,
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr)",
              overflow: "hidden",
              color: viewerText,
            },
            "& .mdxeditor-toolbar": {
              ...getSecondaryActionStripStyle(muiTheme),
              position: "relative",
              top: "auto",
              width: "100%",
              flexShrink: 0,
              boxSizing: "border-box",
              overflowX: isMobile ? "hidden" : "auto",
              overflowY: "hidden",
              borderRadius: 0,
            },
            "& .mdxeditor-toolbar svg": {
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar div[role='separator']": {
              borderLeftColor: secondaryToolbarColors.borderColor,
              borderRightColor: secondaryToolbarColors.separatorColor,
            },
            "& .mdxeditor-toolbar [data-toolbar-item]": {
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarToggleSingleGroup'], & .mdxeditor-toolbar [class*='toolbarGroupOfGroups']": {
              backgroundColor: "transparent",
            },
            "& .mdxeditor-toolbar [class*='toolbarToggleItem'][data-state='on']": {
              backgroundColor: secondaryToolbarColors.pillBackground,
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarNodeKindSelectTrigger'], & .mdxeditor-toolbar [class*='toolbarButtonSelectTrigger'], & .mdxeditor-toolbar [class*='selectTrigger']":
              {
                backgroundColor: secondaryToolbarColors.popupBackground,
                color: secondaryToolbarColors.textColor,
                borderColor: secondaryToolbarColors.borderColor,
              },
            "& .mdxeditor-toolbar [class*='toolbarModeSwitch'], & .mdxeditor-toolbar [class*='diffSourceToggle']": {
              backgroundColor: "transparent",
              borderColor: secondaryToolbarColors.borderColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarModeSwitch'] [data-state='on'], & .mdxeditor-toolbar [class*='diffSourceToggle'] [data-state='on']":
              {
                backgroundColor: secondaryToolbarColors.pillBackground,
              },
            [`& .${MARKDOWN_MOBILE_TOOLBAR_CLASS}`]: {
              minHeight: 44,
            },
            "& .mdxeditor > :not(.mdxeditor-toolbar)": {
              minHeight: 0,
              boxSizing: "border-box",
              padding: MARKDOWN_CONTENT_PADDING,
            },
            [`& .${MARKDOWN_EDITOR_CONTENT_CLASS}[contenteditable='true']`]: {
              minHeight: 320,
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
            },
            "& .mdxeditor [class*='tableEditor']": {
              display: "inline-table",
              width: "auto",
              maxWidth: "none",
              border: 0,
              borderCollapse: "collapse",
              borderSpacing: 0,
              backgroundColor: viewerBg,
              fontSize: MARKDOWN_TABLE_FONT_SIZE,
              marginInline: 0,
              marginBlockStart: 0,
              marginBlockEnd: 0,
            },
            "& .mdxeditor [class*='tableEditor'] > colgroup > col:first-of-type, & .mdxeditor [class*='tableEditor'] > colgroup > col:last-of-type":
              {
                width: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              },
            "& .mdxeditor [class*='tableEditor'] > tbody > tr > td:not([data-tool-cell='true']), & .mdxeditor [class*='tableEditor'] > tbody > tr > th:not([data-tool-cell='true'])":
              {
                border: (theme) => `1px solid ${getMarkdownTableSurfaceColors(theme).border}`,
                backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).tableBackground,
                paddingBlock: MARKDOWN_TABLE_CELL_PADDING_BLOCK,
                paddingInline: MARKDOWN_TABLE_CELL_PADDING_INLINE,
                textAlign: "left",
                verticalAlign: "top",
              },
            "& .mdxeditor [class*='tableEditor'] > thead > tr, & .mdxeditor [class*='tableEditor'] > tfoot > tr": {
              height: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
            },
            "& .mdxeditor [class*='tableEditor'] > thead > tr > th": {
              backgroundColor: viewerBg,
              color: "inherit",
              border: 0,
              padding: 0,
              height: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              lineHeight: "normal",
              fontSize: "inherit",
              fontWeight: 400,
              letterSpacing: "normal",
              textTransform: "none",
              textAlign: "center",
              verticalAlign: "middle",
            },
            "& .mdxeditor [class*='tableEditor'] > tfoot > tr > th": {
              backgroundColor: viewerBg,
              color: "inherit",
              border: 0,
              padding: 0,
              height: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              lineHeight: "normal",
              textAlign: "center",
              verticalAlign: "middle",
            },
            "& .mdxeditor [class*='tableEditor'] > tbody > tr:first-of-type > td:not([data-tool-cell='true']), & .mdxeditor [class*='tableEditor'] > tbody > tr:first-of-type > th:not([data-tool-cell='true'])":
              {
                backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).headerBackground,
                color: (theme) => getMarkdownTableSurfaceColors(theme).headerText,
                fontSize: MARKDOWN_TABLE_HEADER_FONT_SIZE,
                fontWeight: 700,
                letterSpacing: MARKDOWN_TABLE_HEADER_LETTER_SPACING,
                textTransform: "uppercase",
              },
            "& .mdxeditor [class*='tableEditor'] > tbody > tr:nth-of-type(odd):not(:first-of-type) > td:not([data-tool-cell='true']), & .mdxeditor [class*='tableEditor'] > tbody > tr:nth-of-type(odd):not(:first-of-type) > th:not([data-tool-cell='true'])":
              {
                backgroundColor: (theme) => getMarkdownTableSurfaceColors(theme).alternateRowBackground,
              },
            "& .mdxeditor [class*='tableEditor'] > tbody > tr > :is(th, td)[data-tool-cell='true']": {
              paddingBlock: 0,
              paddingInline: 0,
              border: 0,
              width: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              maxWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              minWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              textAlign: "center",
              verticalAlign: "middle",
              backgroundColor: viewerBg,
            },
            "& .mdxeditor [class*='toolCell']": {
              paddingBlock: 0,
              paddingInline: 0,
              border: 0,
              width: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              maxWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              minWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              backgroundColor: viewerBg,
            },
            "& .mdxeditor [class*='tableEditor'] :is(th, td)[data-tool-cell='true'] > button": {
              margin: "0 auto",
              position: "relative",
              left: "auto",
              top: "auto",
              transform: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              width: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              height: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              minWidth: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              minHeight: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              padding: 0,
              borderRadius: 0,
              border: 0,
              backgroundColor: "transparent",
              boxShadow: "none",
              color: (theme) => (theme.palette.mode === "dark" ? "rgba(235, 232, 226, 0.78)" : "rgba(31, 38, 43, 0.72)"),
              opacity: 0.68,
            },
            "& .mdxeditor [class*='tableEditor']:hover :is(th, td)[data-tool-cell='true'] > button": {
              opacity: 0.86,
            },
            "& .mdxeditor [class*='tableEditor'] :is(th, td)[data-tool-cell='true'] > button:hover": {
              backgroundColor: secondaryToolbarColors.hoverBackground,
              color: secondaryToolbarColors.textColor,
              opacity: 1,
            },
            "& .mdxeditor [class*='tableEditor'] > tbody > tr:first-of-type > th[data-tool-cell='true'][rowspan]": {
              width: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              maxWidth: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              minWidth: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              height: `${MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX}px`,
              textAlign: "center",
              verticalAlign: "middle",
            },
            "& .mdxeditor [class*='tableEditor'] > thead > tr > th:last-of-type[data-tool-cell='true']": {
              width: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              maxWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
              minWidth: `${MARKDOWN_TABLE_TOOL_GUTTER_PX}px`,
            },
            "& .mdxeditor :is([class*='tableEditor'] > thead > tr > th:last-of-type > button[class*='iconButton'], [class*='codeMirrorToolbar'] > button[class*='iconButton'])":
              {
                color: (theme) => (theme.palette.mode === "dark" ? "rgba(255, 186, 176, 0.82)" : "rgba(151, 32, 19, 0.72)"),
              },
            "& .mdxeditor :is([class*='tableEditor'] > thead > tr > th:last-of-type > button[class*='iconButton'], [class*='codeMirrorToolbar'] > button[class*='iconButton']):hover":
              {
                backgroundColor: secondaryToolbarColors.hoverBackground,
                color: secondaryToolbarColors.textColor,
              },
            "& .cm-sourceView, & .cm-mergeView": {
              minHeight: 0,
              height: "100%",
              backgroundColor: (theme) => getMarkdownCodeSurfaceColors(theme).blockBackground,
              border: (theme) => `1px solid ${getMarkdownCodeSurfaceColors(theme).blockBorder}`,
            },
            "& .cm-sourceView .cm-editor, & .cm-mergeView .cm-editor": {
              minHeight: 0,
              height: "100%",
              backgroundColor: (theme) => getMarkdownCodeSurfaceColors(theme).blockBackground,
              color: (theme) => getMarkdownCodeSurfaceColors(theme).textColor,
            },
            "& .cm-sourceView .cm-scroller, & .cm-sourceView .cm-content, & .cm-sourceView .cm-gutters, & .cm-mergeView .cm-scroller, & .cm-mergeView .cm-content, & .cm-mergeView .cm-gutters":
              {
                fontSize: `${MARKDOWN_EDITOR_SOURCE_FONT_SIZE_PX}px`,
                backgroundColor: (theme) => getMarkdownCodeSurfaceColors(theme).blockBackground,
                color: (theme) => getMarkdownCodeSurfaceColors(theme).textColor,
              },
            "& .cm-sourceView .cm-editor.cm-focused > .cm-scroller > .cm-gutters .cm-activeLineGutter, & .cm-mergeView .cm-editor.cm-focused > .cm-scroller > .cm-gutters .cm-activeLineGutter":
              {
                backgroundColor: (theme) => getMarkdownCodeSurfaceColors(theme).activeLineGutterBackground,
                color: (theme) => getMarkdownCodeSurfaceColors(theme).textColor,
                fontWeight: 600,
              },
            "& .cm-sourceView .cm-editor:not(.cm-focused) > .cm-scroller > .cm-gutters .cm-activeLineGutter, & .cm-mergeView .cm-editor:not(.cm-focused) > .cm-scroller > .cm-gutters .cm-activeLineGutter":
              {
                backgroundColor: "transparent",
                color: "inherit",
                fontWeight: "inherit",
              },
            [`& .${MARKDOWN_EDITOR_CONTENT_CLASS}`]: markdownEditorContentStyles,
          }}
        >
          {viewModeTransitionError ? (
            <Box
              role="alert"
              sx={{
                px: 2,
                py: 1,
                color: "error.main",
                borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
              }}
            >
              {viewModeTransitionError}
            </Box>
          ) : null}
          <MDXEditor
            ref={editorRef}
            className={editorRootClassName}
            contentEditableClassName={MARKDOWN_EDITOR_CONTENT_CLASS}
            lexicalTheme={MARKDOWN_EDITOR_LEXICAL_THEME}
            markdown={markdown}
            onChange={handleMdxEditorChange}
            autoFocus={autoFocus ? { defaultSelection: "rootStart", preventScroll: true } : false}
            readOnly={readOnly}
            plugins={plugins}
          />
        </Box>
      </>
    );
  }
);

MarkdownRichEditor.displayName = "MarkdownRichEditor";

export default MarkdownRichEditor;
