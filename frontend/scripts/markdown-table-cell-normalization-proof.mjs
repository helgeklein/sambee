import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';

const BREAK_HTML_PATTERN = /^<br\s*\/?>$/i;

const parser = unified().use(remarkParse).use(remarkGfm);
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, { allowDangerousHtml: true })
  .use(remarkGfm);

function createTextNode(value) {
  return { type: 'text', value };
}

function createBreakNode() {
  return { type: 'html', value: '<br />' };
}

function isBreakHtmlNode(node) {
  return node?.type === 'html' && BREAK_HTML_PATTERN.test(node.value.trim());
}

function normalizeTextNodeValue(value) {
  if (!value.includes('\n')) {
    return [createTextNode(value)];
  }

  const parts = value.split('\n');
  const normalizedNodes = [];

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

function normalizePhrasingChildren(children) {
  const normalizedChildren = [];

  for (const child of children) {
    if (child.type === 'text') {
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

function stripTrailingBreaks(children) {
  const trimmedChildren = [...children];

  while (trimmedChildren.length > 0) {
    const lastChild = trimmedChildren[trimmedChildren.length - 1];

    if (lastChild.type === 'text' && lastChild.value.length === 0) {
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

function normalizeMarkdownTableCellLineBreaks(markdown) {
  const tree = parser.parse(markdown);

  visit(tree, 'tableCell', (node) => {
    node.children = stripTrailingBreaks(normalizePhrasingChildren(node.children));
  });

  return processor.stringify(tree);
}

function renderCanonicalMarkdown(markdown) {
  return processor.stringify(processor.parse(markdown));
}

const proofCases = [
  {
    name: 'canonicalizes br tag spellings in table cells',
    input: '| A |\n| - |\n| foo<br>bar<br/>baz<br />qux |',
    expected: '| A |\n| - |\n| foo<br />bar<br />baz<br />qux |',
  },
  {
    name: 'canonicalizes numeric newline references in table cells',
    input: '| A |\n| - |\n| foo&#10;bar&#xA;baz&#x0a;qux&#x000A;done |',
    expected: '| A |\n| - |\n| foo<br />bar<br />baz<br />qux<br />done |',
  },
  {
    name: 'canonicalizes literal serialized newlines in table cells',
    input: '| A |\n| - |\n| foo\nbar\nbaz |',
    expected: '| A |\n| - |\n| foo<br />bar<br />baz |',
  },
  {
    name: 'preserves escaped pipes, inline code, emphasis, and links',
    input: '| A |\n| - |\n| escaped \\| pipe and `x\\|y` and *z* and [go](https://example.com) |',
    expected: '| A |\n| - |\n| escaped \\| pipe and `x\\|y` and *z* and [go](https://example.com) |',
  },
  {
    name: 'leaves literal br text outside tables untouched',
    input: 'Outside <br /> stays literal.\n\n| A |\n| - |\n| foo&#10;bar |',
    expected: 'Outside <br /> stays literal.\n\n| A |\n| - |\n| foo<br />bar |',
  },
  {
    name: 'preserves multiple consecutive internal line breaks',
    input: '| A |\n| - |\n| foo\n\nbar |',
    expected: '| A |\n| - |\n| foo<br /><br />bar |',
  },
  {
    name: 'strips trailing line breaks in table cells',
    input: '| A |\n| - |\n| foo&#10;&#xA;<br /> |',
    expected: '| A |\n| - |\n| foo |',
  },
];

function runProof() {
  const passedCases = [];
  const failedCases = [];

  for (const proofCase of proofCases) {
    try {
      const normalized = normalizeMarkdownTableCellLineBreaks(proofCase.input);
      const expected = renderCanonicalMarkdown(proofCase.expected);
      const renormalized = normalizeMarkdownTableCellLineBreaks(normalized);

      assert.equal(normalized, expected, `${proofCase.name}: normalized output mismatch`);
      assert.equal(renormalized, normalized, `${proofCase.name}: normalization is not idempotent`);
      passedCases.push(proofCase.name);
    } catch (error) {
      failedCases.push({
        name: proofCase.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('Proof 1 results:');

  if (passedCases.length > 0) {
    console.log('Passed cases:');
    for (const result of passedCases) {
      console.log(`- ${result}`);
    }
  }

  if (failedCases.length > 0) {
    console.log('Failed cases:');
    for (const failure of failedCases) {
      console.log(`- ${failure.name}`);
      console.log(`  ${failure.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('All cases passed.');
}

runProof();
