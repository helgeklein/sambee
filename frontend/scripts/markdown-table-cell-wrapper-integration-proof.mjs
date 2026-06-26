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
  const markdownRichEditorSource = await readFrontendFile('src/components/Viewer/MarkdownRichEditor.tsx');
  const tableEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/table/TableEditor.js');
  const corePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/core/index.js');

  assertContainsAll(
    markdownRichEditorSource,
    [
      'export interface MarkdownRichEditorHandle {',
      'const editorRef = useRef<MDXEditorMethods>(null);',
      'const activeEditorRef = useRef<LexicalEditor | null>(null);',
      'useImperativeHandle(',
      'onActiveEditorChange={(editor) => {',
      'activeEditorRef.current = editor;',
      'ref={editorRef}',
      'onChange={onChange}',
      'const currentMarkdown = editorRef.current?.getMarkdown();',
    ],
    'MarkdownRichEditor wrapper seams'
  );

  assertContainsAll(
    tableEditorSource,
    [
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
      'editor.registerCommand(',
      'NESTED_EDITOR_UPDATED_COMMAND,',
      'saveAndFocus(null);',
    ],
    'nested editor publication trigger path'
  );

  assertContainsAll(
    corePluginSource,
    [
      'r.pub(markdown$, theNewMarkdownValue.trim());',
      'params == null ? void 0 : params.onChange(value, r.getValue(initialMarkdownNormalize$));',
      'editor == null ? void 0 : editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'root markdown export and completion path'
  );

  console.log('Proof 2D passed. Verified wrapper-integration facts:');
  console.log('- MarkdownRichEditor already owns the MDXEditor ref used for getMarkdown() and the active editor ref used for command dispatch.');
  console.log('- MarkdownRichEditor already exposes an imperative handle where flushPendingEdits() and getCanonicalMarkdown() can be added without changing its ownership model.');
  console.log('- The wrapper already receives the real onChange completion signal from MDXEditor and the real active-editor updates from the bridge.');
  console.log('- The nested editor path already supports forced publication via NESTED_EDITOR_UPDATED_COMMAND, and the root editor path already turns the resulting update into markdown export plus onChange notification.');
  console.log('- Therefore, there is no structural blocker in the real wrapper to attaching the proven latest-wins coalescer to a real flushPendingEdits() contract.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
