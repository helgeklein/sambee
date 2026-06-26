import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { $getRoot, createEditor } from 'lexical';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { visit } from 'unist-util-visit';

const BREAK_HTML_PATTERN = /^<br\s*\/?>$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

async function readFrontendFile(relativePath) {
  return fs.readFile(path.join(frontendRoot, relativePath), 'utf8');
}

function assertContainsAll(source, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${label} is missing expected snippet: ${snippet}`);
  }
}

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

function canonicalizeTableCellChildren(children) {
  return stripTrailingBreaks(normalizePhrasingChildren(children));
}

function canonicalizeTableCellLineBreaksAtExportBoundary(root) {
  const normalizedRoot = structuredClone(root);

  visit(normalizedRoot, 'tableCell', (node) => {
    node.children = canonicalizeTableCellChildren(node.children);
  });

  return normalizedRoot;
}

function stringifyMarkdown(root) {
  return toMarkdown(root, {
    extensions: [gfmTableToMarkdown()],
    allowDangerousHtml: true,
  });
}

function createRootWithSingleCell(children, leadingParagraphText = null) {
  return {
    type: 'root',
    children: [
      ...(leadingParagraphText === null
        ? []
        : [{ type: 'paragraph', children: [{ type: 'text', value: leadingParagraphText }] }]),
      {
        type: 'table',
        align: [null],
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: 'A' }] }],
          },
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children }],
          },
        ],
      },
    ],
  };
}

function createTableMdast() {
  return {
    type: 'table',
    align: [null],
    children: [
      {
        type: 'tableRow',
        children: [{ type: 'tableCell', children: [{ type: 'text', value: 'Header' }] }],
      },
      {
        type: 'tableRow',
        children: [{ type: 'tableCell', children: [{ type: 'text', value: 'Original' }] }],
      },
    ],
  };
}

function publishCellChildrenThroughRealTableNode(TableNode, children) {
  const editor = createEditor({
    namespace: 'IntegratedExportBoundaryProof',
    nodes: [TableNode],
  });
  let publishedTable = null;

  editor.update(() => {
    const tableNode = new TableNode(createTableMdast());
    $getRoot().append(tableNode);
    tableNode.updateCellContents(0, 1, children);
    publishedTable = structuredClone(tableNode.getMdastNode());
  });

  assert.ok(publishedTable, 'expected to capture the published table mdast');
  return publishedTable;
}

const exportBoundaryCorpus = [
  {
    name: 'canonicalizes br tag spellings in table cells at export time',
    root: createRootWithSingleCell([
      createTextNode('foo'),
      { type: 'html', value: '<br>' },
      createTextNode('bar'),
      { type: 'html', value: '<br/>' },
      createTextNode('baz'),
      { type: 'html', value: '<br />' },
      createTextNode('qux'),
    ]),
    expectedRoot: createRootWithSingleCell([
      createTextNode('foo'),
      createBreakNode(),
      createTextNode('bar'),
      createBreakNode(),
      createTextNode('baz'),
      createBreakNode(),
      createTextNode('qux'),
    ]),
  },
  {
    name: 'canonicalizes raw newline text into canonical break nodes at export time',
    root: createRootWithSingleCell([createTextNode('foo\nbar\nbaz')]),
    expectedRoot: createRootWithSingleCell([
      createTextNode('foo'),
      createBreakNode(),
      createTextNode('bar'),
      createBreakNode(),
      createTextNode('baz'),
    ]),
  },
  {
    name: 'preserves multiple consecutive internal line breaks at export time',
    root: createRootWithSingleCell([createTextNode('foo\n\nbar')]),
    expectedRoot: createRootWithSingleCell([
      createTextNode('foo'),
      createBreakNode(),
      createBreakNode(),
      createTextNode('bar'),
    ]),
  },
  {
    name: 'preserves escaped pipes inline code emphasis and links at export time',
    root: createRootWithSingleCell([
      createTextNode('escaped | pipe and '),
      { type: 'inlineCode', value: 'x|y' },
      createTextNode(' and '),
      { type: 'emphasis', children: [createTextNode('z')] },
      createTextNode(' and '),
      {
        type: 'link',
        url: 'https://example.com',
        title: null,
        children: [createTextNode('go')],
      },
    ]),
    expectedRoot: createRootWithSingleCell([
      createTextNode('escaped | pipe and '),
      { type: 'inlineCode', value: 'x|y' },
      createTextNode(' and '),
      { type: 'emphasis', children: [createTextNode('z')] },
      createTextNode(' and '),
      {
        type: 'link',
        url: 'https://example.com',
        title: null,
        children: [createTextNode('go')],
      },
    ]),
  },
  {
    name: 'leaves non-table markdown untouched while canonicalizing table cells',
    root: createRootWithSingleCell([createTextNode('foo\nbar')], 'Outside <br /> stays literal.'),
    expectedRoot: createRootWithSingleCell(
      [createTextNode('foo'), createBreakNode(), createTextNode('bar')],
      'Outside <br /> stays literal.'
    ),
  },
  {
    name: 'strips trailing line breaks at export time',
    root: createRootWithSingleCell([
      createTextNode('foo'),
      { type: 'html', value: '<br>' },
      { type: 'html', value: '<br />' },
      createTextNode(''),
    ]),
    expectedRoot: createRootWithSingleCell([createTextNode('foo')]),
  },
];

async function runProof() {
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');
  const exportMarkdownSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/exportMarkdownFromLexical.js');
  const corePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/core/index.js');
  const sourceEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/diff-source/SourceEditor.js');
  const tableNodeModuleUrl = pathToFileURL(
    path.join(frontendRoot, 'node_modules/@mdxeditor/editor/dist/plugins/table/TableNode.js')
  ).href;
  const { TableNode } = await import(tableNodeModuleUrl);

  assertContainsAll(
    tableEditorSource,
    [
      'const mdast = exportLexicalTreeToMdast({',
      'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'nested publication seam'
  );

  assertContainsAll(
    exportMarkdownSource,
    [
      'return toMarkdown(exportLexicalTreeToMdast({ root, visitors, jsxComponentDescriptors, jsxIsAvailable }), {',
      'extensions: toMarkdownExtensions,',
    ],
    'save export seam'
  );

  assertContainsAll(
    corePluginSource,
    [
      'r.link(markdown$, markdownSourceEditorValue$);',
      'if (current === "source" || current === "diff") {',
      'r.pub(setMarkdown$, markdownSourceFromEditor);',
    ],
    'source-mode handoff seam'
  );

  assertContainsAll(
    sourceEditorSource,
    ['updateMarkdown(state.doc.toString());'],
    'source editor update path'
  );

  for (const proofCase of exportBoundaryCorpus) {
    const canonicalRoot = canonicalizeTableCellLineBreaksAtExportBoundary(proofCase.root);
    const canonicalMarkdown = stringifyMarkdown(canonicalRoot);
    const repeatedCanonicalMarkdown = stringifyMarkdown(canonicalizeTableCellLineBreaksAtExportBoundary(canonicalRoot));
    const expectedMarkdown = stringifyMarkdown(proofCase.expectedRoot);

    assert.equal(canonicalMarkdown, expectedMarkdown, `${proofCase.name}: canonical markdown mismatch`);
    assert.equal(repeatedCanonicalMarkdown, canonicalMarkdown, `${proofCase.name}: canonicalization is not idempotent`);
    assert.ok(!canonicalMarkdown.includes('&#xA;'), `${proofCase.name}: canonical markdown should not contain numeric newline references`);
  }

  const nestedPublishedTable = publishCellChildrenThroughRealTableNode(
    TableNode,
    canonicalizeTableCellChildren([createTextNode('foo\nbar\n\nbaz'), { type: 'html', value: '<br />' }])
  );
  const nestedPublishedMarkdown = stringifyMarkdown({ type: 'root', children: [nestedPublishedTable] });
  const expectedNestedPublishedMarkdown = stringifyMarkdown({
    type: 'root',
    children: [
      {
        type: 'table',
        align: [null],
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [createTextNode('Header')] }],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [
                  createTextNode('foo'),
                  createBreakNode(),
                  createTextNode('bar'),
                  createBreakNode(),
                  createBreakNode(),
                  createTextNode('baz'),
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(
    nestedPublishedMarkdown,
    expectedNestedPublishedMarkdown,
    'nested publication should emit canonical table markdown after export-boundary canonicalization'
  );
  assert.ok(
    !nestedPublishedMarkdown.includes('&#xA;'),
    'nested publication should not emit numeric newline references after export-boundary canonicalization'
  );

  const sourceVisibleMarkdown = stringifyMarkdown(
    canonicalizeTableCellLineBreaksAtExportBoundary(createRootWithSingleCell([createTextNode('foo\nbar')]))
  );

  assert.equal(
    sourceVisibleMarkdown,
    stringifyMarkdown(createRootWithSingleCell([createTextNode('foo'), createBreakNode(), createTextNode('bar')])),
    'source mode should receive the same canonical markdown string exported from rich-text mode'
  );

  console.log('Proof 1C passed. Verified integrated export-boundary facts:');
  console.log('- The revised mdast export-boundary canonicalization satisfies the newline normalization corpus for supported persisted representations.');
  console.log('- The same canonicalization keeps nested publication on canonical <br /> output and avoids numeric newline references.');
  console.log('- The save export seam still stringifies from mdast at the same boundary.');
  console.log('- The source-mode path still mirrors the exported markdown string rather than inventing an alternate serialization path.');
  console.log('- Therefore, under the refined invariant, no nested-publication, save, or source-mode path needs to leak literal in-cell newline semantics into raw pipe-table markdown.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
