import type { Break, Html, Parent, PhrasingContent, Root, TableCell, Text } from "mdast";
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
