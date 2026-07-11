import type { Break, Html, Parent, PhrasingContent, Root, Table, TableCell, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const BREAK_HTML_PATTERN = /^<\/?br\s*\/?>$/i;

function createMdastBreakNode(): Break {
  return { type: "break" };
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify).use(remarkGfm);

function createTextNode(value: string): Text {
  return { type: "text", value };
}

function createBreakNode(): Html {
  return { type: "html", value: "<br />" };
}

interface MarkdownReplacement {
  startOffset: number;
  endOffset: number;
  replacement: string;
}

interface MarkdownTableSnapshot {
  semanticSignature: string;
  source: string;
  startOffset: number;
  endOffset: number;
}

function isBreakHtmlNode(node: PhrasingContent | undefined): node is Html {
  return node?.type === "html" && typeof node.value === "string" && BREAK_HTML_PATTERN.test(node.value.trim());
}

function hasPhrasingChildren(node: PhrasingContent): node is Parent & PhrasingContent & { children: PhrasingContent[] } {
  return "children" in node && Array.isArray(node.children);
}

function normalizeTextNodeValue(value: string): PhrasingContent[] {
  if (!value.includes("\n")) {
    return [createTextNode(value)];
  }

  const parts = value.split("\n");
  const normalizedNodes: PhrasingContent[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";

    if (part.length > 0) {
      normalizedNodes.push(createTextNode(part));
    }

    if (index < parts.length - 1) {
      normalizedNodes.push(createBreakNode());
    }
  }

  return normalizedNodes;
}

function normalizePhrasingChildren(children: PhrasingContent[]): PhrasingContent[] {
  const normalizedChildren: PhrasingContent[] = [];

  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      normalizedChildren.push(...normalizeTextNodeValue(child.value));
      continue;
    }

    if (isBreakHtmlNode(child)) {
      normalizedChildren.push(createBreakNode());
      continue;
    }

    if (hasPhrasingChildren(child)) {
      normalizedChildren.push({
        ...child,
        children: normalizePhrasingChildren(child.children),
      } as PhrasingContent);
      continue;
    }

    normalizedChildren.push(child);
  }

  return normalizedChildren;
}

function stripTrailingBreaks(children: PhrasingContent[]): PhrasingContent[] {
  const trimmedChildren = [...children];

  // Trailing in-cell breaks are intentionally unsupported. We normalize them
  // away here so save, reload, and source mode all share the same contract.
  while (trimmedChildren.length > 0) {
    const lastChild = trimmedChildren[trimmedChildren.length - 1];

    if (!lastChild) {
      break;
    }

    if (lastChild.type === "text" && typeof lastChild.value === "string" && lastChild.value.length === 0) {
      trimmedChildren.pop();
      continue;
    }

    if (isBreakHtmlNode(lastChild)) {
      trimmedChildren.pop();
      continue;
    }

    if (hasPhrasingChildren(lastChild)) {
      const strippedNestedChildren = stripTrailingBreaks(lastChild.children);

      if (strippedNestedChildren.length === 0) {
        trimmedChildren.pop();
        continue;
      }

      trimmedChildren[trimmedChildren.length - 1] = {
        ...lastChild,
        children: strippedNestedChildren,
      } as PhrasingContent;
    }

    break;
  }

  return trimmedChildren;
}

function convertCanonicalBreakHtmlToMdastBreaks(children: PhrasingContent[]): PhrasingContent[] {
  const renderedChildren: PhrasingContent[] = [];

  for (const child of children) {
    if (isBreakHtmlNode(child)) {
      renderedChildren.push(createMdastBreakNode());
      continue;
    }

    if (hasPhrasingChildren(child)) {
      renderedChildren.push({
        ...child,
        children: convertCanonicalBreakHtmlToMdastBreaks(child.children),
      } as PhrasingContent);
      continue;
    }

    renderedChildren.push(child);
  }

  return renderedChildren;
}

function collectCanonicalBreakHtmlReplacements(children: PhrasingContent[], replacements: MarkdownReplacement[]): void {
  for (const child of children) {
    if (isBreakHtmlNode(child)) {
      const startOffset = child.position?.start.offset;
      const endOffset = child.position?.end.offset;

      if (typeof startOffset === "number" && typeof endOffset === "number") {
        replacements.push({ startOffset, endOffset, replacement: "<br>" });
      }

      continue;
    }

    if (hasPhrasingChildren(child)) {
      collectCanonicalBreakHtmlReplacements(child.children, replacements);
    }
  }
}

function applyMarkdownReplacements(markdown: string, replacements: MarkdownReplacement[]): string {
  if (replacements.length === 0) {
    return markdown;
  }

  let nextMarkdown = markdown;

  for (const { startOffset, endOffset, replacement } of [...replacements].sort((left, right) => right.startOffset - left.startOffset)) {
    nextMarkdown = `${nextMarkdown.slice(0, startOffset)}${replacement}${nextMarkdown.slice(endOffset)}`;
  }

  return nextMarkdown;
}

function getPhrasingSemanticSignature(children: PhrasingContent[]): string {
  return JSON.stringify(
    children.map((child) => {
      if (child.type === "text") {
        return { type: "text", value: child.value };
      }

      if (isBreakHtmlNode(child)) {
        return { type: "break" };
      }

      if (hasPhrasingChildren(child)) {
        return {
          type: child.type,
          children: getPhrasingSemanticSignature(child.children),
        };
      }

      return child;
    })
  );
}

function collectMarkdownTableSnapshots(markdown: string): MarkdownTableSnapshot[] {
  const tree = markdownParser.parse(markdown) as Root;
  const tables: MarkdownTableSnapshot[] = [];

  visit(tree, "table", (node) => {
    const tableNode = node as Table;
    const startOffset = tableNode.position?.start.offset;
    const endOffset = tableNode.position?.end.offset;

    if (typeof startOffset !== "number" || typeof endOffset !== "number") {
      return;
    }

    tables.push({
      semanticSignature: JSON.stringify({
        align: tableNode.align,
        rows: tableNode.children.map((row) => row.children.map((cell) => getPhrasingSemanticSignature((cell as TableCell).children))),
      }),
      source: markdown.slice(startOffset, endOffset),
      startOffset,
      endOffset,
    });
  });

  return tables;
}

export function normalizeMarkdownTableCellLineBreaks(markdown: string): string {
  const tree = markdownParser.parse(markdown) as Root;

  // Canonicalization has to happen while the content is still a table-cell AST.
  // Once a literal newline is flattened into raw pipe-table text, markdown
  // parsing treats it as row structure and the original in-cell meaning is not
  // recoverable. Persisted table-cell breaks therefore normalize to <br /> here.
  visit(tree, "tableCell", (node) => {
    const tableCellNode = node as TableCell;
    const children = tableCellNode.children;
    tableCellNode.children = stripTrailingBreaks(normalizePhrasingChildren(children));
  });

  return markdownProcessor.stringify(tree);
}

export function prepareMarkdownTableCellLineBreaksForEditor(markdown: string): string {
  if (!markdown.includes("<br")) {
    return markdown;
  }

  const tree = markdownParser.parse(markdown) as Root;
  const replacements: MarkdownReplacement[] = [];

  visit(tree, "tableCell", (node) => {
    const tableCellNode = node as TableCell;
    collectCanonicalBreakHtmlReplacements(tableCellNode.children, replacements);
  });

  return applyMarkdownReplacements(markdown, replacements);
}

export function preserveUnchangedMarkdownTableSource(previousMarkdown: string, nextMarkdown: string): string {
  if (previousMarkdown === nextMarkdown) {
    return nextMarkdown;
  }

  const previousTables = collectMarkdownTableSnapshots(previousMarkdown);
  const nextTables = collectMarkdownTableSnapshots(nextMarkdown);

  if (previousTables.length === 0 || previousTables.length !== nextTables.length) {
    return nextMarkdown;
  }

  const replacements: MarkdownReplacement[] = [];

  for (let index = 0; index < nextTables.length; index += 1) {
    const previousTable = previousTables[index];
    const nextTable = nextTables[index];

    if (!previousTable || !nextTable || previousTable.semanticSignature !== nextTable.semanticSignature) {
      continue;
    }

    replacements.push({
      startOffset: nextTable.startOffset,
      endOffset: nextTable.endOffset,
      replacement: previousTable.source,
    });
  }

  return applyMarkdownReplacements(nextMarkdown, replacements);
}

export function remarkRenderMarkdownTableCellLineBreaks() {
  return (tree: Root) => {
    // Viewer rendering is scoped structurally to table cells so literal <br />
    // text outside tables stays literal markdown content.
    visit(tree, "tableCell", (node) => {
      const tableCellNode = node as TableCell;
      const children = tableCellNode.children;
      tableCellNode.children = convertCanonicalBreakHtmlToMdastBreaks(children);
    });
  };
}
