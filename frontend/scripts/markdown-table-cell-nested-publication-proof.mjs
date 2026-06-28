import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { $getRoot, createEditor } from 'lexical';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmTableToMarkdown } from 'mdast-util-gfm-table';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

async function readFrontendFile(relativePath) {
  return fs.readFile(path.join(frontendRoot, relativePath), 'utf8');
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

function stringifyTable(table) {
  return toMarkdown(
    { type: 'root', children: [table] },
    {
      extensions: [gfmTableToMarkdown()],
      allowDangerousHtml: true,
    }
  );
}

function proveSourceContainsNestedPublicationSeam(source) {
  for (const snippet of [
    'const mdast = exportLexicalTreeToMdast({',
    'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
    'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
  ]) {
    assert.ok(source.includes(snippet), `table nested publication seam is missing expected snippet: ${snippet}`);
  }
}

function publishCellChildrenThroughRealTableNode(TableNode, children) {
  const editor = createEditor({
    namespace: 'NestedPublicationProof',
    nodes: [TableNode],
  });
  let publishedTable = null;

  editor.update(() => {
    const tableNode = new TableNode(createTableMdast());
    $getRoot().append(tableNode);
    tableNode.updateCellContents(0, 1, children);
    publishedTable = structuredClone(tableNode.getMdastNode());
  });

  assert.ok(publishedTable, 'expected nested publication proof to capture the updated table mdast');
  return publishedTable;
}

async function runProof() {
  const tableNodeModuleUrl = pathToFileURL(
    path.join(frontendRoot, 'node_modules/@mdxeditor/editor/dist/plugins/table/TableNode.js')
  ).href;
  const { TableNode } = await import(tableNodeModuleUrl);
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');

  proveSourceContainsNestedPublicationSeam(tableEditorSource);

  const rawNewlineChildren = [{ type: 'text', value: 'foo\nbar' }];
  const canonicalBreakChildren = [
    { type: 'text', value: 'foo' },
    { type: 'html', value: '<br />' },
    { type: 'text', value: 'bar' },
  ];

  const tableWithRawNewlineText = publishCellChildrenThroughRealTableNode(TableNode, rawNewlineChildren);
  const tableWithCanonicalBreaks = publishCellChildrenThroughRealTableNode(TableNode, canonicalBreakChildren);

  assert.deepEqual(
    tableWithCanonicalBreaks.children[1].children[0].children,
    canonicalBreakChildren,
    'updateCellContents should preserve canonicalized phrasing children without filtering or flattening them'
  );

  const rawNewlineMarkdown = stringifyTable(tableWithRawNewlineText);
  const canonicalBreakMarkdown = stringifyTable(tableWithCanonicalBreaks);

  assert.ok(
    rawNewlineMarkdown.includes('foo&#xA;bar'),
    'the unmodified nested-publication contract still emits numeric newline references for raw newline text'
  );

  assert.ok(
    canonicalBreakMarkdown.includes('foo<br />bar'),
    'canonicalized nested-publication children should stringify to canonical <br /> output'
  );

  assert.ok(
    !canonicalBreakMarkdown.includes('&#xA;'),
    'canonicalized nested-publication children should not stringify back to numeric newline references'
  );

  console.log('Proof 2A passed. Verified nested-publication integration facts:');
  console.log('- The real nested table-cell publication seam still exports mdast, updates cell children, and then dispatches NESTED_EDITOR_UPDATED_COMMAND.');
  console.log('- TableNode.updateCellContents stores published phrasing children verbatim, including html break nodes.');
  console.log('- At that real updateCellContents boundary, canonicalized <br /> children stringify to canonical table markdown output.');
  console.log('- Therefore, the nested-publication path can use pre-stringify canonicalization without changing the surrounding publication contract.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
