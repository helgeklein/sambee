# CodeMirror Markdown Editor Migration Plan

## Purpose

This document defines a concrete migration plan for replacing MDXEditor with CodeMirror for markdown file editing while preserving the current rich markdown viewer path.

This is a pre-implementation planning document. It is intended to be reviewed before any code changes are made.

## Requested Outcome

- Keep the current read-only markdown viewer behavior unchanged.
- Keep the current table-cell line break canonicalization and rendering behavior.
- Remove MDXEditor and Lexical from the frontend.
- Add CodeMirror as the markdown source editor replacement.
- Avoid a markdown-only editor design that must be rewritten again when Sambee expands to broader text-file editing.
- Start with vanilla CodeMirror styling, and defer Sambee-specific theming until the essential editor behavior is implemented and verified.

## Current State

Current markdown viewer/editing ownership is split across:

- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)
- [frontend/src/components/Viewer/markdownTableCellLineBreaks.ts](../frontend/src/components/Viewer/markdownTableCellLineBreaks.ts)
- [frontend/src/components/Viewer/useMarkdownEditSession.ts](../frontend/src/components/Viewer/useMarkdownEditSession.ts)
- [frontend/src/utils/FileTypeRegistry.ts](../frontend/src/utils/FileTypeRegistry.ts)

Current behavior:

- Read-only markdown rendering already does not depend on MDXEditor.
- Edit mode lazy-loads MDXEditor and a large amount of Lexical-specific behavior.
- Markdown content is normalized on load through `normalizeMarkdownTableCellLineBreaks`.
- Read-only rendering restores those canonical table-cell breaks through `remarkRenderMarkdownTableCellLineBreaks`.
- The current file registry has a markdown viewer, but no generic text-file viewer/editor surface yet.
- Existing viewer styles already contain some CodeMirror-oriented selectors, but they are currently tied to MDXEditor source/code-block surfaces rather than a first-class standalone editor.

## Design Decisions

### 1. Keep the viewer path intact

Preserve the current read-only markdown pipeline in [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx):

- `ReactMarkdown`
- `remark-gfm`
- `rehype-highlight`
- existing markdown link handling
- existing viewer search/highlight behavior

This avoids mixing viewer migration with editor migration.

### 2. Keep table-cell line-break support as shared markdown behavior

Keep [frontend/src/components/Viewer/markdownTableCellLineBreaks.ts](../frontend/src/components/Viewer/markdownTableCellLineBreaks.ts) as a content-model helper, not as an editor-specific workaround.

That means:

- continue normalizing loaded markdown with `normalizeMarkdownTableCellLineBreaks`
- continue rendering canonical `<br />` table-cell content through `remarkRenderMarkdownTableCellLineBreaks`
- ensure the new source editor edits the canonical markdown string directly

### 3. Replace MDXEditor with a reusable CodeMirror surface, not a markdown-only wrapper

The replacement should not be another `MarkdownRichEditor`-style monolith.

Preferred shape:

- a reusable base editor component, for example `SourceTextEditor`
- markdown-specific extension assembly separated into a small markdown adapter module
- editor commands and imperative handle kept generic wherever possible

This is the key design choice that supports the later universal text-editor rollout.

### 4. Use CodeMirror packages directly

Preferred integration approach:

- use CodeMirror 6 core packages directly in a local React wrapper
- do not make a third-party React wrapper the architectural foundation

Reasoning:

- Sambee already needs custom focus, save, dirty-state, and viewer-dialog behavior
- direct integration keeps the imperative handle and extension model under local control
- it avoids adopting a wrapper abstraction that would later need to be worked around for universal-editor features

If implementation speed becomes the overriding concern, `@uiw/react-codemirror` is a viable temporary option, but it should be treated as a tactical shortcut rather than the long-term platform decision.

### 5. Do not rely on `basicSetup` as the long-term editor contract

For the first pass, CodeMirror can be brought up quickly with a standard extension bundle. But the long-term editor should own its extension list explicitly.

Preferred outcome:

- define a local shared extension builder for Sambee
- include only the behaviors Sambee actually wants
- treat search, keymaps, selection drawing, line numbers, wrapping, history, and language support as explicit decisions

This fits the planned universal-editor direction better than treating `basicSetup` as an opaque permanent dependency.

## Recommended Target Architecture

### Editor layers

Create three layers:

1. `SourceTextEditor`
   - generic React wrapper around `EditorView`
   - owns lifecycle, focus, selection preservation, scroll preservation, and change dispatch
   - exposes a small imperative handle for the viewer dialog

2. `buildCommonEditorExtensions()`
   - shared editor behavior for all text-like files
   - examples: history, keymaps, selection drawing, search support, line wrapping policy, readonly/editable toggles

3. language adapters
   - `buildMarkdownEditorExtensions()` first
   - later `buildTextEditorExtensionsForPath()` or equivalent file-type based resolver

### Markdown viewer ownership after migration

[frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx) should still own:

- file loading and saving
- read-only viewer rendering
- markdown canonicalization on load/save
- edit-mode dialog controls and unsaved-changes flow
- viewer-level search UI state

The new editor surface should own only editing behavior.

### Generic imperative handle

Replace the MDXEditor-specific handle with a small generic handle surface, for example:

- `focus()`
- `preserveSelection()`
- `restorePreservedSelection()`
- `getValue()`
- `setSearchQuery()` or viewer-driven search hooks
- `focusNextSearchResult()` / `focusPreviousSearchResult()` if search remains editor-local

Avoid markdown-specific formatting commands in the base handle. If toolbar formatting actions are needed later, they should live in optional markdown commands layered above the base editor.

## Package Plan

### Add now

Initial CodeMirror packages for markdown editing:

- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/commands`
- `@codemirror/search`
- `@codemirror/language`
- `@codemirror/lang-markdown`
- `@codemirror/language-data`
- `codemirror`

Potentially add soon after, but not required for the first cut:

- language packages for files Sambee wants next, such as JavaScript, TypeScript, JSON, Python, HTML, CSS, and XML
- avoid theme packages in the first cut unless a concrete readability problem forces a temporary stopgap

### Remove later in the same migration

- `@mdxeditor/editor`
- any MDXEditor/Lexical-only support packages that are no longer referenced

## Concrete Migration Plan

### Phase 1: Establish the reusable editor seam

Create a new generic editor component under the viewer area or a nearby shared editor folder.

Recommended responsibilities:

- mount and destroy `EditorView`
- accept `value`, `readOnly`, `autoFocus`, `extensions`, and `onChange`
- preserve and restore selection/scroll in a way compatible with the fullscreen viewer dialog
- expose a small imperative ref API
- avoid any markdown formatting UI in this phase

Important constraint:

Do not name or design this as a markdown-only component unless the generic seam is preserved internally.

### Phase 2: Build the markdown extension set

Create a markdown-specific extension builder that composes:

- common editor extensions
- markdown language support from `@codemirror/lang-markdown`
- embedded code language support via `@codemirror/language-data`
- editor search support
- the minimum keymap Sambee wants to keep initially

Recommended first-pass behavior:

- editable plain source markdown
- undo/redo
- find/next/previous integration
- selection that works across headings, paragraphs, code fences, and tables because the editor is editing plain text rather than a rich-text node tree
- line wrapping enabled for markdown editing unless Sambee specifically prefers horizontal scrolling

Defer in the first cut:

- markdown toolbar formatting actions
- custom autocomplete
- linting
- diff/merge mode recreation
- any Sambee-specific theming beyond acceptable baseline readability

### Phase 3: Swap the markdown edit branch in MarkdownViewer

Inside [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx):

- keep the existing read-only render branch unchanged
- replace the MDXEditor lazy-load path with the new CodeMirror source editor component
- keep `normalizeMarkdownTableCellLineBreaks` in the load path
- persist the canonical markdown string directly from the new editor

Refactor or delete the MDXEditor-specific edit wiring:

- `ensureLexicalPrism`
- `loadMarkdownRichEditor`
- `MarkdownEditorErrorBoundary` if it only exists for MDXEditor load failures
- MDXEditor-specific search-state bridges
- editor commands for rich-text insertion actions that no longer apply

Keep and adapt the viewer-owned edit-session behavior where still relevant:

- dirty-state tracking
- save flow
- unsaved-changes confirmation
- focus restoration after dialogs

### Phase 4: Re-scope search and edit-session logic around plain text editing

Current search behavior is split between viewer DOM highlighting and MDXEditor-specific search state.

Target outcome:

- keep viewer DOM search for read-only mode
- use CodeMirror search for edit mode
- unify the viewer toolbar state so the UI still feels like one search surface even though the implementation differs by mode

Similarly, keep [frontend/src/components/Viewer/useMarkdownEditSession.ts](../frontend/src/components/Viewer/useMarkdownEditSession.ts) only where it still solves viewer/session problems. Remove any assumptions that depend on contenteditable or MDXEditor toolbar internals.

### Phase 5: Remove MDXEditor and Lexical surfaces

Delete or retire the MDXEditor-specific files once markdown editing is fully running on CodeMirror:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)
- [frontend/src/components/Viewer/loadMarkdownRichEditor.ts](../frontend/src/components/Viewer/loadMarkdownRichEditor.ts)
- [frontend/src/components/Viewer/ensureLexicalPrism.ts](../frontend/src/components/Viewer/ensureLexicalPrism.ts)
- [frontend/src/components/Viewer/tableCellAdjacentBreakInsertion.ts](../frontend/src/components/Viewer/tableCellAdjacentBreakInsertion.ts)
- [frontend/src/components/Viewer/mdxEditorSearchPlugin.ts](../frontend/src/components/Viewer/mdxEditorSearchPlugin.ts)
- related editor-only tests and proofs

Then remove the MDXEditor dependency from [frontend/package.json](../frontend/package.json).

### Phase 6: Prepare the universal text-editor rollout

Before expanding file support, finish one extraction pass so the markdown implementation is no longer special in the wrong places.

Recommended follow-up seam:

- move the reusable editor component out of markdown-specific naming
- add a file-path or file-type driven language resolver
- introduce a generic text-file viewer/editor component for `.txt`, code files, and similar source assets
- reuse the same editor handle, search wiring, save flow, and viewer shell patterns

The first universal-editor rollout can then be mostly registry work in [frontend/src/utils/FileTypeRegistry.ts](../frontend/src/utils/FileTypeRegistry.ts) plus language package additions, rather than another editor migration.

## Styling Plan

### First cut

The first shipping pass only needs to be visually acceptable and coherent inside the existing viewer shell.

Use:

- vanilla CodeMirror styling as the default baseline
- only the minimum CSS overrides needed to avoid layout, overflow, or readability problems in the viewer dialog
- the existing CodeMirror-related selectors in [frontend/src/theme/viewerStyles.ts](../frontend/src/theme/viewerStyles.ts) as a source of constraints to simplify, not as a requirement to fully restyle the editor in the first cut

Required first-cut styling outcomes:

- readable text and cursor
- acceptable selection colors
- no broken overflow or clipped scroll area in the dialog
- acceptable gutters if line numbers are enabled

### Near-term follow-up

After the essential editor behavior is implemented, validated, and stable:

- add a proper Sambee CodeMirror theme extension
- align syntax colors with the active app theme
- decide whether markdown should wrap by default while code-oriented file types should not

## Validation Plan

### Focused automated checks

Run at least:

```bash
cd /workspace/frontend && npm test -- MarkdownViewer
```

and:

```bash
cd /workspace/frontend && npm run lint
```

If the markdown viewer tests are too tightly coupled to MDXEditor mocks, split them so that:

- viewer rendering tests stay focused on read-only behavior
- source editor tests cover the new CodeMirror surface separately

### Required behavioral coverage

Add or update tests for:

- read-only markdown rendering remains unchanged
- markdown load still normalizes table-cell line breaks
- editing canonical markdown text preserves those table-cell line breaks through save/reload
- text selection across multiple markdown structures works in edit mode
- search next/previous works in edit mode
- unsaved-changes flow still behaves correctly in the fullscreen dialog
- focus lands in the editor on enter-edit and restores correctly after modal interruptions

### Manual validation

Use the existing markdown validation workflow in the demo environment, especially for:

- open existing markdown file
- verify read-only rendering parity
- enter edit mode
- edit normal paragraphs, headings, fenced code, and markdown tables
- save and reload
- verify table-cell line breaks still render correctly in view mode

## Risks And Mitigations

### Risk: rebuilding too much viewer logic during the editor swap

Mitigation:

- keep the viewer branch untouched
- only replace the edit branch first

### Risk: shipping a markdown-only CodeMirror component and redoing the work later

Mitigation:

- make the editor surface generic from the first commit, even if only markdown uses it initially

### Risk: search UX regression

Mitigation:

- keep one viewer toolbar/search UI
- map it to DOM-search in view mode and CodeMirror-search in edit mode

### Risk: styling churn delaying the migration

Mitigation:

- set a low first-pass styling bar
- treat Sambee-specific theming as a follow-up phase, not a blocker

## Recommended Order Of Execution

1. Create the generic `SourceTextEditor` seam and its imperative handle.
2. Implement the markdown CodeMirror extension set.
3. Swap MarkdownViewer edit mode to the new editor while keeping viewer mode unchanged.
4. Reconnect dirty-state, focus restoration, and search behavior.
5. Update tests and validate table-cell line break preservation.
6. Delete MDXEditor/Lexical files and dependencies.
7. Extract the now-proven editor seam for broader text/code file support in FileTypeRegistry.

## Bottom Line

This migration should be treated as two linked outcomes, not one:

- immediate outcome: replace markdown editing with plain-source CodeMirror while keeping the current rich viewer and table-cell line-break behavior
- platform outcome: establish Sambee's reusable text editor foundation so that expanding from markdown to general text/code files becomes an incremental rollout instead of another editor replacement
