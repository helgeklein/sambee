# CodeMirror Markdown Tables Integration Plan

## Purpose

This document describes how to integrate [`codemirror-markdown-tables`](https://github.com/ckant/codemirror-markdown-tables) into Sambee's existing CodeMirror-based markdown editor.

It is intentionally scoped to the current frontend state, where:

- CodeMirror is already the markdown editor implementation.
- markdown edit mode is owned by `MarkdownRichEditor` and `SourceTextEditor`.
- markdown viewer rendering and table-cell line-break canonicalization already exist and must remain correct.

## Current Local State

The relevant implementation is already in place in these files:

- `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`
- `frontend/src/components/Editor/buildMarkdownAutocomplete.ts`
- `frontend/src/components/Editor/buildMarkdownEditorTheme.ts`
- `frontend/src/components/Editor/buildCommonEditorExtensions.ts`
- `frontend/src/components/Viewer/MarkdownRichEditor.tsx`
- `frontend/src/components/Viewer/markdownTableCellLineBreaks.ts`
- `frontend/src/theme/viewerStyles.ts`

Notable current behavior:

- Tables are edited as plain markdown text today.
- `MarkdownRichEditor.insertTable()` inserts a hard-coded markdown snippet rather than a semantic table command.
- markdown autocomplete currently uses `autocompletion({ override: [...] })`, which means new autocomplete providers will not merge automatically.
- saved markdown is canonicalized through `normalizeMarkdownTableCellLineBreaks()`, which persists in-cell line breaks as `<br />`.

## What The Library Provides

Based on the package documentation, `codemirror-markdown-tables` adds three separate capabilities:

1. `markdownTables()`
   Turns markdown tables into interactive table widgets inside CodeMirror.

2. `markdownTableAutocompleter()`
   Adds a `|`-triggered autocomplete for inserting table sizes on an empty line.

3. `insertEmptyMarkdownTable()`
   Exposes a command for inserting a table at the cursor or over a selection.

The library also exposes important integration configuration:

- `theme`
- `style`
- `selectionType`
- `handlePosition`
- `lineWrapping`
- `extensions`
- `markdownConfig`
- `globalKeyBindings`

The most important implementation detail from the docs is that the editor embedded inside table cells does not inherit the root CodeMirror extensions automatically. Root-document commands and cell-local commands must be split deliberately.

## Integration Goals

- Replace plain-text table editing with the interactive table surface from `codemirror-markdown-tables`.
- Keep the rest of the markdown editor behavior unchanged unless the table integration requires a focused adjustment.
- Preserve the current save and render contract for markdown table-cell line breaks.
- Preserve viewer-level search, undo/redo, and keyboard behavior when focus moves into a table cell editor.
- Avoid a table integration that forks the markdown editor into a special-case architecture.

## Ordered Overview

Work through the plan in this order:

1. Complete the pre-implementation autocomplete refactor and tests.
   This removes the current `override`-based completion architecture and proves that composable `language.data` providers can coexist before the table package is introduced.

2. Complete the pre-implementation search-state extraction and tests.
   This makes root-editor search accounting explicit and testable before nested table cell editors are added.

3. Implement the production table integration in one change.
   Add `codemirror-markdown-tables`, wire table insertion and autocomplete, configure nested cell editor behavior, apply Sambee theme/style mapping, and set `handlePosition: "inside"`.

4. Keep canonical markdown persistence intact in that same implementation.
   Normalize loaded markdown before edit mode, normalize editor export before save, preserve trailing-break rules, and keep `<br />` as the only persisted table-cell line-break form.

5. Finish with production-readiness validation.
   Add helper-level, integration-level, and e2e coverage, then run the required manual validation for desktop, narrow dialog, and mobile-width layouts.

## Recommended Design

### 1. Add the package without introducing a wrapper layer

Add `codemirror-markdown-tables` to `frontend/package.json` and integrate it directly in the existing extension builder.

Do not add a separate React wrapper. The current `SourceTextEditor` and `MarkdownRichEditor` split is already the right seam.

### 2. Integrate the core table extension in `buildMarkdownEditorExtensions()`

Extend the markdown editor extension pipeline to include `markdownTables(...)` beside the existing markdown language support.

Required implementation shape:

- keep `buildCommonEditorExtensions(...)` as the root-editor baseline
- keep `buildMarkdownEditorTheme(...)` for general editor visuals
- keep markdown language support with `markdown({ codeLanguages: languages })`
- add `markdownTables({...})`
- keep `pasteURLAsLink`
- keep editor content attributes for spellcheck/autocorrect

The table extension should be configured explicitly rather than accepted with all defaults, because Sambee already has editor search, history, theming, and layout requirements.

### 3. Split root-editor and cell-editor key behavior correctly

The library docs make this distinction explicit:

- use `extensions` for commands that should operate inside the active cell only
- use `globalKeyBindings` for commands that should operate on the root markdown document

Recommended mapping for Sambee:

- cell-local `extensions`
  - `keymap.of(defaultKeymap)`
  - any minimal in-cell editing helpers that are already expected in the root editor and are safe in isolation

- root-document `globalKeyBindings`
  - `historyKeymap`
  - `searchKeymap`

Reasoning:

- undo/redo should continue to operate on the full markdown document, not only the active cell buffer
- find-next/find-previous shortcuts should continue to target the full document
- select-all inside a cell should select the cell text, which matches the library's guidance for `defaultKeymap`

### 4. Preserve the current viewer-driven search model

The current editor search UI is outside CodeMirror and drives search through `setSearchQuery`, `findNext`, and `findPrevious` on the root editor.

The integration plan should preserve that model.

Validation requirement:

- when a table cell editor has focus, search result counts, current-match tracking, and next/previous navigation must still reflect the root document correctly

If the library changes root-selection behavior enough to disturb `countSearchMatches()`, adapt the search-state reporting logic in `MarkdownRichEditor` rather than weakening the search feature.

### 5. Replace the current table insertion stub with the library command

`MarkdownRichEditor.insertTable()` should stop inserting a hard-coded markdown string.

Instead, wire it to `insertEmptyMarkdownTable()` via the existing `SourceTextEditorHandle.runCommand(...)` bridge.

Recommended default command size:

- `2 x 2` if preserving the library default is acceptable
- otherwise `3 x 3` if Sambee wants parity with richer initial table creation

Implement the command wiring now so the same command path serves both the toolbar action and any existing or future keyboard shortcut binding without follow-up refactoring.

### 6. Rework markdown autocomplete so table completion can coexist

This is the main integration conflict in the current code.

Today `buildMarkdownAutocomplete()` returns:

- `autocompletion({ override: [markdownAutocompleteSource], ... })`

That `override` suppresses language-data autocomplete providers, which is exactly how `markdownTableAutocompleter()` is designed to plug in.

Implementation plan:

1. Refactor `frontend/src/components/Editor/buildMarkdownAutocomplete.ts` so it no longer owns the full autocomplete extension stack.

   Change the file responsibilities to:

   - keep `MARKDOWN_SNIPPET_COMPLETIONS`
   - keep the current word-triggered snippet source logic
   - export a `createMarkdownSnippetAutocompleter(): CompletionSource` helper
   - export a `buildMarkdownAutocompleteUi(): Extension` helper that returns only `autocompletion({ activateOnTyping: true, icons: false })`

   The important constraint is that `buildMarkdownAutocompleteUi()` must not pass `override`, because that blocks language-data completions contributed by the markdown table package.

2. Refactor `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts` to own the full markdown autocomplete composition.

   Replace the current direct `buildMarkdownAutocomplete()` call with three separate pieces:

   - one shared `markdownLanguageSupport` constant:
     - `const markdownLanguageSupport = markdown({ codeLanguages: languages })`
   - one UI extension from `buildMarkdownAutocompleteUi()`
   - one `language.data.of(...)` extension that merges both completion sources

   The target shape in that file should be conceptually:

   ```ts
   const markdownLanguageSupport = markdown({ codeLanguages: languages });

   const markdownAutocompleteData = markdownLanguageSupport.language.data.of({
     autocomplete: (context) => {
       const snippetResult = createMarkdownSnippetAutocompleter()(context);
       if (snippetResult) {
         return snippetResult;
       }

       return markdownTableAutocompleter({
         options: [
           { rows: 2, cols: 2 },
           { rows: 3, cols: 3 },
           { rows: 4, cols: 4 },
         ],
       })(context);
     },
   });
   ```

   The exact implementation can inline the composition or extract a small helper, but the ownership should stay in `buildMarkdownEditorExtensions.ts` because that file already assembles the markdown-specific extension stack.

3. Make snippet completion yield only when it is actually the intended source.

   Preserve the current behavior where snippet completions activate on explicit invocation or on a word match like `h1`, `quote`, or `task`.

   Do not let the snippet completer claim the `|` case. For table insertion on an empty line, the snippet completer must return `null` so the table package's autocompleter can answer.

   In practice, this means:

   - keep the current `context.matchBefore(/[A-Za-z][A-Za-z0-9-]*/)` gate for snippet completions
   - do not broaden it to punctuation-triggered matches
   - rely on `markdownTableAutocompleter(...)` for the `|` trigger path

4. Remove the existing markdown `table` snippet from `MARKDOWN_SNIPPET_COMPLETIONS`.

   Once `markdownTableAutocompleter()` is active, keeping the old generic `table` snippet creates overlapping ways to insert tables with worse UX and less predictable ranking.

   The implementation-ready rule is:

   - keep non-table markdown snippets such as `h1`, `task`, `quote`, `link`, `image`, and fences
   - delete the snippet whose label is `table`

5. Keep only one `autocompletion(...)` extension in the root extension list.

   After the refactor, `buildMarkdownEditorExtensions()` should include:

   - `buildMarkdownAutocompleteUi()` exactly once
   - `markdownLanguageSupport`
   - `markdownAutocompleteData`

   Do not add a second `autocompletion(...)` call for the table package. Its contribution should arrive through `language.data`, which CodeMirror merges into the single active autocomplete UI.

6. Default the table-size menu to the package defaults unless product requirements say otherwise.

   Use:

   - `{ rows: 2, cols: 2 }`
   - `{ rows: 3, cols: 3 }`
   - `{ rows: 4, cols: 4 }`

   This matches the documented defaults and avoids introducing a Sambee-specific opinion before real usage feedback exists.

7. Add focused regression coverage for the new composition.

   Update or add tests so they verify all of the following in one slice:

   - explicit autocomplete still shows snippet options for a word trigger like `h1`
   - typing `|` on an otherwise empty line shows table-size completion options
   - typing `|` in the middle of normal prose does not replace snippet completion behavior unexpectedly
   - there is no second competing `table` snippet in the suggestion list

Exit criteria for this subsection:

- `frontend/src/components/Editor/buildMarkdownAutocomplete.ts` no longer exports an `override`-based full autocomplete extension
- `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts` owns the merged markdown completion wiring
- the `|` trigger path is served by `markdownTableAutocompleter(...)`
- word-triggered snippet completions still work
- no duplicate generic table snippet remains

### 7. Map Sambee theme tokens into the library theme/style config

The table package has its own `TableTheme` and `TableStyle` layers, separate from the root editor theme.

The integration should derive those values from Sambee's existing editor/viewer colors instead of accepting unrelated defaults.

Implementation plan:

1. Introduce a dedicated table-theme helper instead of embedding table variables inline.

   Add a new helper file:

   - `frontend/src/components/Editor/buildMarkdownTableTheme.ts`

   Its job should be limited to translating Sambee theme inputs into the table package's `theme` and `style` config objects.

   Do not overload `buildMarkdownEditorTheme.ts` with table-package-specific CSS variable logic. That file should remain responsible for root CodeMirror theme extensions only.

2. Keep the helper API aligned with the data Sambee already computes in `MarkdownViewer.tsx`.

   The new helper should accept a small, explicit input object derived from current editor/viewer colors, for example:

   ```ts
   interface MarkdownTableThemeOptions {
     activeLineBackground: string;
     borderColor: string;
     selectionBackground: string;
     surfaceBackground: string;
     textColor: string;
     tableBackground: string;
     tableAlternateRowBackground: string;
     tableHeaderBackground: string;
     tableHeaderText?: string;
     tableBorderColor: string;
     isDarkMode: boolean;
   }
   ```

   The exact type name can vary, but the helper should not read MUI theme state directly. `MarkdownViewer.tsx` already computes the relevant values, and those values should remain the source of truth.

3. Populate the helper inputs from existing theme sources only.

   Build the input object from:

   - `markdownEditorTheme` in `frontend/src/components/Viewer/MarkdownViewer.tsx`
   - `getMarkdownTableSurfaceColors()` in `frontend/src/theme/viewerStyles.ts`
   - `muiTheme.palette.mode` in `MarkdownViewer.tsx`

   The implementation-ready rule is:

   - do not invent a second independent color palette for tables
   - do not hardcode new hex values in the integration code unless there is no current token that can express the needed value

4. Return a complete `theme` object for the table package, not scattered CSS overrides.

   The helper should return a structure ready to pass directly into `markdownTables({...})`, with:

   - `theme: { light: TableTheme; dark: TableTheme }`
   - `style: TableStyle`

   Even if Sambee currently computes only one editor theme object per render, still build both light and dark branches explicitly. The package keys off CodeMirror light/dark mode, and the mapping should stay explicit rather than relying on `:root` CSS overrides.

5. Use direct property mapping in the production implementation.

   The table-theme helper should set these package theme variables from Sambee inputs:

   - `--tbl-theme-row-background` -> `tableBackground`
   - `--tbl-theme-even-row-background` -> `tableAlternateRowBackground`
   - `--tbl-theme-odd-row-background` -> `tableBackground`
   - `--tbl-theme-header-row-background` -> `tableHeaderBackground`
   - `--tbl-theme-border-color` -> `tableBorderColor`
   - `--tbl-theme-border-hover-color` -> `borderColor`
   - `--tbl-theme-border-active-color` -> `textColor`
   - `--tbl-theme-outline-color` -> `textColor`
   - `--tbl-theme-text-color` -> `textColor`
   - `--tbl-theme-menu-border-color` -> `tableBorderColor`
   - `--tbl-theme-menu-background` -> `surfaceBackground`
   - `--tbl-theme-menu-hover-background` -> `activeLineBackground`
   - `--tbl-theme-menu-text-color` -> `textColor`
   - `--tbl-theme-menu-hover-text-color` -> `textColor`
   - `--tbl-theme-select-all-focus-overlay` -> `selectionBackground`

   For `--tbl-theme-select-all-blur-overlay`, use a softened variant of `selectionBackground` rather than duplicating the focused value exactly. If the helper needs a small utility to reduce alpha, keep it local to the table-theme helper.

6. Map table style values explicitly and keep them inherit-compatible.

   The helper should set these style properties through `TableStyle.default.with(...)`:

   - `--tbl-style-font-family` -> `inherit`
   - `--tbl-style-font-size` -> `inherit`
   - `--tbl-style-menu-font-family` -> `inherit`
   - `--tbl-style-menu-font-size` -> `inherit`
   - `--tbl-style-default-header-alignment` -> `left`

   Do not introduce a special table font. The goal is visual continuity with the surrounding markdown editor and viewer.

7. Handle missing header text color deterministically.

   `getMarkdownTableSurfaceColors()` currently returns `headerText: undefined` in light mode.

   The helper should normalize that before passing values into the table package:

   - if `tableHeaderText` is defined, use it
   - otherwise fall back to `textColor`

   This rule should live in the helper so callers do not repeat fallback logic.

8. Wire the helper in one place: `buildMarkdownEditorExtensions.ts`.

   After adding the helper, `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts` should:

   - import the helper
   - build the table config once per editor theme input
   - pass the returned `theme` and `style` into `markdownTables({...})`

   Do not split the table-package theme config across multiple files or inline fragments. The integration should make it obvious where all table styling decisions live.

9. Keep `buildMarkdownEditorTheme.ts` unchanged in responsibility.

   That file should continue to style:

   - root editor text
   - selection
   - active line
   - tooltips and panels
   - syntax highlighting

   It should not start defining `--tbl-*` CSS variables directly. Table package theming should remain data-driven through the `markdownTables({...})` config.

10. Add focused validation criteria for the theme mapping.

   Manual and automated review of the first implementation should verify all of the following:

   - selected-cell outlines are visible in both light and dark modes
   - table menus have readable foreground/background contrast in both light and dark modes
   - the select-all overlay does not look substantially darker or lighter than the root editor selection treatment
   - header-row and alternating-row colors are visually close to viewer-mode tables
   - table text, menu text, and borders still look correct when the editor is unfocused

Exit criteria for this subsection:

- a dedicated helper file produces the table package `theme` and `style` config
- `MarkdownViewer.tsx` supplies the helper only with already-computed Sambee theme values
- `buildMarkdownEditorExtensions.ts` passes the helper output directly into `markdownTables({...})`
- no new hardcoded table palette is introduced outside the existing theme/token system
- light and dark table appearance stay aligned with existing viewer/editor styling

### 8. Make a deliberate choice on `handlePosition`

Implementation decision:

- set `handlePosition: "inside"` in the production implementation

This is not a provisional preference. It should be treated as the implementation default for Sambee unless a later, validated layout change introduces a guaranteed interaction gutter for every markdown editor host.

Why `inside` is required here:

- `SourceTextEditor` currently applies fixed content padding of `16px 20px` inside `.cm-content`, but that is content padding, not a reserved drag gutter contract
- the markdown editor is rendered inside a dialog that must remain usable at narrow widths
- repository validation notes already show that table-edge controls are brittle when they rely on static offsets near content boundaries
- Sambee cannot guarantee persistent left-side gutter space across fullscreen dialog, standard dialog, and mobile layouts

Implementation plan:

1. Set the table package config explicitly in `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`.

   Do not rely on the package default. The `markdownTables({...})` call should include:

   - `handlePosition: "inside"`

   This option should live in the same configuration object as the other table-extension settings so the chosen handle behavior is obvious in one place.

2. Do not add gutter-compensation CSS in `SourceTextEditor`.

   Specifically, do not change the base editor padding in `frontend/src/components/Editor/SourceTextEditor.tsx` to make room for outside handles.

   The current padding should continue to serve only text readability and normal editor spacing. It must not become an implicit layout dependency for table-handle hit areas.

3. Do not add negative-offset or overflow-reveal CSS as a workaround.

   When `handlePosition` is `inside`, the integration must not depend on any of the following:

   - negative `left` or `top` offsets for table handles
   - extra wrapper padding added only around tables
   - `overflow: visible` changes intended to reveal controls outside the content box
   - breakpoint-specific handle shifts intended to simulate an outside gutter

   If handle usability is poor with `inside`, treat that as a behavior problem to validate and solve directly, not as a reason to smuggle `outside` behavior back in through CSS.

4. Keep the table aligned with normal markdown content.

   Because handles are inside the table border, the left edge of the rendered table should remain aligned with surrounding markdown content rather than being visually indented to reserve control space.

   The practical rule is:

   - viewer-mode table alignment remains the reference
   - editor-mode tables should not gain a permanent left inset just to support drag handles

5. Validate inside-handle usability at the exact host boundaries Sambee supports.

   Manual validation must cover all of these cases:

   - desktop-width fullscreen markdown editor dialog
   - narrow-width dialog layout
   - mobile-width layout in the browser test target
   - tables flush near the left edge of the content area
   - horizontally scrollable tables that are wider than the editor viewport

   The goal is not merely that handles render. The goal is that row and column actions remain reachable without the controls clipping or causing accidental text selection.

6. Define the failure threshold up front.

   The `inside` decision should be considered acceptable only if all of the following are true during manual validation:

   - row handles can be clicked without needing pixel-perfect positioning
   - column handles can be dragged without repeated accidental cell-text selection
   - row/column action menus open reliably at narrow widths
   - append/delete controls remain visible and clickable when the table is at the content edge

   If one of these fails, the next step is not to switch back to `outside` immediately. The next step is to document the exact failing interaction and decide whether it needs a package-compatible visual affordance adjustment while keeping `handlePosition: "inside"`.

7. Keep the future escape hatch narrow and explicit.

   If Sambee later introduces a guaranteed reserved gutter for all markdown editor hosts, only then reconsider `outside`.

   That future change would need all of the following before the plan should change:

   - a documented layout contract for gutter width
   - implementation in the shared editor host, not one-off page CSS
   - regression coverage for dialog and mobile layouts
   - re-validation of table alignment against normal markdown blocks

Exit criteria for this subsection:

- `markdownTables({...})` is configured with `handlePosition: "inside"`
- no editor-padding change is introduced to fake gutter support
- no negative-offset or overflow-based CSS workaround is introduced for table handles
- tables stay aligned with surrounding markdown content
- manual validation confirms row/column handles and menus remain usable in narrow and edge-aligned layouts

### 9. Keep the markdown line-break contract intact

The current contract is explicit:

- loaded markdown is normalized with `normalizeMarkdownTableCellLineBreaks()`
- persisted in-cell line breaks are canonicalized to `<br />`
- viewer rendering converts canonical `<br />` inside table cells into visual line breaks only inside table cells

The table package supports multi-line cell editing and documents `Shift+Enter` inserting `<br>`.

Implementation plan:

1. Keep canonicalization ownership in `frontend/src/components/Viewer/markdownTableCellLineBreaks.ts`.

   Do not move table-cell line-break normalization into the CodeMirror table extension, a table-widget command hook, or ad hoc save-time string replacement logic.

   The contract remains:

   - `normalizeMarkdownTableCellLineBreaks()` is the only canonicalization entry point
   - `remarkRenderMarkdownTableCellLineBreaks()` is the only viewer-side rendering adaptation

   This prevents the editor integration from creating a second normalization path that can drift from viewer rendering.

2. Preserve the existing load path in `frontend/src/components/Viewer/MarkdownViewer.tsx`.

   The markdown content fetched from the API must continue to be normalized before it is used to seed edit mode.

   The implementation-ready rule is:

   - keep `normalizeMarkdownTableCellLineBreaks(data)` in the file-load path
   - continue using the normalized value as the initial markdown fed into the editor
   - do not bypass normalization when the new table widget is present

   This guarantees that legacy variants such as `<BR>`, `</br>`, or encoded newline entities still enter the editor in canonical form and do not create a false dirty state.

3. Preserve the existing save/export authority in `MarkdownRichEditor.getCanonicalMarkdown()`.

   `frontend/src/components/Viewer/MarkdownViewer.tsx` already persists the editor's canonical export instead of stale outer draft state. Keep that architecture.

   The integration must ensure that:

   - `MarkdownRichEditor.getCanonicalMarkdown()` returns the full root markdown document as currently represented in CodeMirror after table-widget edits
   - `MarkdownViewer.tsx` continues to save from `editorRef.current.getCanonicalMarkdown()`
   - no save path writes a stale wrapper state value when a nested table cell editor has the latest edit

4. Add an explicit post-export normalization step if the table package emits non-canonical break markup.

   The library documentation says `Shift+Enter` inserts `<br>`, while Sambee persists `<br />`.

   Treat normalization-on-export as required in the production implementation.

   The implementation rule is:

   - after calling `editorRef.current.getCanonicalMarkdown()`, run the returned markdown through `normalizeMarkdownTableCellLineBreaks()` immediately before save
   - persist the normalized result, not the raw editor export

   This should stay centralized in `MarkdownViewer.tsx` right next to the canonical export/save path. Do not hide it inside unrelated editor code.

   If later implementation evidence proves the table package already emits fully canonical table-cell breaks in every relevant path, keeping the extra normalization step is still acceptable. The helper is already the canonicalization authority, and running it on already-canonical markdown preserves the desired persisted form.

5. Do not normalize raw markdown globally outside table-cell structure.

   The existing renderer intentionally scopes `<br />` conversion structurally to table cells so literal `<br />` text outside tables remains literal content.

   The production rule is:

   - never run a global string replace for `<br>` or `<br />`
   - never normalize based only on text patterns without parsing table-cell structure
   - keep using the AST-based helper so only actual table-cell content is transformed

6. Preserve the trailing-break policy exactly.

   `stripTrailingBreaks()` currently enforces that trailing in-cell breaks are unsupported and normalized away.

   The integration must not weaken that rule for compatibility with the new table widget. After table editing:

   - interior line breaks inside a table cell must persist canonically
   - trailing line breaks at the end of a table cell must still be removed during normalization

   If the table widget can temporarily produce trailing `<br>` markup during editing, accept that as an editor-internal state only if the saved/exported markdown still passes through the existing trailing-break stripping rule.

7. Add a dedicated unit-level normalization test surface.

   Add a focused test file for the canonicalization helper itself:

   - `frontend/src/components/Viewer/__tests__/markdownTableCellLineBreaks.test.ts`

   Do this in the production implementation, not only if the viewer tests become inconvenient. The helper is the single canonicalization authority for both load-time normalization and save-time export normalization, so it requires direct tests that do not depend on the full viewer harness.

   The helper-level test file should cover at least these explicit cases:

   - `<BR>` normalizes to `<br />`
   - malformed `</br>` normalizes to `<br />`
   - numeric newline entities in table cells normalize to `<br />`
   - trailing in-cell breaks are stripped
   - `<br />` outside tables stays untouched by viewer rendering semantics

   Add one more direct case for idempotence:

   - already-canonical table-cell markdown remains unchanged when passed through `normalizeMarkdownTableCellLineBreaks()`

   Keep these tests focused on the helper contract itself. Do not route them through `MarkdownViewer.tsx` or the CodeMirror editor unless the behavior under test specifically depends on integration rather than normalization.

8. Add integration coverage for table-widget editing, not just seeded markdown.

   Existing viewer tests already cover seeded canonicalization cases. The new production requirement is to cover edits produced through the integrated table widget itself.

   Add or update tests so they prove all of the following:

   - using `Shift+Enter` inside a table cell produces a saved canonical markdown form
   - saving after table-cell editing persists `<br />` rather than a legacy or package-specific variant
   - reloading the same file does not produce a false dirty state
   - switching from edit mode back to viewer mode renders the line break visually inside the table cell only
   - non-table literal `<br />` text remains literal after save and reload

9. Put the end-to-end contract in Playwright, not only unit tests.

   Add one focused e2e scenario in `frontend/e2e/markdown-viewer.spec.ts` that:

   - opens a markdown file with a table
   - enters edit mode
   - inserts a multi-line table-cell value through the real table widget interaction
   - saves
   - reloads or reopens the file
   - verifies the viewer shows a visual line break inside the cell and the editor reopens without a false dirty state

   This e2e scenario should be treated as required because nested editors and table widgets are exactly the kind of interaction where unit-level mocks can miss real regressions.

10. Make the decision rule explicit if the package output differs from Sambee's canonical form.

   The production decision is already fixed:

   - keep Sambee's persisted canonical form unchanged
   - normalize the exported markdown through the existing helper before save
   - do not relax tests to accept multiple persisted forms

   The persisted representation must remain a single canonical form so future dirty-state comparisons and viewer rendering stay deterministic, regardless of whether the table widget internally emits `<br>` or `<br />`.

Exit criteria for this subsection:

- load-time normalization still happens before markdown enters edit mode
- save-time persistence still originates from `getCanonicalMarkdown()` rather than stale wrapper state
- exported table-widget markdown is normalized through the existing helper before save
- canonical persisted table-cell line breaks remain `<br />`
- trailing in-cell breaks are still stripped
- viewer mode still renders canonical breaks only inside table cells
- automated tests cover both seeded legacy input and real widget-authored line-break edits

## Production Implementation Scope

This work should ship as one production-ready implementation, not as a spike followed by later hardening. Do not land an intermediate state where tables render but command wiring, theming, canonicalization, or regression coverage are still incomplete.

Files:

- `frontend/package.json`
- `frontend/src/components/Editor/buildMarkdownAutocomplete.ts`
- `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`
- `frontend/src/components/Editor/buildMarkdownEditorTheme.ts`
- `frontend/src/components/Editor/buildMarkdownTableTheme.ts`
- `frontend/src/components/Viewer/MarkdownRichEditor.tsx`
- `frontend/src/theme/viewerStyles.ts`
- `frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx`
- `frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx`
- `frontend/e2e/markdown-viewer.spec.ts`

Required tasks:

1. Add `codemirror-markdown-tables` and wire `markdownTables({...})` into the markdown editor extension stack.

2. Replace the hard-coded insert-table stub with `insertEmptyMarkdownTable(...)` so toolbar insertion uses the same command path that production keyboard bindings will use.

3. Restructure markdown autocomplete so snippet completion and `markdownTableAutocompleter(...)` coexist without `override` suppressing language-data providers.

4. Configure the nested table cell editor completely in the same change:

   - `extensions`
   - `markdownConfig`
   - `globalKeyBindings`
   - `lineWrapping`
   - `handlePosition: "inside"`

5. Add the dedicated table-theme helper and pass production theme/style config into `markdownTables({...})` so the shipped table appearance already matches Sambee's existing editor/viewer styling in light and dark modes.

6. Keep the markdown line-break contract intact in the same implementation by validating and, if needed, adapting save-path normalization around table-widget edits.

7. Add automated regression coverage for:

   - toolbar table insertion
   - `|` table autocomplete
   - snippet autocomplete coexistence
   - nested-cell undo/redo and search behavior
   - `Shift+Enter` table-cell line breaks
   - save/reload canonicalization

8. Run focused manual validation in the demo route for desktop, narrow dialog, and mobile-width behavior before considering the work complete.

Production-readiness exit criteria:

- interactive tables are enabled in edit mode
- toolbar insertion, autocomplete, nested editing, and menus all work in the shipped build
- light and dark theme appearance are aligned with Sambee's existing markdown editor and viewer
- `handlePosition: "inside"` is usable without gutter hacks or clipping workarounds
- canonical `<br />` persistence remains correct after interactive table edits
- automated tests cover the new behaviors that are most likely to regress
- manual validation confirms the editor is usable at real host boundaries, not only in ideal desktop layouts

## Files Expected To Change

Primary implementation files:

- `frontend/package.json`
- `frontend/src/components/Editor/buildMarkdownAutocomplete.ts`
- `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts`
- `frontend/src/components/Editor/buildMarkdownEditorTheme.ts`
- `frontend/src/components/Viewer/MarkdownRichEditor.tsx`

Likely supporting files:

- `frontend/src/theme/viewerStyles.ts`
- `frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx`
- `frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx`
- `frontend/e2e/markdown-viewer.spec.ts`

Possible new helper files:

- `frontend/src/components/Editor/buildMarkdownTableTheme.ts`
- `frontend/src/components/Editor/markdownTableConfig.ts`

## Risks And Open Questions

## Pre-Implementation Risk Reduction

The following preparation work can and should be done before the full table-package integration lands. The goal is to remove uncertainty from the two most likely failure points while keeping behavior unchanged for users.

### De-risk Risk 1: Autocomplete composition

Preparation tasks:

1. Refactor the current autocomplete architecture before introducing the table package.

   Land the structural refactor described in section 6 first:

   - make `frontend/src/components/Editor/buildMarkdownAutocomplete.ts` export a UI-only `autocompletion(...)` extension
   - move markdown snippet completion ownership to a composable `CompletionSource`
   - make `frontend/src/components/Editor/buildMarkdownEditorExtensions.ts` own markdown autocomplete composition

   This can be done without `codemirror-markdown-tables` installed yet.

2. Prove language-data composition with a temporary test provider.

   Add a targeted test that mounts the markdown editor with:

   - the normal snippet completer
   - a temporary test-only `language.data.of({ autocomplete: ... })` provider that returns a sentinel completion

   The test should assert that:

   - snippet completion still works for word triggers
   - the sentinel language-data provider is reachable through the same autocomplete UI
   - no `override`-based configuration blocks the additional provider

   This reduces the integration risk without depending on the table package itself.

3. Remove the stale test expectation for the old `table` snippet as part of the prep refactor.

   `frontend/src/components/Editor/__tests__/SourceTextEditor.test.tsx` currently expects a `table` snippet to exist.

   Update that test during the autocomplete refactor so the codebase is already aligned with the future table-autocompleter ownership model before the package is added.

4. Treat the autocomplete refactor as a prerequisite, not a subtask discovered mid-implementation.

   The production table integration should begin only after these conditions are already true:

   - no markdown autocomplete path depends on `override`
   - markdown snippet completion is expressed as a composable source
   - a second `language.data` provider has already been proven to coexist in tests

Expected outcome:

- by the time `markdownTableAutocompleter(...)` is introduced, the only remaining work is swapping the temporary provider for the real package provider and adding table-specific assertions

### De-risk Risk 2: Search-state accounting while cell editors are active

Preparation tasks:

1. Extract the search-state logic in `frontend/src/components/Viewer/MarkdownRichEditor.tsx` into a testable helper module.

   Move the logic currently embodied by:

   - `updateSearchQuery(...)`
   - `countSearchMatches(...)`
   - the current root-view-based search accounting assumptions

   into a small helper file, for example:

   - `frontend/src/components/Viewer/markdownEditorSearch.ts`

   Keep the behavior unchanged. The purpose is to make the accounting logic directly testable before nested table editors are added.

2. Add direct tests for root-editor search accounting before the widget lands.

   Add focused tests that verify:

   - search match counting is derived from the root editor state
   - current-match tracking follows the root selection
   - `findNext` and `findPrevious` update reported search state consistently
   - an empty or cleared search query produces zero visible matches in the reported state

   These should not depend on the full markdown viewer harness unless the assertion truly requires viewer integration.

3. Create a search-state seam that does not assume the active DOM focus target is the same thing as the authoritative root selection.

   The implementation should already be written as though nested editors will exist. Concretely:

   - root search state must continue to read from the root CodeMirror view
   - helper APIs must accept the root `EditorView` or `SourceTextEditorHandle`
   - search accounting must not be rewritten later to inspect the focused DOM node directly

   This reduces the chance that nested table cells accidentally become the implicit search authority.

4. Add a test double for a nested-focus scenario, even before the real package is installed.

   The goal is not to fully simulate the table widget. The goal is to prove that search-state reporting in `MarkdownRichEditor` depends on the root editor view rather than on the currently focused descendant element.

   A sufficient prep test can:

   - mount the editor
   - set a search query in the root view
   - move focus to a descendant or non-root editable target in the test DOM
   - assert that reported search counts remain based on the root view state

5. Treat helper extraction and tests as a prerequisite to table-widget search validation.

   The production integration should not begin with search behavior still embedded only in the `MarkdownRichEditor` component body. Extracting and testing the search accounting first will make any later table-widget regression clearly attributable to the nested editor integration rather than to pre-existing opaque logic.

Expected outcome:

- by the time nested cell editors are introduced, the team already has a clear, tested definition of what root-editor search state means and how it is computed

1. Autocomplete composition

The current `override`-based completion setup is incompatible with the package's preferred language-data integration. This is the highest-confidence code change required before the table autocompleter can work correctly.

2. Search-state accounting while cell editors are active

The table widget uses nested editors. Sambee's current search-state reporting assumes a root-editor-centric selection model. This likely works, but it must be verified explicitly.

3. Table handle layout near editor edges

The package is opinionated about handle placement, and this repo already has evidence that edge controls are fragile. Layout should be validated before any CSS workaround is committed.

4. Canonical `<br />` persistence

The package documentation refers to inserting `<br>` for multi-line cell text. Sambee persists `<br />`. The normalization layer should absorb the difference, but that assumption needs coverage.

5. Mobile interaction inside the fullscreen viewer dialog

The package advertises mobile support, but Sambee's dialog, focus-restoration, and unsaved-changes flow are non-trivial. This needs manual verification, not only unit tests.

## Validation Plan

Automated validation:

- `cd /workspace/frontend && npm test -- MarkdownRichEditor`
- `cd /workspace/frontend && npm test -- MarkdownViewer`
- `cd /workspace/frontend && npm run lint`

Targeted manual validation:

- use `http://localhost:3000/browse/smb/demo`
- open a markdown file containing at least one table and one non-table section
- verify toolbar insert-table behavior
- verify `|` autocomplete on an empty line
- verify row/column handles, menus, drag operations, and append/remove controls
- verify undo/redo, find next/previous, and save/reload with focus inside a table cell
- verify `Shift+Enter` persists and re-renders as canonical table-cell line breaks

## Recommendation

Proceed with the integration.

The package is a strong fit for the current architecture because Sambee already has:

- a direct CodeMirror integration
- a reusable extension builder
- a command bridge from the viewer toolbar into the editor
- an existing markdown canonicalization layer that can absorb output-format differences

The only clear architectural adjustment required up front is the autocomplete restructuring. Everything else fits naturally into the current editor design.

## Review Remediation Plan

The current branch implements most of the planned integration, but the review found one correctness defect and two production-readiness gaps that still need root-cause fixes. Address them in the following order.

### 1. Implement a real nested-editor flush barrier before save

Problem:

- `MarkdownViewer.tsx` already treats `flushPendingEdits()` as the publication barrier before saving.
- `MarkdownRichEditor.tsx` currently implements that method as a no-op.
- That leaves a real risk that the root document export is stale while a table cell editor still owns the latest edit.

Root-cause fix:

1. Make `MarkdownRichEditor` explicitly track whether root markdown publication is pending.

   Add a small publication coordinator inside `frontend/src/components/Viewer/MarkdownRichEditor.tsx` that:

   - tracks whether a root-view update is still outstanding
   - stores a resolver for the next completed publication cycle
   - resolves immediately only when the current root document is already synchronized

2. Drive the coordinator from the actual editor update path rather than save-time polling.

   The authoritative signal should be the root editor update that reaches `SourceTextEditor.onUpdate` / `onChange`, not guessed timing.

   Implementation rule:

   - when an edit-producing command or nested table edit starts a publication cycle, mark publication as pending
   - when the root editor state reflects the latest markdown and `onChange`/`onUpdate` has run, resolve the pending flush promise

3. Implement `flushPendingEdits()` as a real awaitable barrier.

   In `frontend/src/components/Viewer/MarkdownRichEditor.tsx`:

   - if no publication is pending, resolve immediately
   - if publication is pending, await the stored promise until the latest root document state has been published

   Do not implement this with arbitrary `setTimeout()` delays or repeated save-time retries.

4. Keep `MarkdownViewer.tsx` as the save orchestrator.

   `frontend/src/components/Viewer/MarkdownViewer.tsx` should continue to:

   - call `await editorRef.current.flushPendingEdits()`
   - then call `getCanonicalMarkdown()`
   - then normalize with `normalizeMarkdownTableCellLineBreaks()`
   - then persist

   Do not move save orchestration into table-specific editor code.

Validation:

- add a unit or integration test that simulates a delayed publication cycle and proves save waits for the final root markdown state
- add a regression test that saves while focus remains inside a table cell and verifies the persisted markdown contains the last edit

Exit criteria:

- `flushPendingEdits()` in `MarkdownRichEditor.tsx` is no longer a no-op
- save cannot observe stale root markdown after a nested table-cell edit
- the save path still remains centralized in `MarkdownViewer.tsx`

### 2. Add real widget-authored table-cell line-break coverage

Problem:

- current tests prove seeded canonicalization and helper behavior
- they do not prove the integrated widget's own `Shift+Enter` editing path
- the most important persistence contract therefore still depends on assumption rather than evidence

Root-cause fix:

1. Add an integration-level test that drives the real table widget, not just seeded markdown.

   In `frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx` or a dedicated table integration test file:

   - load markdown containing a table
   - enter edit mode with the real `MarkdownRichEditor`
   - focus a real table cell editor
   - trigger `Shift+Enter`
   - enter a second line of text in the same cell
   - save
   - assert the persisted payload contains canonical `<br />`

2. Verify reload and viewer rendering in the same test slice.

   After save:

   - reopen or reload the file
   - assert the editor does not start dirty
   - assert viewer mode renders a visual line break only inside the table cell
   - assert non-table literal `<br />` text remains literal

3. Preserve helper-level coverage as the contract authority.

   Keep `frontend/src/components/Viewer/__tests__/markdownTableCellLineBreaks.test.tsx` focused on canonicalization semantics.
   Do not overload those tests with widget interaction.

4. Add the missing e2e scenario promised by the plan.

   Create `frontend/e2e/markdown-viewer.spec.ts` with one focused scenario that:

   - opens a markdown file with a table
   - enters edit mode
   - edits a real table cell into a multi-line value through widget interaction
   - saves
   - reloads or reopens
   - verifies viewer rendering and no false dirty state

Validation:

- run the new focused unit/integration test
- run the new Playwright scenario

Exit criteria:

- the branch proves widget-authored `Shift+Enter` output persists as canonical `<br />`
- reloads are clean
- viewer rendering stays table-cell-only

### 3. Validate search behavior with an actual active table cell editor

Problem:

- current helper tests prove root-view search accounting when focus moves elsewhere
- they do not prove behavior while a real nested table cell editor is active
- the branch therefore still lacks direct evidence for the exact scenario the plan highlighted

Root-cause fix:

1. Add an integration test that activates a real table cell editor and keeps search rooted in the root document.

   In `frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx` or a dedicated integration test file:

   - mount `MarkdownRichEditor` with a document containing repeated search text and a table
   - focus a real table cell editor inside the widget
   - set the root search query through the existing external search path
   - assert reported match count and current match still reflect the full root document

2. Prove next/previous navigation while a cell is active.

   The test should explicitly verify that:

   - `nextSearchResult()` advances the root match
   - `previousSearchResult()` reverses it
   - cell focus does not silently switch search authority to the nested editor buffer

3. Keep the helper-level tests as the non-widget baseline.

   `frontend/src/components/Viewer/__tests__/markdownEditorSearch.test.tsx` should remain the focused root-accounting contract.
   Add the widget-focused scenario in a separate integration test rather than bloating the helper tests.

Validation:

- add a regression test that fails if root search starts counting only the active cell contents

Exit criteria:

- search behavior is directly validated with a real active table cell editor
- root-document search remains authoritative under nested focus

### 4. Finish the production validation that the current branch still lacks

Problem:

- the branch has focused unit coverage and static validation
- it still lacks the e2e and manual validation steps explicitly required by the plan

Required completion work:

1. Keep the existing focused frontend checks:

   - `cd /workspace/frontend && npm test -- SourceTextEditor markdownEditorSearch markdownTableCellLineBreaks MarkdownRichEditor`
   - `cd /workspace/frontend && npm test -- MarkdownViewer`
   - `cd /workspace/frontend && npm run lint`

2. Add and run the new Playwright spec for real table editing.

3. Perform the planned manual validation in `http://localhost:3000/browse/smb/demo` for:

   - desktop-width fullscreen dialog
   - narrow dialog width
   - mobile-width layout
   - edge-aligned tables
   - row/column handles and menus with `handlePosition: "inside"`
   - save/reload while focus remains inside a table cell

4. Record any `inside`-handle usability failure as a concrete interaction defect.

   Do not mask it with gutter hacks or speculative CSS workarounds.

Exit criteria:

- unit, integration, and e2e coverage all exist for the most failure-prone table paths
- manual validation confirms the current implementation is usable at real host boundaries

## Remediation Order

Implement the fixes in this order:

1. real `flushPendingEdits()` publication barrier in `MarkdownRichEditor.tsx`
2. widget-authored `Shift+Enter` persistence test coverage
3. real nested-cell search integration coverage
4. Playwright scenario and manual validation pass

This order matters because the line-break and search tests should validate the real save/publication behavior, not a still-broken intermediary state.
