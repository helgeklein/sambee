# Markdown Table Cell Newline Implementation Plan

## Purpose

This document defines the implementation plan for adding in-cell newline support for markdown tables in a way that prioritizes correctness, stability, and long-term maintainability.

This began as a pre-implementation planning document. Proofs 1 through 6 have now been completed with small proof-driven code spikes, and the remaining sections describe the implementation work still required to finish the feature end to end.

Proof-complete does not mean feature-complete.

For this workstream:

- the proof documents are records of what critical seams were proven
- this implementation plan is the authoritative source for remaining coding work and release readiness

## Proof-Driven Status

- Proof 1 is complete: the supported representation strategy is proven, and canonicalization must happen at the mdast export boundary before raw pipe-table markdown is finalized.
- Proof 2 is now complete for focused line-break-bearing publication with continued typing, toolbar Save, `Ctrl+S`, and source-mode entry from the focused trailing-break state.
- Proof 3 is complete: save can use canonical editor export as the only trusted rich-text payload and fail closed if flush or export fails.
- Proof 4 is complete for the wrapper-owned flush/export path, including end-to-end source-mode entry after a focused trailing `Shift+Enter`.
- Proof 5 is complete: viewer rendering now converts canonical table-cell `<br />` tokens into actual visual breaks through a structural mdast transform without rewriting non-table content.
- Proof 6 is complete: loaded markdown now seeds viewer state, edit baseline, and rich-editor input from the same canonicalized content so untouched legacy table content stays pristine until a real user edit occurs.

## Requested Behavior

### Rich-text editing

- Inside a markdown table cell, `Shift+Enter` inserts an in-cell line break.
- Plain `Enter` must keep its existing table behavior.
- Arrow-key and tab navigation across table cells must continue to work as it does today.
- Editing a table cell with line breaks must not depend on switching view modes or losing focus.
- Table-cell edits must be reflected in change tracking while the caret is still inside the cell.
- Unsaved-change detection must not wait for the caret to leave the cell.
- Non-trailing in-cell line breaks must behave predictably during normal editing operations, including:
  - inserting multiple consecutive breaks
  - deleting adjacent breaks
  - moving the caret across breaks
  - undoing and redoing break edits

### Persistence

- Stored markdown should use one canonical representation for supported in-cell line breaks inside table cells: `<br />`.
- Legacy `<br>`, `<br/>`, and supported numeric newline entities inside table cells should normalize to `<br />` before save.
- If the editor serializes an in-cell line break as a literal newline or html-safe newline entity, that representation must normalize to `<br />` at the canonical markdown boundary.
- Saving while the caret is still inside an actively edited table cell must persist the latest in-cell content, not the pre-focus draft value.
- Trailing in-cell line breaks are unsupported and must be stripped consistently during canonicalization.
- Literal `<br />` text outside markdown table cells must remain literal text.
- Valid markdown table content must not be corrupted during normalization, including:
  - escaped pipes
  - inline code
  - emphasis
  - links

### Viewer rendering

- `<br />` inside markdown table cells should render as an actual visual line break.
- Literal `<br />` text outside table cells should remain visible as literal markdown content.
- Rendering should be scoped structurally to table cells, not inferred from raw string patterns.

### Source mode transitions

- Switching from rich-text mode to source mode while focus remains inside a table cell must show canonical `<br />` tags, not literal newline characters or encoded newline entities.
- Source mode must be fed from flushed, normalized markdown after any focused nested cell has been published into the parent editor.
- Source mode must not expose trailing in-cell line breaks as persisted `<br />` tags.

## Current State

### Rich-text editor behavior

Current markdown rich-text editing is centered in:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Current relevant behavior:

- Nested table-cell keyboard handling already exists for navigation.
- The editor already bridges nested table cells into the main editor flow.
- The current editor handle now exposes focus and selection helpers plus `flushPendingEdits()` and `getCanonicalMarkdown()`.
- `getCanonicalMarkdown()` now runs the editor's authoritative exported markdown through the shared table-cell canonicalization utility.
- Focused nested table-cell edits now schedule coalesced publication into the outer markdown draft while the nested cell retains focus.
- Dirty-state comparison no longer has to wait for nested-editor blur before seeing those publication-driven updates.
- Mode transitions out of rich-text now canonicalize markdown before source-mode entry commits for the covered paths, including the focused trailing-break case.
- Real-browser validation now shows that the earlier focused-publication crash was app-owned rather than an unavoidable upstream failure.
- The nested bridge now avoids requesting outward publication from nested `beforeinput`, which removes the `Lexical node does not exist in active editor state` crash after `Shift+Enter` plus continued typing.
- `flushPendingEdits()` now returns immediately when no nested publication work is already pending instead of manufacturing a fresh nested-publication request during save or source-mode entry.
- `Ctrl+S` now reaches the same save path as the toolbar action from focused nested table-cell editing.
- Wrapper regression coverage now directly protects the critical queue behavior:
  - nested `beforeinput` does not trigger outward publication
  - an edit landing during an in-flight publication retriggers and publishes the latest markdown
- Browser end-to-end coverage now passes for single-break save, consecutive-break save, and source-mode entry after a trailing `Shift+Enter`.
- Browser end-to-end coverage now also passes for a representative delete-across-break sequence, representative caret-motion sequences across both the first and final internal break boundaries, undo/redo before save, and reload plus viewer rendering after a consecutive-break save.
- Mobile sanity coverage now also passes for both the trailing-break and continued-typing source-mode paths through the More actions flow.
- Source-mode entry after `Shift+Enter` plus continued typing now preserves canonical `<br />` output before save on both desktop and mobile.
- The source-mode fix explicitly dispatches nested editor synchronization before the wrapper reads canonical markdown, because the failing continued-typing path did not reliably surface nested publication work through DOM `input` events alone.
- The dedicated performance proof now measures real user-visible timings, and those timings currently exceed the provisional publication/flush targets for parts of the covered burst-edit scenarios.
- `Shift+Enter` should still not be treated as fully exhaustive yet: the remaining work is now any remaining adjacent-break caret-motion variants and the measured performance follow-up.

Observed package behavior:

- The installed editor package uses first-class Lexical line-break nodes in nested table-cell editors.
- Nested table-cell editors are standard nested Lexical rich-text editors with history support.
- The editor package imports mdast `break` nodes into Lexical line-break nodes.
- The editor package exports Lexical line-break nodes back out as literal `\n` text in markdown serialization.
- This means ordinary in-cell newline editing is editor-native, but table-cell-specific post-serialization canonicalization is required.

### Viewer rendering behavior

Current markdown viewing is centered in:

- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)

Current relevant behavior:

- Markdown rendering uses `react-markdown` with `remark-gfm`.
- Table rendering already passes through `react-markdown` table nodes.
- The viewer now applies a structural remark transform that converts canonical `<br />` html nodes into rendered line breaks only inside `tableCell` nodes.
- Literal `<br />` content outside markdown tables remains literal viewer text.

### Save flow

Current markdown save flow is centered in:

- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)

Current relevant behavior:

- Save now prefers the live rich editor when an editor instance is present: it awaits `flushPendingEdits()` and then reads `getCanonicalMarkdown()` before persisting.
- Save no longer falls back to outer `draftContent` while live rich-text editor state exists.
- This removes the stale-save risk proven in Proof 3 and makes save fail closed if flush or canonical export fails.
- The save path now runs through the production table-cell canonicalization utility, so the persisted payload is both trusted and normalized.
- Source-mode entry now routes through an explicit wrapper-owned transition helper that awaits pending nested publication, canonicalizes markdown, reseeds the editor markdown state, and only then commits source mode.

### Trailing break behavior

Current relevant behavior:

- Trailing in-cell line breaks are a special case because browser editing surfaces often do not visibly render them in a stable way.
- Prior experiments with invisible placeholders or non-editable sentinels to force rendering have not been robust.
- Those approaches risk contaminating selection behavior, editing semantics, and persisted content.

### Empty internal line blocker

Problem statement:

- One blocker remains for otherwise-supported non-trailing in-cell breaks: an empty internal line between two populated lines in a loaded table cell.
- Canonical markdown such as `line 1<br /><br />line 3` imports into the nested table-cell editor as adjacent line-break nodes.
- When the caret is placed on the visually empty middle line and the user types, the browser/editor stack can treat the insertion point as a fragile gap between adjacent break nodes rather than as a stable editable line.
- The observed failure mode is not just cosmetic: caret behavior becomes confusing, the live edit topology is wrong before save, and persisted markdown can gain an extra break around the inserted character after save and reopen.
- This is the last known functional blocker in the feature workstream; save, source-mode transitions, viewer rendering, and non-empty in-cell break handling are otherwise on the now-stable path.

Tried and discarded potential solutions:

- Editor-only hidden placeholder characters inserted into the empty line.
- Invisible placeholder or sentinel nodes added only to make the empty line addressable.
- DOM-level `beforeinput` interception that manually inserts text around the adjacent-break boundary.
- Other fixes that depend on hidden editing-surface artifacts rather than the editor's own line-break model.
- A nested Lexical command/plugin fix scoped to table-cell editors that handles adjacent line-break selections at the editor-model layer.

Reasons these approaches are discarded:

- Hidden placeholder content creates extra logical caret stops, so users must sometimes arrow through an apparently empty line more than once.
- Placeholder or sentinel approaches violate the design goal of relying on built-in rich-text line-break semantics instead of simulated editing artifacts.
- DOM-level insertion repair treats the browser symptom after selection has already fallen into an unstable topology, which is brittle and hard to reason about across typing, composition, deletion, and caret movement.
- These approaches introduce confusing editing semantics even when persistence is repaired, so they do not meet the correctness bar for this feature.

Remaining potential solutions:

- An upstream MDXEditor / Lexical table-cell fix, or a locally carried package patch, if the root cause is best addressed inside the package's own nested table editor.
- A model-level selection-normalization strategy that keeps caret movement and text insertion on stable editor positions without adding hidden content, if that can be proven not to distort arrow, delete, or undo semantics.
- A package-version audit to determine whether a newer MDXEditor or Lexical release already fixes the adjacent-break topology, provided any upgrade is validated against the same repro and regression suite.

#### Viability evaluation and proofing plan for an upstream MDXEditor / Lexical fix or local package patch

Current viability assessment:

- This is currently the strongest remaining path.
- The wrapper-level prototype already showed that the failing insertion point is real, but that the application layer does not cleanly own it.
- The failure shape sits inside the nested table-cell editor's own selection and insertion model, which makes a package-level fix more plausible than more wrapper-side interception.
- A pure Lexical-only version bump is not currently a strong standalone remedy: the installed and latest published `@mdxeditor/editor` package still declares the Lexical family at `^0.35.0`, while newer Lexical releases have moved well beyond that line.

What this path must prove:

- The nested table-cell editor can expose a stable insertion position for a loaded empty internal line without hidden content.
- Typing on that line must be handled by one authoritative editor path, not by competing wrapper and default insertions.
- The resulting nested markdown must still serialize back through the existing canonical `<br />` pipeline without any special-case save or source-mode repair.

Execution update on 2026-06-27:

- A focused package-level probe patched MDXEditor's `MdastHTMLVisitor` so imported `<br>` nodes entered the editor as Lexical `LineBreakNode`s instead of `GenericHTMLNode("br")`.
- That probe did not fix the user-visible bug. The focused save repro still persisted `A1<br /><br />s<br />A3` instead of the desired `A1<br />s<br />A3`.
- This means an import-layer `br` remap by itself is insufficient; the remaining failure is deeper than the first HTML-to-line-break conversion step.
- The package flow is now traced more precisely:
  - canonical table-cell `<br />` parses into `mdxJsxTextElement("br")` nodes, not mdast `break` nodes
  - MDXEditor imports those nodes through `MdastHTMLVisitor`, which currently creates `GenericHTMLNode("br")`
  - freshly typed `Shift+Enter` breaks therefore use a different internal node shape from loaded canonical `<br />` breaks
  - Lexical text insertion then resolves the collapsed empty-line caret from an element-style selection rather than from an ordinary text point
- The likely clean patch target is therefore not save/export. It is the loaded table-cell break model plus the collapsed-caret normalization that runs before default text insertion.
- A separate hardening issue also exists in the application wrapper: `MarkdownDecoratorArrowNavigationBridge` currently assumes every range-selection anchor has a valid top-level element, which is not always true during these adjacent-break states.
- A standalone MDXEditor table-cell harness now reproduces the bug outside the application wrapper and captures the exact pre-insertion selection state.
  - Typing into loaded `A1<br /><br />A3` from the visual empty middle line still exports malformed package markdown: `A1<br /><br>s</br>A3`.
  - Immediately before insertion, the nested editor's collapsed selection sits on the second imported `generic-html` break node with an element-point selection (`key=16`, `type=element`, `offset=0`).
  - At the same moment, the DOM selection is `P` offset `2`, which corresponds to the boundary between the two adjacent imported break nodes.
  - This proves the failure is package-owned and specifically tied to adjacent imported break nodes being treated as editable insertion anchors.

Recommended execution order:

1. Confirm whether the bug reproduces in the smallest possible package-owned table-cell harness, outside the application wrapper.
2. Inspect the package path that maps adjacent imported breaks into nested editor nodes and handles collapsed text insertion at that boundary.
3. Determine whether the fix belongs in MDXEditor table-cell integration code, in its break import/export layer, or in the underlying Lexical selection/insertion path.
4. If a targeted package patch is found, carry it locally first and prove it against the existing application repro and regression suite before considering any upstreaming or package upgrade decision.

Proof harnesses:

- A package-level reproducible harness using the real nested table-cell editor path with loaded `line 1<br /><br />line 3` content.
- The existing browser-level application repro, kept unchanged as the user-visible acceptance check.
- Focused serialization checks proving that the package fix does not bypass or dilute the existing canonicalization boundary.

Required proof cases:

- Typing on the loaded empty middle line produces exactly `line 1<br />s<br />line 3` after save and reopen.
- Left and right arrow movement traverses the empty line in one visual step per keypress.
- Backspace and delete at both boundaries do not create duplicate breaks, skip deletions, or collapse the wrong line.
- Undo and redo remain coherent across the first insertion into the formerly empty line.
- Source-mode entry from the focused edited cell still yields canonical `<br />` output with no extra repair path.
- Dirty tracking still updates while focus remains inside the nested cell.

Implementation constraints:

- Do not add placeholders, sentinel nodes, or editor-only hidden content.
- Do not accept a fix that only appears correct after blur, save, or mode switching.
- Do not take a package change that requires unsupported version skew between `@mdxeditor/editor` and the Lexical package family.

Pass criteria:

- The package-level harness and the application-level browser repro both pass with the same fix.
- The fix eliminates duplicate insertion ownership at the adjacent-break boundary.
- Existing passing table-cell newline coverage remains green, especially consecutive breaks, delete across breaks, undo/redo, save, reload, and source-mode entry.
- The saved payload remains canonical and does not require any new downstream normalization rule beyond the current table-cell canonicalization utility.

Failure conditions:

- The bug cannot be reproduced or fixed inside the package-owned table-cell path without application-only interception.
- The fix depends on hidden editing artifacts or creates extra caret stops.
- The fix requires unvalidated cross-version mixing of MDXEditor and newer Lexical packages.
- The fix resolves typing but regresses navigation, deletion, history, or canonical serialization.

Decision rule:

- Prefer this path if the package-level harness reproduces the bug and a targeted patch makes both the harness and the unchanged browser repro pass.
- Prefer a coordinated package upgrade only if the exact repro is shown to be fixed by a supported MDXEditor-plus-Lexical version set.
- Deprioritize further wrapper-side work if the package harness confirms that the insertion ownership problem is internal to the nested table editor.

#### Viability findings for the nested Lexical command/plugin approach

What was proved:

- The focused browser repro still fails on the current implementation: loading `line 1<br /><br />line 3`, typing `s` on the empty middle line, and saving persists the wrong topology.
- In the real nested table-cell DOM, the loaded empty line materializes as `<span>A1</span><br><br><span>A3</span>`.
- At that visual caret position, Lexical does not expose an ordinary text insertion point; the collapsed selection resolves onto the second `br` fallback node, represented as a `generic-html` node.

Prototype outcome:

- A narrow table-cell-scoped command/plugin prototype was able to identify the adjacent-break node and mutate near it.
- That prototype did not gain exclusive ownership of the keystroke. The default editor path still inserted text as well, producing duplicated content (`A1<br />s<br />s<br />A3`).
- This means the wrapper-level command seam can see the problem, but does not currently provide a clean local fix for it.

Conclusion:

- The local nested command/plugin approach is not proven viable in its current wrapper-level form.
- It is not fully ruled out, but it appears to require deeper ownership of the table-cell insertion path than the wrapper can currently provide without fighting the default editor behavior.
- Treat further local wrapper/plugin work on this path as lower priority than an upstream MDXEditor / Lexical table-cell patch or a coordinated package-upgrade investigation.

Constraints on the remaining solutions:

- Do not add hidden placeholders or non-editable sentinels to the editing surface.
- Do not rely on source-mode switches, blur, save, or other incidental UI transitions to repair the live editor model.
- Any accepted fix must preserve ordinary arrow-key behavior, including one-step movement through a visually empty internal line.
- Any accepted fix must preserve canonical `<br />` persistence and must not widen the supported scope to trailing in-cell breaks.

## Design Goals

- Preserve valid markdown semantics while adding in-cell newline support.
- Avoid source-string heuristics that can corrupt table content.
- Keep newline behavior scoped to markdown table cells only.
- Use a single canonical persisted representation.
- Avoid view-mode-driven normalization or focus-driven repair logic.
- Keep the design local to markdown editor and viewer surfaces.
- Ensure nested table-cell edits become visible to dirty tracking without requiring blur.
- Ensure save behavior is deterministic even with nested editor state.
- Prefer built-in rich-text line-break semantics for ordinary in-cell editing rather than any placeholder-based rendering trick.
- Do not support trailing in-cell breaks.
- Make the behavior easy to test at unit and end-to-end levels.

## Design Decisions

### 1. Use AST-based normalization instead of raw markdown string rewriting

Normalization must operate on parsed markdown structure, not on line-based string splitting or regex-based row parsing.

Reasoning:

- Raw string manipulation is unsafe for valid markdown table content such as escaped pipes and inline code.
- AST-level handling lets the implementation target `tableCell` nodes directly.
- This sharply reduces the risk of data corruption.

### 2. Use `<br />` as the only canonical stored representation inside table cells

All supported in-cell line-break variants inside table cells should normalize to `<br />` before persistence.

Reasoning:

- One stored form simplifies save behavior, rendering behavior, and tests.
- Canonicalization should happen at semantic boundaries, not opportunistically during UI lifecycle events.

Trailing-break policy:

- Strip trailing in-cell breaks during canonicalization.

Reasoning:

- The browser/editor rendering problem for trailing breaks is materially different from internal breaks.
- Placeholder or invisible-sentinel approaches risk contaminating editing semantics, selection behavior, and saved content.
- Stripping trailing breaks is safer and more honest than pretending to support them unreliably.

### 3. Keep editor insertion behavior local to nested table cells

`Shift+Enter` should be handled only when the active nested editor is a table-cell editor.

Reasoning:

- The requested behavior is table-specific.
- Plain `Enter` behavior must remain owned by the existing table/editor plugin.
- This minimizes the risk of regressions outside table editing.

Editor capability note:

- The installed editor package uses Lexical line-break nodes in nested table-cell editors and a standard rich-text plugin plus history plugin.
- That is a good foundation for ordinary in-cell newline editing, including multiple consecutive non-trailing breaks and normal caret movement.
- We should rely on those built-in editing semantics rather than simulate line breaks with custom DOM artifacts.

### 4. Normalize at serialization boundaries, not on incidental UI transitions

Markdown should be normalized:

- when server content enters the markdown editor or viewer pipeline
- when editor content is exported for save
- when rich-text table content is serialized for another consumer such as source mode
- when nested cell content is published into the outer markdown draft

Markdown should not be normalized during focus restoration, toolbar mode changes, or other incidental UI transitions.

Reasoning:

- UI lifecycle hooks are the wrong place for semantic document repair.
- Boundary normalization is easier to reason about and validate.
- Source-mode transitions are a serialization boundary, not merely a UI presentation change, and should therefore use the same canonicalization path as save.

Operational note:

- Run the same normalization utility on viewer loads so rendered table content reflects canonical interpretation without writing changes back to storage.

Byte-ownership rule:

- canonicalized in-memory markdown may be used for viewer, rich-editor, source-mode, and draft-state behavior before save
- original server bytes must still be preserved for document download until the user saves canonicalized content
- any future consumer that depends on original bytes must opt into that contract explicitly rather than reusing canonicalized in-memory state by default

### 5. Use structural viewer rendering for table-cell line breaks

Viewer rendering should translate canonical table-cell `<br />` tokens into actual line breaks only within markdown table cells.

Reasoning:

- Viewer behavior should follow markdown structure, not recursive React child rewriting.
- This prevents accidental rewriting of inline code or other nested content.

### 6. Add an explicit canonical export path from the rich editor

The rich editor should expose an imperative method that returns canonical markdown for persistence, along with an explicit way to flush pending nested edits.

Reasoning:

- Save correctness should not depend solely on outer React state.
- Nested table-cell edits may lag the outer draft value without an explicit flush/export contract.

### 7. Publish nested table-cell edits while the cell remains focused

Nested table-cell edits should be bridged into the parent editor as soon as the nested cell becomes dirty, using editor-native update listeners and the editor package's nested-editor synchronization command.

Reasoning:

- Dirty tracking should reflect the user's actual edit state, not whether focus has left the cell.
- Save should not depend on blur events or DOM extraction hacks.
- The editor package already provides a nested-editor synchronization primitive, which is more stable than inventing a parallel commit mechanism.

### 8. Use one canonical post-serialization normalization path for all rich-text exits

Any time rich-text table content is leaving the nested editor world and becoming serialized markdown for another consumer, it should pass through the same AST-based canonicalization path.

This includes at minimum:

- leaving a table cell and publishing to the outer markdown draft
- saving while still focused inside a table cell
- switching from rich-text mode to source mode while still focused inside a table cell

Reasoning:

- These are all the same class of problem: nested rich-text state becoming serialized markdown.
- A single post-serialization normalization path prevents drift between save, dirty tracking, and source-mode behavior.
- This is more future-proof than ad hoc fixes for individual UI events.

Trailing-break rule:

- The same normalization path must also be where unsupported trailing in-cell breaks are stripped, so blur, save, and source-mode transitions cannot disagree.

## Proposed Architecture Changes

## Workstream 1: Table-cell line-break markdown utility

### Objective

Add a narrow markdown utility that parses markdown, visits table cells only, and normalizes in-cell line breaks structurally.

### Changes

Create a new utility module for markdown table-cell line-break normalization.

Likely files:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)
- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- new utility module under [frontend/src/components/Viewer](../frontend/src/components/Viewer)

Recommended implementation shape:

- `normalizeMarkdownTableCellLineBreaks(markdown: string): string`
- internal AST traversal scoped to `tableCell` nodes
- canonical conversion of supported line-break variants inside table cells only
- explicit stripping of trailing line-break sequences in table cells

Recommended usage contract:

- Treat this utility as the only supported normalization entry point for serialized markdown coming from rich-text table editing.
- Call it after nested cell publication has updated the parent editor state, not against raw DOM text or raw nested-editor text nodes.
- Use the same utility when seeding edit-mode baseline and draft state from loaded markdown so dirty tracking starts from canonical content.

Recommended dependency additions:

- `remark-parse`
- `remark-gfm` or the equivalent GFM parser/stringifier extensions required for markdown table nodes
- `remark-stringify`
- `unist-util-visit`
- optionally `mdast-util-to-string` only if needed for narrow inspections

### Deliverables

- A parser-based normalization utility.
- Canonical `<br />` persistence behavior limited to table cells.
- Consistent stripping of trailing in-cell breaks.
- No line-based `split("|")` parsing.

## Workstream 2: Rich-text editor insertion, live publication, export, and mode-transition flushing

### Objective

Add table-cell `Shift+Enter` support in the editor, publish nested cell edits while focused, and expose reliable canonical export and mode-transition flushing paths.

Status note:

- The `flushPendingEdits()` plus `getCanonicalMarkdown()` contract is proven and landed.
- Source-mode transitions now route through that same canonical export path.
- Focused nested-publication updates now use the same canonical table-cell normalization path as save and source-mode transitions.
- Real-browser validation resolved the previously blocking app-owned failure modes in the current `Shift+Enter` path:
  - nested publication no longer crashes after `Shift+Enter` plus continued typing
  - immediate toolbar Save no longer hangs from the focused trailing-break state
  - `Ctrl+S` now reaches the same save path from focused nested table-cell editing
- Remaining work in this stream is to validate the harder editing semantics and end-to-end behavior on top of the now-stable save/source-mode path.
- The one remaining functional blocker is empty internal table-cell lines loaded as adjacent line-break nodes.
- In practice, the failing repro is: load a table cell whose canonical content is `line 1<br /><br />line 3`, move the caret onto the visually empty middle line, type a character, and save.
- In the failing state, the browser/editor stack misroutes the insertion at the adjacent-break boundary, caret behavior becomes unstable, and the saved markdown can acquire an extra break around the inserted text.
- Remaining work in this stream is therefore specifically the empty-internal-line / adjacent-break editing bug and any measured performance follow-up on top of the now-stable save/source-mode path.

### Changes

Extend the nested table-cell bridge and the editor imperative handle.

Likely files:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Recommended behavior:

- Intercept `Shift+Enter` only for nested table-cell editors.
- Insert a Lexical line-break node in the nested table-cell editor.
- Do not intercept plain `Enter`.
- Do not introduce `Alt+Enter` special handling unless a concrete upstream issue requires it.
- Register a nested-editor update listener for each table-cell editor child.
- On dirty nested cell updates, mark the edit session dirty immediately.
- Coalesce nested publication work so repeated keystrokes do not trigger redundant parent exports on every synchronous mutation.
- Use a single pending microtask for that coalescing so publication remains deterministically awaitable before save and source-mode transitions.
- Use the editor package's `NESTED_EDITOR_UPDATED_COMMAND` to publish the focused nested cell into the parent editor without requiring blur.
- Track one coalesced pending-publication promise in the rich editor so callers can await completion deterministically.
- Add `flushPendingEdits(): Promise<void>` to the editor handle.
- Add `getCanonicalMarkdown(): string` to the editor handle.
- Make `flushPendingEdits()` proactively publish the active nested cell if one is focused and a publication is still pending.
- Add a pre-source-mode transition path that awaits `flushPendingEdits()`, reads canonical markdown, and updates the editor markdown state before switching to source mode.
- Source mode should receive canonical `<br />` output whenever that explicit flush-and-export path succeeds.
- Preserve selection and scroll state across that async source-mode transition when possible, and restore appropriate editor focus on both success and failure paths.
- Avoid relying on post-switch repair hooks for source mode.
- Ensure `getCanonicalMarkdown()` runs markdown export through the AST-based normalization utility before returning.
- Normalize safe-to-detect legacy `<br>` variants independently of case, including standard self-closing forms.
- Normalize numeric HTML character references for the newline character in table cells in addition to literal serialized newlines, including decimal `&#10;` and hexadecimal `&#xA;` forms, ignoring hex-digit case and leading zeros.
- Ensure live outer-draft updates produced from nested publication also pass through the same normalization utility so dirty tracking sees canonical content.
- Do not add hidden DOM placeholders or non-editable sentinel nodes to force trailing-break rendering inside the nested editor.

### Deliverables

- Stable `Shift+Enter` table-cell behavior.
- Live draft updates and unsaved-change detection while the caret remains inside a table cell.
- No view-mode-dependent newline repair.
- Canonical `<br />` source-mode content when switching modes from a focused table cell.
- Reliance on built-in nested editor line-break semantics for ordinary editing scenarios.
- No fake trailing-break rendering artifacts inside the editor.
- Explicit canonical export and flush support for save.

## Workstream 3: Save flow hardening

### Objective

Ensure saves always persist the latest canonical editor markdown, including pending nested cell edits.

Status note:

- The core save contract is already proven and minimally landed: save now awaits `flushPendingEdits()` and uses `getCanonicalMarkdown()` instead of trusting outer draft state.
- That save path now runs through the production table-cell normalization utility, and baseline initialization now aligns viewer state with the same canonical content.

### Changes

Update the markdown viewer save path to use the explicit editor export contract.

Likely files:

- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)

Recommended behavior:

- Before save, call `await editorRef.current?.flushPendingEdits()` when editing.
- Read `editorRef.current?.getCanonicalMarkdown()` as the preferred save payload.
- Do not fall back to `draftContent` while a live rich-text editor instance exists.
- Treat canonical rich-editor export as the only valid save payload in rich-text mode.
- If flush or canonical export fails, fail closed: block the save, surface an actionable error, and preserve the current edit session state.
- Update the post-save baseline using the canonical saved content.
- Ensure this save path works even when the active selection is still inside a nested table cell.
- Use the same canonicalization path for persisted markdown that source-mode transitions use.
- Ensure the saved payload strips trailing in-cell breaks consistently.
- Seed edit-mode baseline and draft state from the same canonicalized loaded markdown so the first nested publication does not create a false dirty state.

### Deliverables

- Deterministic save behavior.
- No loss of pending nested table-cell edits.
- No stale save payloads when saving directly from an actively focused table cell.
- One canonical persisted markdown path.

## Workstream 4: Viewer rendering plugin

### Objective

Render canonical `<br />` tokens as visual line breaks only inside markdown table cells.

Status note:

- This workstream is now proven and minimally landed in the viewer.
- No remaining rendering-scope proof work is open for the table-cell-only transform itself.

### Changes

Add a remark-side transform for viewer rendering rather than recursive DOM-child rewriting.

Likely files:

- [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- new utility module under [frontend/src/components/Viewer](../frontend/src/components/Viewer)

Recommended behavior:

- Parse markdown with `remark-gfm`.
- Transform only `tableCell` node contents.
- Convert canonical `<br />` html nodes inside table cells into mdast break nodes for rendering.
- Leave non-table `<br />` text/html untouched.

### Deliverables

- Table-cell-only visual line breaks in the viewer.
- No unintended rewriting of non-table markdown.
- Safer handling of nested inline content inside cells.

## Workstream 5: Source-mode transition hardening

### Objective

Ensure switching from rich-text mode to source mode always uses flushed, canonical table-cell markdown.

Status note:

- This workstream is now proven and minimally landed in the wrapper.
- Remaining related work, if any, now lives outside the proof gates already completed here; source-mode entry itself no longer depends on passive post-switch repair.

### Changes

Move source-mode entry behind an explicit transition helper instead of relying only on passive post-change observers.

Likely files:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Recommended behavior:

- Intercept the source-mode toggle action before `viewMode$` is changed.
- Await `flushPendingEdits()`.
- Read canonical markdown via `getCanonicalMarkdown()`.
- Push canonical markdown back through the editor's markdown setter so the source editor receives normalized content.
- Only then switch the editor into source mode.
- If flush or canonical export fails, fail closed: keep the editor in rich-text mode, preserve selection if possible, and surface an actionable error.
- Keep post-switch focus restoration separate from content canonicalization.

Design note:

- The installed editor package already dispatches `NESTED_EDITOR_UPDATED_COMMAND` when leaving rich-text mode.
- That is useful for synchronization, but it is not by itself a guarantee that source mode will receive canonical `<br />` tags.
- Canonicalization still needs to occur at the serialized-markdown boundary before source mode consumes the markdown state.

### Deliverables

- Canonical source-mode markdown after switching from a focused table cell.
- No duplicated newline-normalization logic between save and source-mode entry.
- Clear separation between synchronization, canonicalization, and focus restoration.

## Testing Plan

### Unit tests

Add unit tests for the normalization utility covering:

- `<br>`, `<br/>`, and `<br />` in table cells
- numeric newline character references in table cells, including decimal and hexadecimal forms with case-insensitive hex digits and leading zeros
- literal newline serialization inside table cells
- escaped pipes in table cells
- inline code containing `|` in table cells
- emphasis and links around line breaks
- literal `<br />` text outside tables
- multiple consecutive internal line breaks in table cells
- stripping of trailing line-break sequences in table cells
- canonicalization of loaded markdown used to seed edit-mode baseline and draft state

### Editor tests

Extend editor tests covering:

- `Shift+Enter` inserts a line-break node in nested table cells
- plain `Enter` is not intercepted
- table navigation still works after adding the new key handling
- editing inside a focused table cell updates dirty-state without leaving the cell
- nested table-cell updates publish into the outer markdown draft while focus remains in the cell
- nested table-cell updates publish safely after the nested editor contains one line-break node
- nested table-cell updates publish safely after the nested editor contains multiple internal line-break nodes
- nested `beforeinput` does not trigger outward publication
- in-flight publication retriggers still publish the latest nested markdown
- transient trailing-break states after `Shift+Enter` are either safely deferred or fail closed without crashing
- canonical export returns normalized markdown
- save-related flush behavior includes nested cell edits
- saving from a still-focused table cell persists the latest in-cell content
- switching to source mode from a still-focused table cell shows canonical `<br />` tags
- source-mode entry normalizes newline entities or literal serialized newlines from table-cell edits into `<br />`
- multiple consecutive non-trailing line breaks can be inserted and then deleted correctly
- caret motion and deletion across adjacent line breaks behaves consistently
- undo and redo work across table-cell line-break edits
- trailing line breaks are stripped rather than preserved

Likely files:

- [frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx)

### Viewer tests

Extend viewer tests covering:

- `<br />` renders as a visual break only inside table cells
- literal `<br />` remains literal outside tables
- inline code in a table cell is not rewritten into actual DOM breaks
- mixed nested inline formatting inside table cells remains intact

Likely files:

- [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)

### End-to-end tests

Add or extend Playwright coverage for:

- entering edit mode on a markdown file with a table
- inserting a table-cell line break with `Shift+Enter`
- confirming `Shift+Enter` does not move focus into another table cell or trigger plain-Enter table navigation
- editing a table cell and observing save enablement before leaving the cell
- inserting a line break, continuing to type in the same cell, and confirming the first outward publication is stable
- saving while the caret is still inside the edited cell
- switching to source mode while the caret remains inside the edited table cell
- inserting multiple consecutive internal breaks and saving canonical `<br /><br />` output
- deleting across an internal break and saving the joined canonical cell content
- moving left and back right across the final internal break and saving the expected canonical insertion position
- moving left across the first internal break and saving the expected canonical insertion position
- undoing and redoing nested break edits before save
- saving and reopening the file
- confirming persisted markdown contains canonical `<br />`
- confirming source mode shows canonical `<br />` rather than newline entities or literal line breaks for table-cell content
- confirming trailing line breaks are not persisted
- confirming multiple consecutive internal line breaks survive save and reload
- confirming the viewer renders the saved break correctly
- confirming no unwanted normalization occurs outside the table

Likely files:

- [frontend/e2e/markdown-viewer.spec.ts](../frontend/e2e/markdown-viewer.spec.ts)

## Validation Commands

Recommended validation sequence after implementation:

1. `cd frontend && npx vitest run src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx src/components/Viewer/__tests__/MarkdownViewer.test.tsx`
2. `cd frontend && npm run test:e2e:markdown`
3. `cd frontend && npm run lint`
4. `cd frontend && npx tsc --noEmit`

## Risks and Mitigations

### Risk: AST serialization changes unrelated markdown formatting

Mitigation:

- Keep normalization scoped to narrow table-cell cases.
- Snapshot representative markdown fixtures before and after normalization.
- Prefer surgical AST edits over broad document rewrites.

### Risk: Nested editor updates race with save

Mitigation:

- Add explicit `flushPendingEdits()` before save.
- Maintain one coalesced pending-publication promise for nested table-cell commits.
- Do not permit save-time fallback to outer draft state while rich-text editor state is live.
- Validate save behavior with unit and end-to-end tests.

### Risk: Source mode reads stale or non-canonical markdown during mode switch

Mitigation:

- Treat source-mode entry as a flush-and-canonicalize boundary.
- Route source-mode entry through the same canonical export path used by save.
- Fail closed if flush or canonical export cannot complete.
- Add focused tests that switch modes while the caret is still inside the edited table cell.

### Risk: Legacy table content appears dirty immediately after entering edit mode

Mitigation:

- Canonicalize loaded markdown before seeding edit-mode baseline and draft state.
- Ensure the rich editor and dirty-tracking baseline are initialized from the same canonical content.
- Add focused tests that open legacy `<br>` and numeric newline variants without triggering a false dirty state.

### Risk: Live nested publication causes excessive parent-editor churn

Mitigation:

- Coalesce nested publication through a single pending microtask instead of synchronizing on every low-level mutation.
- Only react to nested updates when `dirtyElements` or `dirtyLeaves` indicate a real content change.
- Keep the publication bridge scoped to table-cell nested editors only.

### Risk: Viewer plugin mishandles nested inline content

Mitigation:

- Transform at the markdown AST layer, not the rendered React-child layer.
- Add tests for inline code, emphasis, and links in cells.

### Risk: Trailing line-break rendering in nested table cells is not robust

Mitigation:

- Treat trailing in-cell breaks as unsupported.
- Strip them at the canonical serialization boundary.
- Do not introduce hidden placeholders or non-editable sentinels into the editing surface.

### Risk: Complex newline edit scenarios regress despite basic insertion working

Mitigation:

- Rely on the editor package's built-in line-break node semantics for normal editing.
- Add focused tests for adjacent breaks, deletion, caret movement, and undo/redo inside table cells.
- Keep custom logic limited to publication and canonicalization, not low-level line-break editing semantics.

### Risk: Focused publication crashes once a table cell contains a line-break node

Mitigation:

- Prove the real upstream table-editor publication seam with live line-break-bearing nested cell state before re-enabling `Shift+Enter` in production.
- Separate transient trailing-break behavior from stable post-typing publication behavior.
- Keep focused browser coverage for the stable single-break, consecutive-break, and trailing-break save/source-mode paths in the suite.

## Resolved Implementation Choices

1. Normalize safe-to-detect legacy `<br>` variants independently of case, including standard self-closing forms.
2. Source mode should show canonical `<br />` output when the explicit flush-and-export path succeeds.
3. Run the normalization utility on viewer loads as well as rich-text serialization boundaries, without writing normalized content back unless the user saves.
4. Coalesce nested publication through a single pending microtask, because that is the safest and most reliable way to keep publication awaitable before save and source-mode transitions.
5. Normalize numeric HTML character references for the newline character in table cells in addition to `<br>` variants and literal serialized newlines, including decimal `&#10;` and hexadecimal `&#xA;` forms, ignoring hex-digit case and leading zeros.
6. Fail closed if canonical export cannot be produced for save or source-mode entry; do not silently fall back to outer draft state.

## Recommended Implementation Order

1. Build the AST normalization utility and its unit tests.
2. Wire `getCanonicalMarkdown()` through that normalization utility and ensure nested-publication exports use the same canonicalization path.
3. Extend the nested table-cell bridge to publish dirty cell edits while focus remains inside the cell wherever that is still missing.
4. Execute the focused-publication proofs for line-break-bearing nested cell state, transient trailing-break state, and real `Shift+Enter` event ordering.
5. Preserve the now-proven fixes: do not publish nested table-cell edits from `beforeinput`, and do not manufacture a new nested-publication request during save/source-mode flush when no work is pending.
6. Add only any still-missing adjacent-break caret-motion variants on top of the already passing first-break, final-break, delete/backspace, and undo/redo sequences.
7. Canonicalize loaded markdown before seeding edit-mode baseline and draft state.
8. Encode trailing-break stripping in canonicalization tests.
9. Add any remaining Playwright coverage only if still-needed reopen/viewer-render or adjacent-break variants are discovered.
10. Run lint, typecheck, unit tests, and markdown viewer end-to-end tests.

Implementation-order note:

- Steps that were previously open but are now proven and minimally landed: the explicit `flushPendingEdits()` and `getCanonicalMarkdown()` handle methods, and the save flow's use of that contract instead of outer draft state.
- Source-mode entry through the same flush-plus-canonical-export path is also now proven and minimally landed.
- The structural viewer rendering transform for table-cell-only `<br />` handling is also now proven and minimally landed.
- Those pieces should now be treated as foundations to finish wiring, not as unresolved design questions.

## Pre-Coding Required Changes

Complete these documentation and planning changes before starting the remaining implementation work:

1. Keep proof documents in the archival role only.
2. Treat this implementation plan as the only current readiness source.
3. Add and use the release-readiness checklist below.
4. Use the byte-ownership rule below for any pre-save consumer decisions.
5. Use the proof protocols below as the agreed pass/fail definition for the added post-coding proofs.

These are pre-coding requirements because they define how the work will be judged before new code changes begin.

## Release-Readiness Checklist

Do not describe the feature as stable or release-ready until every item below is complete.

- Focused nested table-cell publication updates outer draft state while the cell remains focused.
- `Shift+Enter` inserts an in-cell line break only in nested table-cell editors.
- Plain `Enter` and table navigation behavior remain intact.
- Focused nested publication remains stable after the edited table cell contains one or more line-break nodes.
- The transient trailing-break state immediately after `Shift+Enter` is handled intentionally and does not crash publication, save, or source-mode transitions.
- Save persists the latest focused table-cell content without blur.
- Source mode shows canonical `<br />` output after switching from a focused edited table cell.
- Viewer rendering remains table-cell-scoped and does not rewrite non-table content.
- Download preserves original server bytes until canonicalized content is actually saved.
- Focused unit/integration tests pass for editor, viewer, save, and source-mode behavior.
- End-to-end coverage passes for edit, save, source-mode, reopen, and viewer rendering behavior.
- The additional performance and difficult-editing-semantics proofs defined below pass.

## Stability Remediation Plan

This section explains why the pre-coding checklist exists and defines the added post-coding proofs needed before the feature can be called truly stable.

For execution order, start with [Pre-Coding Required Changes](./MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md#pre-coding-required-changes) and [Release-Readiness Checklist](./MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md#release-readiness-checklist).

### Already addressed by the pre-coding checklist

- Proof documents are now archival records.
- This implementation plan is now the current readiness source.
- The download-only original-bytes exception is now explicit.
- The release-readiness checklist is now the primary gate for calling the feature stable.

The remaining remediation work is therefore not additional pre-coding clarification. It is the implementation work and the added post-coding proof work described below.

### 1. Add a performance proof for live normalization

Objective:

- reduce the risk that parse/stringify normalization on live nested publication becomes a stability problem on large markdown documents

Required additional proof:

- build a focused performance harness around the real nested-publication path and the production normalization utility

Required proof cases:

- repeated edits in a table cell within a small markdown document
- repeated edits in a table cell within a representative large markdown document
- burst typing that triggers publication coalescing while save and source-mode transitions remain awaitable

Proof protocol:

- use the real wrapper publication path and the production normalization utility
- measure at least:
  - time from nested edit publication request to outer draft update becoming observable
  - time from `flushPendingEdits()` request to completion
  - time from source-mode request to canonical source-mode content becoming ready
- run the same sequence against:
  - a small fixture intended to represent ordinary notes
  - a large fixture intended to represent a heavy real markdown document
- use burst input rather than isolated single edits so coalescing behavior is actually exercised

Provisional pass criteria:

- no dropped or stale publications under burst input
- no save or source-mode await path resolves before the latest nested publication is incorporated
- publication and flush latency remain below a clearly noticeable threshold for normal editing:
  - target under 50 ms for the small fixture
  - target under 150 ms for the representative large fixture
- no visible freeze or multi-keystroke backlog during the exercised burst-edit scenario

Execution update on 2026-06-26:

- The dedicated harness now exists at [frontend/scripts/markdown-table-cell-performance-proof.mjs](../frontend/scripts/markdown-table-cell-performance-proof.mjs).
- The first real user-visible run held correctness for both fixtures:
  - one upload per scenario
  - canonical saved payload after burst input
  - canonical source-mode content after save
- The latest post-fix rerun on 2026-06-26 kept correctness intact and improved some timings:
  - small fixture: publication `77.78 ms`, flush `104.77 ms`, source mode `190.61 ms`
  - large fixture: publication `77.19 ms`, flush `225.22 ms`, source mode `175.06 ms`
- Interpretation:
  - the current path stayed correct under burst input
  - small-fixture publication and flush improved materially after the latest save/source-mode fixes, but still miss the provisional targets
  - large-fixture publication stayed within the provisional target, source-mode latency improved, but the large-fixture flush target is still missed
  - small-fixture source-mode latency is now also above the provisional source-mode target in the latest rerun
  - performance follow-up is therefore still required before calling this path comfortably within the intended latency budget

Convincing evidence:

- evidence that the current microtask coalescer prevents redundant synchronous publication storms
- timing evidence showing no clearly user-visible regression for representative document sizes
- a documented threshold for what counts as acceptable publication latency

Failure conditions:

- publication latency grows enough to delay dirty-state updates or mode switches noticeably
- normalization work scales badly enough that the chosen path is no longer safe for normal editing

### 2. Add a product-level proof for difficult editing semantics

Objective:

- avoid over-relying on upstream editor behavior for the cases most likely to break user trust

Required additional proof:

- add focused editor tests, and where necessary end-to-end coverage, for the hardest table-cell line-break editing cases

Required proof cases:

- multiple consecutive non-trailing line breaks
- deletion across adjacent line breaks
- caret motion across adjacent line breaks
- undo and redo across table-cell line-break edits
- interaction with table navigation after `Shift+Enter` is added
- at least one mobile-focused sanity check if the same editing path is used there

Proof protocol:

- exercise the real `MarkdownRichEditor` wrapper path first
- add end-to-end coverage for at least one representative sequence that combines:
  - insert break
  - continue typing
  - move the caret
  - delete across a break
  - undo and redo
  - save or switch to source mode afterward
- verify not only editor state but also dirty tracking, save payload, and source-mode output after those edits

Pass criteria:

- no sequence requires blur or mode switching to appear correct
- dirty tracking updates during the focused edit session
- undo and redo preserve coherent content and caret behavior across line-break edits
- save and source-mode output remain canonical after the exercised edit sequences
- table navigation and plain `Enter` behavior remain unchanged outside the intended `Shift+Enter` override

Convincing evidence:

- assertions against the real editor wrapper path, not only utility output
- confirmation that dirty tracking, save behavior, and source-mode export remain correct after those edits

Failure conditions:

- custom `Shift+Enter` handling destabilizes normal editor movement or history
- editing behavior appears correct only after blur, save, or mode-switch repair

### 2A. Add a focused-publication proof for line-break-bearing nested cell state

Objective:

- close the exact gap exposed by real-browser `Shift+Enter` exploration before any further product-level confidence claims are made

Required additional proof:

- build a focused harness around the real table-cell editor publication seam once the nested editor contains one or more line-break nodes

Required proof cases:

- one inserted line break followed by continued typing, then outward publication
- multiple consecutive internal line breaks followed by continued typing, then outward publication
- immediate post-`Shift+Enter` transient trailing-break state before continued typing
- save-triggered flush after line-break insertion
- source-mode-triggered flush after line-break insertion

Proof protocol:

- use the real table editor's `saveAndFocus(...)` / `updateCellContents(...)` / `NESTED_EDITOR_UPDATED_COMMAND` path rather than only wrapper mocks
- record whether publication throws, whether markdown becomes observable, and whether the transient trailing-break state is exported, deferred, or rejected
- preserve one browser-level reproduction alongside the narrower executable harness so the actual failure mode remains visible

Pass criteria:

- no `Lexical node does not exist in active editor state` exception under the exercised cases
- parent markdown updates only after the latest stable nested state is publishable
- save and source-mode flush consume the same stable publication result
- transient trailing-break behavior is explicitly defined and repeatable

Failure conditions:

- publication still crashes after a line-break node exists
- save or source-mode flush reaches the same crashing state
- the design still depends on publishing an unsupported transient trailing break as if it were stable persisted content

### 2B. Add a real event-ordering proof for `Shift+Enter`

Objective:

- prove that the eventual `Shift+Enter` implementation cooperates with the existing table plugin instead of racing or bypassing it unsafely

Required additional proof:

- execute the actual `Shift+Enter` and plain `Enter` key paths against the real nested table-cell editor and observe focus, nested content, and outward publication ordering

Required proof cases:

- `Shift+Enter` inserts an in-cell break and keeps focus in the same cell
- plain `Enter` preserves current table behavior
- `Shift+Enter`, continued typing, and first outward publication
- `Shift+Enter`, then immediate save or source-mode request

Proof protocol:

- exercise real browser or real editor-harness key events rather than synthetic wrapper-only command assertions
- verify focused cell identity, resulting markdown, and publication timing after each sequence

Pass criteria:

- `Shift+Enter` no longer triggers plain-Enter table navigation
- plain `Enter` remains unchanged
- the first outward publication occurs only after a stable post-insertion editor state exists

Failure conditions:

- `Shift+Enter` still moves focus to another cell
- correctness depends on brittle event-phase interception rather than a stable editor path
- publication still happens too early or against stale nested state

### 3. Sequence the remaining work

Recommended order:

1. Use the pre-coding checklist above as the required starting point.
2. Run the new focused-publication proof for line-break-bearing nested cell state.
3. Run the new real event-ordering proof for `Shift+Enter`.
4. Finish any remaining adjacent-break variant work.
5. Complete final Playwright coverage variants and final validation.
6. Re-run the performance proof after behavior changes and either improve the measured latency or revise the acceptance budget with evidence.

Final gate:

- treat the feature as truly stable only after the remaining implementation items, the additional proofs above, and the end-to-end validation suite all pass together.

## Recommendation

Proceed with an AST-based implementation only.

Do not implement this feature using:

- line-based table-row parsing
- `split("|")` cell extraction
- post-switch source-mode repair of already-exposed stale markdown
- focus-restoration-triggered markdown repair
- blur-only nested table-cell synchronization
- save-time DOM scraping from the focused table cell
- invisible placeholder or sentinel nodes used only to force trailing-break rendering
- recursive rendered-child rewriting in table cells

Trailing in-cell breaks are explicitly unsupported and must be stripped.
