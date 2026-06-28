import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

async function readFrontendFile(relativePath) {
  return fs.readFile(path.join(frontendRoot, relativePath), 'utf8');
}

function proveLinebreakVisitorEmitsRawNewlineText() {
  throw new Error('proveLinebreakVisitorEmitsRawNewlineText requires the imported visitor');
}

function proveLinebreakVisitorWithImportedModule(LexicalLinebreakVisitor) {
  const appendedNodes = [];

  LexicalLinebreakVisitor.visitLexicalNode({
    mdastParent: { type: 'tableCell', children: [] },
    actions: {
      appendToParent(parent, node) {
        appendedNodes.push({ parent, node });
      },
    },
  });

  assert.equal(appendedNodes.length, 1, 'linebreak visitor should append exactly one node');
  assert.deepEqual(
    appendedNodes[0].node,
    { type: 'text', value: '\n' },
    'linebreak visitor should currently emit a raw newline text node at export time'
  );
}

function proveSourceContainsBoundary(source, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${label} is missing expected snippet: ${snippet}`);
  }
}

async function runProof() {
  const lexicalLinebreakVisitorModuleUrl = pathToFileURL(
    path.join(frontendRoot, 'node_modules/@mdxeditor/editor/dist/plugins/core/LexicalLinebreakVisitor.js')
  ).href;
  const { LexicalLinebreakVisitor } = await import(lexicalLinebreakVisitorModuleUrl);
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');
  const exportMarkdownSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/exportMarkdownFromLexical.js');
  const tablePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/index.js');

  proveLinebreakVisitorWithImportedModule(LexicalLinebreakVisitor);

  proveSourceContainsBoundary(
    tableEditorSource,
    [
      'const mdast = exportLexicalTreeToMdast({',
      'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'table nested publication boundary'
  );

  proveSourceContainsBoundary(
    exportMarkdownSource,
    [
      'return toMarkdown(exportLexicalTreeToMdast({ root, visitors, jsxComponentDescriptors, jsxIsAvailable }), {',
      'extensions: toMarkdownExtensions,',
    ],
    'final markdown export boundary'
  );

  proveSourceContainsBoundary(
    tablePluginSource,
    ['[addToMarkdownExtension$]: gfmTableToMarkdown({'],
    'table markdown stringification configuration'
  );

  console.log('Proof 1A passed. Verified export-boundary facts:');
  console.log('- The installed linebreak export visitor emits mdast text nodes with raw newline values.');
  console.log('- Nested table-cell publication happens at an mdast boundary before final markdown stringification.');
  console.log('- Final markdown is produced later by toMarkdown() with the GFM table extension.');
  console.log('- Therefore, a pre-stringify canonicalization hook is feasible in principle.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
