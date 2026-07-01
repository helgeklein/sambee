export function loadMarkdownRichEditor() {
  // Keep the dynamic import behind a tiny helper so the production chunk split
  // and the test seam stay in one place.
  return import("./MarkdownRichEditor");
}
