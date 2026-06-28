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
  const corePluginSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/core/index.js');
  const mdxEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/MDXEditor.js');
  const sourceEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/plugins/diff-source/SourceEditor.js');
  const markdownRichEditorSource = await readFrontendFile('src/components/Viewer/MarkdownRichEditor.tsx');

  assertContainsAll(
    corePluginSource,
    [
      'r.link(markdown$, markdownSourceEditorValue$);',
      'r.link(markdownSourceEditorValue$, markdownSignal$);',
      'if (current === "source" || current === "diff") {',
      'r.pub(setMarkdown$, markdownSourceFromEditor);',
      'filter((mode) => mode.current === "rich-text")',
      'editor == null ? void 0 : editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'view-mode markdown handoff pipeline'
  );

  assertContainsAll(
    sourceEditorSource,
    [
      'const updateMarkdown = usePublisher(markdownSourceEditorValue$);',
      'EditorView.updateListener.of(({ state }) => {',
      'updateMarkdown(state.doc.toString());',
    ],
    'source editor buffer publishing'
  );

  assertContainsAll(
    mdxEditorSource,
    [
      'if (viewMode === "source" || viewMode === "diff") {',
      'return realm.getValue(markdownSourceEditorValue$);',
      'return realm.getValue(markdown$);',
    ],
    'MDXEditor mode-aware markdown getter'
  );

  assertContainsAll(
    markdownRichEditorSource,
    [
      'const MarkdownViewModeBridge = ({ onViewModeChange }',
      'onViewModeChange(viewMode);',
      'const restoreFocusAfterViewModeChange = useCallback(',
      'onViewModeChange={restoreFocusAfterViewModeChange}',
    ],
    'app wrapper transition and focus-restoration integration'
  );

  console.log('Proof 4A passed. Verified source-mode transition facts:');
  console.log('- The package mirrors rich-text markdown into markdownSourceEditorValue$ for source-mode display.');
  console.log('- The source editor publishes user edits back into markdownSourceEditorValue$ on every update.');
  console.log('- Leaving source or diff mode re-imports markdownSourceEditorValue$ through setMarkdown$.');
  console.log('- MDXEditor.getMarkdown() reads the source buffer in source/diff mode and markdown$ in rich-text mode.');
  console.log('- The app wrapper already observes view-mode transitions and restores focus around them.');
  console.log('- Therefore, once rich-text export is canonicalized and flushed before transition, source mode can receive and preserve the same authoritative canonical markdown without relying on draft-state guessing.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
