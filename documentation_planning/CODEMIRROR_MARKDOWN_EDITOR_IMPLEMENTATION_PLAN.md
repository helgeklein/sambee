# CodeMirror Markdown Editor Implementation Plan

## Purpose

This document turns the migration strategy in [documentation_planning/CODEMIRROR_MARKDOWN_EDITOR_MIGRATION_PLAN.md](./CODEMIRROR_MARKDOWN_EDITOR_MIGRATION_PLAN.md) into an execution-ready implementation plan.

It is intended to guide the actual code changes needed to:

- replace MDXEditor with CodeMirror for markdown editing
- keep the current markdown viewer path unchanged
- preserve markdown table-cell line-break behavior
- establish the reusable editor seam needed for the later universal text-file editor rollout

## Implementation Goals

- Ship markdown source editing on CodeMirror without breaking the current read-only markdown viewer.
- Keep `normalizeMarkdownTableCellLineBreaks` and `remarkRenderMarkdownTableCellLineBreaks` behavior intact.
- Start with vanilla CodeMirror styling and only minimal CSS needed for layout and readability.
- Delay Sambee-specific theming until core editing behavior is implemented and verified.
- Land the work in slices that are independently testable and reversible.

## Non-Goals For This Implementation

- No rich-text markdown editing replacement.
- No markdown formatting toolbar parity with MDXEditor in the first cut.
- No generic multi-file text editor rollout in the same implementation sequence.
- No custom CodeMirror theme in the first cut.
- No diff or merge editor recreation in the first cut.

## Preconditions

Before starting implementation:

- keep [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx) as the single markdown viewer entry point
- keep [frontend/src/components/Viewer/markdownTableCellLineBreaks.ts](../frontend/src/components/Viewer/markdownTableCellLineBreaks.ts) unchanged until the new edit flow is proven
- do not remove MDXEditor files until CodeMirror edit mode is already working and validated

## Primary Files In Scope

### Existing files to modify

- [frontend/package.json](../frontend/package.json)
- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- [frontend/src/components/Viewer/useMarkdownEditSession.ts](../frontend/src/components/Viewer/useMarkdownEditSession.ts)
- [frontend/src/components/Viewer/MarkdownEditorErrorBoundary.tsx](../frontend/src/components/Viewer/MarkdownEditorErrorBoundary.tsx) if it remains necessary
- [frontend/src/theme/viewerStyles.ts](../frontend/src/theme/viewerStyles.ts)
- [frontend/src/services/runtimeWarmup.ts](../frontend/src/services/runtimeWarmup.ts) if lazy-load behavior changes
- [frontend/src/test/helpers/lazyMocks.ts](../frontend/src/test/helpers/lazyMocks.ts)
- [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)
- [frontend/src/__tests__/integration/browse-view-flow.test.tsx](../frontend/src/__tests__/integration/browse-view-flow.test.tsx)
- [frontend/e2e/markdown-viewer.spec.ts](../frontend/e2e/markdown-viewer.spec.ts)

### Existing files likely to delete late in the implementation

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)
- [frontend/src/components/Viewer/loadMarkdownRichEditor.ts](../frontend/src/components/Viewer/loadMarkdownRichEditor.ts)
- [frontend/src/components/Viewer/ensureLexicalPrism.ts](../frontend/src/components/Viewer/ensureLexicalPrism.ts)
- [frontend/src/components/Viewer/tableCellAdjacentBreakInsertion.ts](../frontend/src/components/Viewer/tableCellAdjacentBreakInsertion.ts)
- [frontend/src/components/Viewer/mdxEditorSearchPlugin.ts](../frontend/src/components/Viewer/mdxEditorSearchPlugin.ts)
- [frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx)
- [frontend/src/components/Viewer/__tests__/mdxEditorSearchPlugin.test.ts](../frontend/src/components/Viewer/__tests__/mdxEditorSearchPlugin.test.ts)
- [frontend/src/proofs/mdxeditorTableCellHarness.tsx](../frontend/src/proofs/mdxeditorTableCellHarness.tsx) if no longer useful

### New files to add

Recommended target folder:

- [frontend/src/components/Editor](../frontend/src/components/Editor)

Recommended first-pass file set:

- `frontend/src/components/Editor/SourceTextEditor.tsx`
- `frontend/src/components/Editor/sourceTextEditorTypes.ts`
- `frontend/src/components/Editor/buildCommonEditorExtensions.ts`
- `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`
- `frontend/src/components/Editor/__tests__/SourceTextEditor.test.tsx`
- `frontend/src/components/Editor/__tests__/buildMarkdownEditorExtensions.test.ts` if the extension builder gets meaningful local logic

## Dependency Changes

### Add in the first implementation slice

Add these frontend dependencies:

- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/commands`
- `@codemirror/search`
- `@codemirror/language`
- `@codemirror/lang-markdown`
- `@codemirror/language-data`
- `codemirror`

### Remove in the final cleanup slice

- `@mdxeditor/editor`

Do not remove MDXEditor until the CodeMirror path is fully integrated and validated.

## Implementation Order

## Phase 0: Pre-flight preparation

### Goal

Prepare the dependency and folder scaffolding without changing markdown behavior.

### Tasks

- add the CodeMirror packages to [frontend/package.json](../frontend/package.json)
- create the shared editor folder and type definitions
- choose the final handle interface for the reusable editor component

### Required decisions in this phase

- final component location: recommend `frontend/src/components/Editor/`
- final generic handle name: recommend `SourceTextEditorHandle`
- editor ownership model: controlled `value` plus `onChange`, with imperative focus and selection helpers

### Exit criteria

- project installs with CodeMirror dependencies present
- new editor folder exists
- no runtime behavior changes yet

### Validation

```bash
cd /workspace/frontend && npm run lint
```

## Phase 1: Build the reusable editor seam

### Goal

Introduce a generic CodeMirror-backed editor component with no markdown-specific UI behavior.

### Files

- add `frontend/src/components/Editor/SourceTextEditor.tsx`
- add `frontend/src/components/Editor/sourceTextEditorTypes.ts`

### Responsibilities

`SourceTextEditor` should:

- create and destroy `EditorView`
- accept `value`, `readOnly`, `autoFocus`, `extensions`, and `onChange`
- expose an imperative handle with at least:
  - `focus()`
  - `getValue()`
  - `preserveSelection()`
  - `restorePreservedSelection()`
- preserve enough editor state to survive fullscreen dialog transitions and unsaved-changes modal interruptions
- keep external prop syncing predictable and minimal

### First-pass implementation rules

- do not add markdown-specific commands here
- do not add theme code here
- do not assume any toolbar exists
- prefer direct CodeMirror integration over a wrapper library

### Exit criteria

- `SourceTextEditor` mounts in tests
- value changes flow from editor to React state
- external value replacement updates the document correctly
- focus and selection preservation helpers work in tests

### Validation

```bash
cd /workspace/frontend && npm test -- SourceTextEditor
```

and:

```bash
cd /workspace/frontend && npm run lint
```

## Phase 2: Build shared and markdown-specific extension assembly

### Goal

Create the CodeMirror extension configuration for markdown source editing.

### Files

- add `frontend/src/components/Editor/buildCommonEditorExtensions.ts`
- add `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`

### `buildCommonEditorExtensions()` scope

Include only behavior needed now or clearly reusable soon:

- history
- keymaps
- search state support
- selection drawing
- readonly/editable toggles
- line wrapping policy

Do not overbuild for future languages in this slice.

### `buildMarkdownEditorExtensions()` scope

Include:

- markdown language support from `@codemirror/lang-markdown`
- embedded code language support via `@codemirror/language-data`
- any markdown-specific search or wrapping choices

### First-pass behavior targets

- plain source markdown editing
- undo/redo
- selection across all content types because editing is plain text
- find/next/previous support through CodeMirror search facilities
- line wrapping enabled unless a repo-local implementation check proves it causes unacceptable UX problems

### Explicitly out of scope here

- autocomplete
- linting
- formatting toolbar commands
- custom syntax theme

### Exit criteria

- extension builders exist and are isolated from viewer concerns
- markdown editor can be instantiated with the desired baseline behavior

### Validation

```bash
cd /workspace/frontend && npm run lint
```

Plus targeted tests if local extension logic warrants them.

## Phase 3: Integrate CodeMirror into MarkdownViewer edit mode

### Goal

Replace the MDXEditor edit branch in [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx) while keeping read-only mode unchanged.

### Files

- modify [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- possibly modify [frontend/src/components/Viewer/MarkdownEditorErrorBoundary.tsx](../frontend/src/components/Viewer/MarkdownEditorErrorBoundary.tsx)
- possibly modify [frontend/src/services/runtimeWarmup.ts](../frontend/src/services/runtimeWarmup.ts)

### Required changes

- replace lazy MDXEditor loading with the new `SourceTextEditor`
- wire `buildMarkdownEditorExtensions()` into edit mode
- keep markdown load normalization through `normalizeMarkdownTableCellLineBreaks`
- save the canonical markdown string directly from the source editor handle
- preserve existing read-only rendering and DOM-search behavior for view mode

### MDXEditor-specific code to remove from this slice if no longer needed

- `loadMarkdownRichEditor`
- `ensureLexicalPrism`
- edit-mode-specific crash recovery that only exists for MDXEditor loading
- rich-text insertion command wiring in the viewer toolbar

### Constraints

- do not rewrite the viewer shell
- do not change file loading semantics
- do not change markdown table-cell line-break normalization behavior

### Exit criteria

- markdown files open in view mode exactly as before
- entering edit mode shows the CodeMirror source editor
- edits save and reload correctly
- canonical table-cell line-break behavior is preserved across save and reload

### Validation

```bash
cd /workspace/frontend && npm test -- MarkdownViewer
```

and:

```bash
cd /workspace/frontend && npm run lint
```

## Phase 4: Reconnect search, dirty-state, and focus restoration

### Goal

Restore feature parity for the essential viewer-owned editing session behavior.

### Files

- modify [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- modify [frontend/src/components/Viewer/useMarkdownEditSession.ts](../frontend/src/components/Viewer/useMarkdownEditSession.ts)
- keep [frontend/src/components/Viewer/focusRestoration.ts](../frontend/src/components/Viewer/focusRestoration.ts) unless a CodeMirror-specific gap requires a small addition

### Required changes

- map the existing search UI to:
  - DOM search in read-only mode
  - CodeMirror search in edit mode
- reconnect dirty-state tracking to CodeMirror document changes
- make save enablement reflect the new edit state accurately
- preserve focus and selection across:
  - enter-edit
  - save
  - unsaved-changes dialog open/close

### Important refactor boundary

`useMarkdownEditSession` should stop assuming MDXEditor or generic `contenteditable` behavior where that assumption is no longer necessary.

Retain it only as viewer-session logic.

### Exit criteria

- search next/previous works in edit mode
- unsaved changes detection remains correct
- focus restoration remains reliable in the fullscreen dialog workflow

### Validation

```bash
cd /workspace/frontend && npm test -- MarkdownViewer focusRestoration browse-view-flow
```

and:

```bash
cd /workspace/frontend && npm run lint
```

## Phase 5: Minimal styling stabilization

### Goal

Make the new editor usable inside the viewer shell without introducing Sambee-specific theming yet.

### Files

- modify [frontend/src/theme/viewerStyles.ts](../frontend/src/theme/viewerStyles.ts)
- possibly add minimal local CSS or CodeMirror base-theme glue inside the new editor files if strictly necessary

### Rules

- keep vanilla CodeMirror styling as the baseline
- only override what is necessary to fix:
  - clipping
  - unreadable text
  - broken cursor or selection visibility
  - dialog overflow issues

### Explicitly defer

- custom Sambee syntax colors
- polished gutter styling
- full theme parity with the rest of the app

### Exit criteria

- editor is readable
- cursor and selection are visible
- editor fits correctly inside the markdown viewer dialog
- no major layout regressions

### Validation

```bash
cd /workspace/frontend && npm test -- viewerStyles MarkdownViewer
```

and manual browser verification on the demo route.

## Phase 6: Test updates and regression coverage

### Goal

Move the test suite off MDXEditor assumptions and establish CodeMirror-based coverage.

### Files

- modify [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)
- add `frontend/src/components/Editor/__tests__/SourceTextEditor.test.tsx`
- modify [frontend/src/__tests__/integration/browse-view-flow.test.tsx](../frontend/src/__tests__/integration/browse-view-flow.test.tsx)
- modify [frontend/src/test/helpers/lazyMocks.ts](../frontend/src/test/helpers/lazyMocks.ts)
- modify [frontend/e2e/markdown-viewer.spec.ts](../frontend/e2e/markdown-viewer.spec.ts)

### Required coverage

- read-only markdown rendering remains unchanged
- canonical markdown load normalization still happens
- edit mode mounts CodeMirror instead of MDXEditor
- save/reload preserves table-cell line-break behavior
- selection works across multiple markdown structures in edit mode
- search next/previous works in edit mode
- unsaved-changes behavior still works

### Test deletion rule

Do not delete MDXEditor-heavy tests until equivalent behavior is covered at the viewer or source-editor level.

### Exit criteria

- unit and integration tests no longer depend on MDXEditor-specific mocks for active functionality
- e2e markdown smoke still passes

### Validation

```bash
cd /workspace/frontend && npm test -- MarkdownViewer SourceTextEditor browse-view-flow
```

and:

```bash
cd /workspace/frontend && npm run test:e2e:markdown
```

## Phase 7: Remove MDXEditor and Lexical remnants

### Goal

Delete obsolete editor code only after CodeMirror is already validated.

### Files

- delete MDXEditor-only runtime files
- delete MDXEditor-only tests and proof harnesses
- remove remaining imports from [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- remove the dependency from [frontend/package.json](../frontend/package.json)

### Required checks before deletion

- confirm there are no runtime imports left
- confirm test helpers and mocks no longer reference the removed editor path

### Exit criteria

- no MDXEditor runtime dependency remains
- no Lexical/MDXEditor-only helper remains in active frontend code

### Validation

```bash
cd /workspace/frontend && npm run lint
```

and:

```bash
cd /workspace/frontend && npm test
```

## Final Validation Pass

Run the full frontend validation slice used for this migration:

```bash
cd /workspace/frontend && npx tsc --noEmit
```

```bash
cd /workspace/frontend && npm run lint
```

```bash
cd /workspace/frontend && npm test -- MarkdownViewer SourceTextEditor browse-view-flow
```

```bash
cd /workspace/frontend && npm run test:e2e:markdown
```

Manual validation should cover:

- open markdown file
- verify read-only rendering parity
- enter edit mode
- edit headings, paragraphs, fenced code, and tables
- search in both view mode and edit mode
- save and reload
- verify table-cell line breaks still render correctly

## Acceptance Criteria

- Markdown view mode remains functionally unchanged.
- Markdown edit mode uses CodeMirror source editing.
- Table-cell line-break normalization and rendering remain intact.
- Essential edit behavior works: focus, search, dirty state, save, reload.
- Styling is usable with vanilla CodeMirror plus minimal corrective overrides.
- MDXEditor is removed only after the CodeMirror path is proven.
- The new editor seam is reusable for future text/code file support.

## Recommended Commit / PR Slices

1. Add CodeMirror dependencies and `SourceTextEditor` scaffolding.
2. Add shared and markdown extension builders.
3. Switch MarkdownViewer edit mode to CodeMirror.
4. Restore search, dirty-state, and focus behavior.
5. Add minimal styling stabilization and tests.
6. Remove MDXEditor runtime files, tests, and dependency.

## Follow-Up After This Implementation

After this plan is complete, the next plan should cover:

- a proper Sambee CodeMirror theme
- file-type based language resolution for general text/code files
- expansion of the reusable editor seam into a universal text-file viewer/editor path
