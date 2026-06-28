import { $createTextNode, type LexicalNode, type RangeSelection } from "lexical";

export function getAdjacentImportedBreakInsertionTarget(selection: RangeSelection): LexicalNode | null {
  // Loaded canonical <br /> table-cell content currently imports as adjacent
  // generic-html nodes, not native LineBreakNodes. The broken empty-middle-line
  // case is the collapsed selection that lands on the second imported break
  // with a real text node following it.
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

export function insertTextAtAdjacentImportedBreak(selection: RangeSelection, payload: string): boolean {
  const targetNode = getAdjacentImportedBreakInsertionTarget(selection);

  if (targetNode === null) {
    return false;
  }

  // This bridge stays intentionally narrow: it repairs the loaded internal
  // empty-line shape without widening support to trailing-break selections.
  const textNode = $createTextNode(payload);
  targetNode.insertBefore(textNode);
  textNode.selectEnd();
  return true;
}
