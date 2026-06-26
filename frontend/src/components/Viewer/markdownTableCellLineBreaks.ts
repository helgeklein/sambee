import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const BREAK_HTML_PATTERN = /^<\/?br\s*\/?>$/i;

type MarkdownAstNode = {
  type: string;
  value?: string;
  children?: MarkdownAstNode[];
  [key: string]: unknown;
};

function createMdastBreakNode(): MarkdownAstNode {
  return { type: "break" };
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, { allowDangerousHtml: true })
  .use(remarkGfm);

function createTextNode(value: string): MarkdownAstNode {
  return { type: "text", value };
}

function createBreakNode(): MarkdownAstNode {
  return { type: "html", value: "<br />" };
}

function isBreakHtmlNode(node: MarkdownAstNode | undefined): boolean {
  return node?.type === "html" && typeof node.value === "string" && BREAK_HTML_PATTERN.test(node.value.trim());
}

function normalizeTextNodeValue(value: string): MarkdownAstNode[] {
  if (!value.includes("\n")) {
    return [createTextNode(value)];
  }

  const parts = value.split("\n");
  const normalizedNodes: MarkdownAstNode[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.length > 0) {
      normalizedNodes.push(createTextNode(part));
    }

    if (index < parts.length - 1) {
      normalizedNodes.push(createBreakNode());
    }
  }

  return normalizedNodes;
}

function normalizePhrasingChildren(children: MarkdownAstNode[]): MarkdownAstNode[] {
  const normalizedChildren: MarkdownAstNode[] = [];

  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      normalizedChildren.push(...normalizeTextNodeValue(child.value));
      continue;
    }

    if (isBreakHtmlNode(child)) {
      normalizedChildren.push(createBreakNode());
      continue;
    }

    if (Array.isArray(child.children)) {
      normalizedChildren.push({
        ...child,
        children: normalizePhrasingChildren(child.children),
      });
      continue;
    }

    normalizedChildren.push(child);
  }

  return normalizedChildren;
}

function stripTrailingBreaks(children: MarkdownAstNode[]): MarkdownAstNode[] {
  const trimmedChildren = [...children];

  while (trimmedChildren.length > 0) {
    const lastChild = trimmedChildren[trimmedChildren.length - 1];

    if (lastChild.type === "text" && typeof lastChild.value === "string" && lastChild.value.length === 0) {
      trimmedChildren.pop();
      continue;
    }

    if (isBreakHtmlNode(lastChild)) {
      trimmedChildren.pop();
      continue;
    }

    if (Array.isArray(lastChild.children)) {
      const strippedNestedChildren = stripTrailingBreaks(lastChild.children);

      if (strippedNestedChildren.length === 0) {
        trimmedChildren.pop();
        continue;
      }

      trimmedChildren[trimmedChildren.length - 1] = {
        ...lastChild,
        children: strippedNestedChildren,
      };
    }

    break;
  }

  return trimmedChildren;
}

function convertCanonicalBreakHtmlToMdastBreaks(children: MarkdownAstNode[]): MarkdownAstNode[] {
  const renderedChildren: MarkdownAstNode[] = [];

  for (const child of children) {
    if (isBreakHtmlNode(child)) {
      renderedChildren.push(createMdastBreakNode());
      continue;
    }

    if (Array.isArray(child.children)) {
      renderedChildren.push({
        ...child,
        children: convertCanonicalBreakHtmlToMdastBreaks(child.children),
      });
      continue;
    }

    renderedChildren.push(child);
  }

  return renderedChildren;
}

export function normalizeMarkdownTableCellLineBreaks(markdown: string): string {
  const tree = markdownParser.parse(markdown) as MarkdownAstNode;

  visit(tree, "tableCell", (node) => {
    const tableCellNode = node as MarkdownAstNode;
    const children = Array.isArray(tableCellNode.children) ? tableCellNode.children : [];
    tableCellNode.children = stripTrailingBreaks(normalizePhrasingChildren(children));
  });

  return markdownProcessor.stringify(tree);
}

export function remarkRenderMarkdownTableCellLineBreaks() {
  return (tree: MarkdownAstNode) => {
    visit(tree, "tableCell", (node) => {
      const tableCellNode = node as MarkdownAstNode;
      const children = Array.isArray(tableCellNode.children) ? tableCellNode.children : [];
      tableCellNode.children = convertCanonicalBreakHtmlToMdastBreaks(children);
    });
  };
}
