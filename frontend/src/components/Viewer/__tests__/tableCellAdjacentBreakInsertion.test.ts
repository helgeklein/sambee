import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdjacentImportedBreakInsertionTarget, insertTextAtAdjacentImportedBreak } from "../tableCellAdjacentBreakInsertion";

const { mockCreateTextNode } = vi.hoisted(() => ({
  mockCreateTextNode: vi.fn(),
}));

vi.mock("lexical", () => ({
  $createTextNode: mockCreateTextNode,
}));

type MockLexicalNode = {
  getNextSibling: () => MockLexicalNode | null;
  getPreviousSibling: () => MockLexicalNode | null;
  getType: () => string;
  insertBefore: ReturnType<typeof vi.fn>;
};

function createNode(type: string, options: { previousSibling?: MockLexicalNode | null; nextSibling?: MockLexicalNode | null } = {}) {
  const node: MockLexicalNode = {
    getNextSibling: () => options.nextSibling ?? null,
    getPreviousSibling: () => options.previousSibling ?? null,
    getType: () => type,
    insertBefore: vi.fn(),
  };

  return node;
}

function createCollapsedSelection(node: MockLexicalNode, pointType: "element" | "text" = "element") {
  return {
    anchor: {
      getNode: () => node,
      type: pointType,
    },
    focus: {
      getNode: () => node,
      type: pointType,
    },
    isCollapsed: () => true,
  };
}

describe("tableCellAdjacentBreakInsertion", () => {
  beforeEach(() => {
    mockCreateTextNode.mockReset();
  });

  it("targets the second imported break in a loaded empty internal line", () => {
    const nextTextNode = createNode("text");
    const firstBreakNode = createNode("generic-html");
    const secondBreakNode = createNode("generic-html", {
      nextSibling: nextTextNode,
      previousSibling: firstBreakNode,
    });

    const selection = createCollapsedSelection(secondBreakNode);

    expect(getAdjacentImportedBreakInsertionTarget(selection as never)).toBe(secondBreakNode);
  });

  it("does not target a trailing break with no following text node", () => {
    const firstBreakNode = createNode("generic-html");
    const trailingBreakNode = createNode("generic-html", {
      nextSibling: null,
      previousSibling: firstBreakNode,
    });

    const selection = createCollapsedSelection(trailingBreakNode);

    expect(getAdjacentImportedBreakInsertionTarget(selection as never)).toBeNull();
  });

  it("inserts text before the second imported break and selects the new text", () => {
    const selectEnd = vi.fn();
    const createdTextNode = { selectEnd };
    mockCreateTextNode.mockReturnValue(createdTextNode);

    const nextTextNode = createNode("text");
    const firstBreakNode = createNode("generic-html");
    const secondBreakNode = createNode("generic-html", {
      nextSibling: nextTextNode,
      previousSibling: firstBreakNode,
    });

    const selection = createCollapsedSelection(secondBreakNode);

    expect(insertTextAtAdjacentImportedBreak(selection as never, "s")).toBe(true);
    expect(mockCreateTextNode).toHaveBeenCalledWith("s");
    expect(secondBreakNode.insertBefore).toHaveBeenCalledWith(createdTextNode);
    expect(selectEnd).toHaveBeenCalledTimes(1);
  });
});