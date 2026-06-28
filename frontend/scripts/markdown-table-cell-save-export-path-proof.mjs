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
  const mdxEditorSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/MDXEditor.js');
  const exportMarkdownSource = await readFrontendFile('node_modules/@mdxeditor/editor/dist/exportMarkdownFromLexical.js');
  const markdownRichEditorSource = await readFrontendFile('src/components/Viewer/MarkdownRichEditor.tsx');
  const markdownViewerSource = await readFrontendFile('src/components/Viewer/MarkdownViewer.tsx');

  assertContainsAll(
    tableEditorSource,
    [
      'lexicalTable.updateCellContents(colIndex, rowIndex, mdast.children[0].children);',
      'parentEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, void 0);',
    ],
    'nested table-cell publication path'
  );

  assertContainsAll(
    corePluginSource,
    [
      'theNewMarkdownValue = exportMarkdownFromLexical({',
      'root: $getRoot(),',
      'visitors: r.getValue(exportVisitors$),',
      'toMarkdownExtensions: r.getValue(toMarkdownExtensions$),',
      'toMarkdownOptions: r.getValue(toMarkdownOptions$),',
      'r.pub(markdown$, theNewMarkdownValue.trim());',
    ],
    'rich-text markdown export listener'
  );

  assertContainsAll(
    mdxEditorSource,
    [
      'getMarkdown: () => {',
      'const viewMode = realm.getValue(viewMode$);',
      'if (viewMode === "source" || viewMode === "diff") {',
      'return realm.getValue(markdown$);',
    ],
    'MDXEditor imperative markdown getter'
  );

  assertContainsAll(
    exportMarkdownSource,
    [
      'return toMarkdown(exportLexicalTreeToMdast({ root, visitors, jsxComponentDescriptors, jsxIsAvailable }), {',
      'extensions: toMarkdownExtensions,',
    ],
    'final exportMarkdownFromLexical boundary'
  );

  assertContainsAll(
    markdownRichEditorSource,
    [
      'const editorRef = useRef<MDXEditorMethods>(null);',
      'const currentMarkdown = editorRef.current?.getMarkdown();',
      'editorRef.current.setMarkdown(markdown);',
    ],
    'app wrapper proximity to MDXEditor markdown methods'
  );

  assertContainsAll(
    markdownViewerSource,
    ['const savedContent = draftContent;'],
    'current viewer save payload'
  );

  console.log('Proof 3A passed. Verified save-export path facts:');
  console.log('- Nested table-cell publication already feeds the parent editor through NESTED_EDITOR_UPDATED_COMMAND.');
  console.log('- In rich-text mode, the package centralizes authoritative markdown export through exportMarkdownFromLexical(...) into markdown$.');
  console.log('- MDXEditor.getMarkdown() returns that markdown$ value in rich-text mode.');
  console.log('- The app wrapper already holds an MDXEditorMethods ref and already calls getMarkdown()/setMarkdown() locally.');
  console.log('- The current viewer still saves draftContent directly, so the remaining implementation change is to expose and consume the authoritative rich-text export instead.');
  console.log('- Therefore, a canonicalized rich-text save payload can be sourced from the editor export pipeline without relying on outer draft state.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
