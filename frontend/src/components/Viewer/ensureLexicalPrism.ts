export async function ensureLexicalPrism(): Promise<void> {
  // MDXEditor/Lexical is no longer used, but MarkdownViewer still awaits this
  // loader seam during the migration to keep the lazy-load path stable.
}

export function resetLexicalPrismForRetry(): void {
  // No-op after the CodeMirror migration.
}
