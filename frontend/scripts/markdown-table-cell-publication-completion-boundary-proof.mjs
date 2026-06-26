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

async function runProof() {
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');
  const corePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/core/index.js');
  const markdownViewerSource = await readFrontendFile('src/components/Viewer/MarkdownViewer.tsx');
  const editSessionSource = await readFrontendFile('src/components/Viewer/useMarkdownEditSession.ts');

  assertContainsAll(
    tableEditorSource,
    [
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
      'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
    ],
    'nested publication trigger'
  );

  assertContainsAll(
    corePluginSource,
    [
      'return rootEditor.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState }) => {',
      'theNewMarkdownValue = exportMarkdownFromLexical({',
      'r.pub(markdown$, theNewMarkdownValue.trim());',
      'const mutableMarkdownSignal$ = Signal((r) => {',
      'r.link(',
      'markdownSignal$,',
      'mutableMarkdownSignal$',
      'r.singletonSub(mutableMarkdownSignal$, (value) => {',
      'params == null ? void 0 : params.onChange(value, r.getValue(initialMarkdownNormalize$));',
    ],
    'root markdown completion-notification chain'
  );

  assertContainsAll(
    markdownViewerSource,
    ['onChange={handleEditorChange}'],
    'viewer onChange wiring'
  );

  assertContainsAll(
    editSessionSource,
    ['const handleEditorChange = useCallback(', 'setDraftContent(nextMarkdown);'],
    'draft update sink'
  );

  console.log('Proof 2B partial result. Verified publication-completion boundary facts:');
  console.log('- Nested publication redispatches NESTED_EDITOR_UPDATED_COMMAND after updating parent table-cell mdast.');
  console.log('- The root editor update listener re-exports markdown and publishes markdown$ after dirty updates.');
  console.log('- markdown$ flows through mutableMarkdownSignal$ to the public onChange callback when change notifications are not muted.');
  console.log('- MarkdownViewer already wires that onChange callback into handleEditorChange, which updates draftContent.');
  console.log('- Therefore, the next rich-editor onChange after a forced nested publication is a real product-facing completion-notification boundary that a future flushPendingEdits() contract can await.');
  console.log('- However, this still does not prove a coalesced latest-wins promise model by itself; that contract remains to be designed and validated.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
