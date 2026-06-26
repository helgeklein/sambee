import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function assertContainsNone(source, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(!source.includes(snippet), `${label} unexpectedly contains snippet: ${snippet}`);
  }
}

async function runProof() {
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');
  const corePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/core/index.js');
  const markdownRichEditorSource = await readFrontendFile('src/components/Viewer/MarkdownRichEditor.tsx');
  const markdownViewerSource = await readFrontendFile('src/components/Viewer/MarkdownViewer.tsx');

  assertContainsAll(
    tableEditorSource,
    [
      'editor.registerCommand(',
      'NESTED_EDITOR_UPDATED_COMMAND,',
      'saveAndFocus(null);',
      'const mdast = exportLexicalTreeToMdast({',
      'parentEditor.update(',
      'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'nested table-cell publication path'
  );

  assertContainsAll(
    corePluginSource,
    [
      'editor == null ? void 0 : editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
      'theNewMarkdownValue = exportMarkdownFromLexical({',
      'r.pub(markdown$, theNewMarkdownValue.trim());',
    ],
    'root editor publication and markdown export path'
  );

  assertContainsAll(
    markdownViewerSource,
    ['const savedContent = draftContent;'],
    'current save path still using outer draft state'
  );

  assertContainsAll(
    markdownRichEditorSource,
    [
      'export interface MarkdownRichEditorHandle {',
      'focus: () => void;',
      'preserveSelection: () => void;',
      'restorePreservedSelection: () => boolean;',
    ],
    'current imperative handle surface'
  );

  assertContainsNone(
    markdownRichEditorSource,
    ['flushPendingEdits', 'getCanonicalMarkdown', 'pendingPublication', 'publicationPromise'],
    'current imperative handle and publication state'
  );

  console.log('Proof 2A partial result. Verified focused-publication facts:');
  console.log('- The installed nested table-cell path can publish outward on NESTED_EDITOR_UPDATED_COMMAND without requiring blur.');
  console.log('- That publication path updates parent table-cell mdast before redispatching NESTED_EDITOR_UPDATED_COMMAND upward.');
  console.log('- The root editor path already re-exports markdown after nested publication reaches it.');
  console.log('- However, the current app wrapper still exposes no flushPendingEdits(), no canonical-export method, and no deterministic publication-complete promise.');
  console.log('- Therefore, Proof 2 is not complete yet: the blur-independent publication primitive is proven, but the coalesced awaitable completion contract remains unproven and still needs design/implementation work.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
