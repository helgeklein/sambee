# Markdown Table Cell Newlines Proof Status

## Purpose

This document records the current status of the critical proofs defined in:

- [MARKDOWN_TABLE_CELL_NEWLINES_CRITICAL_PROOFS_PLAN.md](./MARKDOWN_TABLE_CELL_NEWLINES_CRITICAL_PROOFS_PLAN.md)

It should be updated as each proof is executed.

This document is an execution record of those proofs. It is not, by itself, the authoritative feature-completion or release-readiness checklist.

## Current Status Summary

1. Structural GFM table normalization: fully completed successfully for the chosen representation strategy
2. Focused nested table-cell publication without blur: completed for ordinary publication, line-break-bearing continued typing, toolbar Save, `Ctrl+S`, and source-mode entry from the focused trailing-break state
3. Canonical export as sole save payload: fully completed successfully
4. Source-mode transition reliability: completed for the wrapper-owned flush/export path, including the focused trailing-break case and the continued-typing internal-break case on both desktop and mobile
5. Structurally scoped viewer rendering: fully completed successfully
6. Canonical initialization without false dirty states: fully completed successfully

## Newly Identified Missing Proofs

The original proof set did not execute the live publication seam after a focused nested table cell contains a real Lexical line-break node.

The currently remaining proof work is no longer about save or source-mode entry for the focused trailing-break state.

The remaining proof work before `Shift+Enter` can be considered exhaustively proven end to end is now narrower and centered on:

1. any remaining adjacent-break caret-motion variants beyond the current representative first-break, final-break, and delete-across-break browser cases
2. the separate performance proof follow-up, because the first real user-visible timing run exceeded the provisional latency targets even though correctness held

## Overall Readiness

Proof 1 is fully and successfully completed for the chosen representation strategy.

In plain terms, that strategy is:

- persisted pipe-table markdown must not contain literal newline characters inside a cell
- source mode must not show literal newline characters inside a table row cell
- any in-cell line-break semantics coming from the editor must be converted to canonical `<br />` before pipe-table markdown is generated

That means we have sufficiently proven the export-boundary strategy for canonicalizing supported in-cell line-break representations before raw pipe-table markdown is finalized.

For the items actually tested by Proof 1, yes, we can now implement them with confidence.

Specifically, we can confidently implement:

- canonicalization of `<br>` variants in table cells
- canonicalization of numeric newline character references in table cells
- stripping of trailing in-cell breaks
- preservation of supported inline markdown structure during canonicalization
- pre-stringify canonicalization at the mdast export boundary so nested publication, save export, and source-mode export all produce canonical `<br />` output

What Proof 1 does not justify is any implementation that tries to recover literal newline characters after they have already been emitted into raw pipe-table row syntax.

It does not mean the feature is fully de-risked for implementation.

Most critical seams are now proven, and the previously blocking line-break-bearing publication, save, keyboard-save, and source-mode-entry paths have all been resolved.

Implementation can now be treated as largely proven at the critical-seam level covered by this plan. That does not, by itself, mean that the remaining product work is fully implemented or release-ready.

## Proof 1: Structural GFM Table Normalization

### Artifact

- Executable proof harness: [frontend/scripts/markdown-table-cell-normalization-proof.mjs](../frontend/scripts/markdown-table-cell-normalization-proof.mjs)
- Export-boundary proof: [frontend/scripts/markdown-table-cell-export-boundary-proof.mjs](../frontend/scripts/markdown-table-cell-export-boundary-proof.mjs)
- Pre-stringify canonicalization proof: [frontend/scripts/markdown-table-cell-pre-stringify-canonicalization-proof.mjs](../frontend/scripts/markdown-table-cell-pre-stringify-canonicalization-proof.mjs)
- Nested-publication integration proof: [frontend/scripts/markdown-table-cell-nested-publication-proof.mjs](../frontend/scripts/markdown-table-cell-nested-publication-proof.mjs)
- Save-export path proof: [frontend/scripts/markdown-table-cell-save-export-path-proof.mjs](../frontend/scripts/markdown-table-cell-save-export-path-proof.mjs)
- Source-mode transition proof: [frontend/scripts/markdown-table-cell-source-mode-transition-proof.mjs](../frontend/scripts/markdown-table-cell-source-mode-transition-proof.mjs)
- Integrated export-boundary proof: [frontend/scripts/markdown-table-cell-integrated-export-boundary-proof.mjs](../frontend/scripts/markdown-table-cell-integrated-export-boundary-proof.mjs)

### Current Result

Status: fully completed successfully for the chosen representation strategy

Completion verdict: yes. Proof 1 is complete for the chosen representation strategy.

What that means: the export-boundary canonicalization approach is proven for the supported representations we intend to handle.

Scope note: this proof is complete only for the structural/export-boundary question it was designed to answer. It is not a substitute for Critical Pieces 2 through 6.

Sub-proof status:

- raw post-parse recovery of literal newlines in pipe-table row syntax: failed and intentionally out of scope for the final design
- existence of a pre-stringify export boundary in the installed editor package: proven
- feasibility of canonical `<br />` output from a pre-stringify mdast transform: proven
- revised export-boundary corpus over the real nested/save/source seams: proven

### Passed Cases

- canonicalizes `<br>` tag spellings in table cells
- canonicalizes numeric newline character references in table cells
- preserves escaped pipes, inline code, emphasis, and links for valid GFM table markdown
- leaves literal `<br />` text outside tables untouched
- strips trailing line breaks in table cells

### Failed Cases

- canonicalization of literal serialized newline characters after they have already been emitted into raw pipe-delimited table row syntax
- preservation of multiple consecutive internal literal newline characters after they have already been emitted into raw pipe-delimited table row syntax

### Interpretation

This is a real design finding, not just a missing implementation detail.

When raw pipe-table markdown contains a literal newline character inside a cell, the GFM parser treats that newline as markdown row structure before AST normalization can recover the intended in-cell meaning.

That means a post-parse AST normalization step over raw markdown text cannot, by itself, recover editor-exported literal newlines once they have already been emitted into ambiguous raw pipe-table syntax.

### Consequence For The Main Plan

The main implementation plan is valid for:

- `<br>` variants
- numeric newline character references
- canonicalization of already-structural break representations
- pre-stringify canonicalization at an mdast export boundary before final GFM table markdown is emitted

It is not valid for literal serialized newline characters once they have already been emitted into raw pipe-table markdown.

That unresolved case is now explicitly treated as a ruled-out representation rather than as a remaining blocker for the chosen design.

We do not intend to support literal in-cell newlines as a valid persisted raw pipe-table representation.

That specific part of the design therefore needs refinement at an earlier boundary, not broader support in raw table markdown itself.

The most likely correction is:

- normalize literal line-break semantics before they are flattened into ambiguous raw pipe-table markdown syntax

The required rule for the final implementation should be:

- raw persisted pipe-table markdown must never contain literal in-cell newline characters
- source mode should not expose literal in-cell newline characters in table rows
- any editor-exported in-cell newline semantics must be canonicalized to `<br />` before raw pipe-table row text is finalized

### Additional Proven Findings

The following follow-up proofs now pass:

- The installed editor package has a real pre-stringify export boundary.
	Details:
	The nested table editor publishes cell content through `exportLexicalTreeToMdast(...)` and updates table-cell mdast children before final markdown stringification.
- The installed linebreak export visitor currently emits mdast text nodes with raw `"\n"` values.
- Final GFM table markdown is emitted later through `toMarkdown(...)` with the GFM table extension.
- At that mdast boundary, replacing newline text semantics with html break nodes yields canonical `<br />` output instead of numeric newline references.
- The real nested table-cell publication path can accept canonicalized phrasing children at `updateCellContents(...)` without changing the surrounding `NESTED_EDITOR_UPDATED_COMMAND` publication contract.
- The real rich-text save path can be sourced from the package's authoritative `exportMarkdownFromLexical(...) -> markdown$ -> getMarkdown()` pipeline rather than from outer draft state.
- The real source-mode transition path already mirrors rich-text markdown into `markdownSourceEditorValue$`, reimports source edits through `setMarkdown$`, and restores focus through the wrapper's view-mode bridge.
- The revised export-boundary canonicalization satisfies the supported newline normalization corpus at the actual mdast export boundary and keeps nested publication, save export, and source-mode display on canonical `<br />` output.

This means the design now has a credible early hook point, and that the real nested-publication, save-export, and source-mode paths can all reach it.

The remaining question is no longer whether a suitable boundary exists, or whether the relevant product paths can use it in principle.

The remaining question is whether the integrated product implementation can preserve focus behavior, publication correctness, deterministic flush semantics, and the existing editing contract when that proven export-boundary strategy is wired into the real editor wrapper.

### Required Follow-Up Before Proof 1 Can Be Marked Proven

Completed.

Proof 1 is now considered fully completed and satisfied for the chosen representation strategy:

- raw persisted pipe-table markdown must never contain literal in-cell newline characters
- source mode must not expose literal in-cell newline characters in table rows
- any in-cell line-break semantics must be canonicalized to `<br />` before raw pipe-table row text is finalized

## Proof 2: Focused Nested Table-Cell Publication Without Blur

### Artifact

- Focused-publication proof: [frontend/scripts/markdown-table-cell-focused-publication-proof.mjs](../frontend/scripts/markdown-table-cell-focused-publication-proof.mjs)
- Publication-completion boundary proof: [frontend/scripts/markdown-table-cell-publication-completion-boundary-proof.mjs](../frontend/scripts/markdown-table-cell-publication-completion-boundary-proof.mjs)
- Publication-coalescer proof: [frontend/scripts/markdown-table-cell-publication-coalescer-proof.mjs](../frontend/scripts/markdown-table-cell-publication-coalescer-proof.mjs)
- Wrapper-integration proof: [frontend/scripts/markdown-table-cell-wrapper-integration-proof.mjs](../frontend/scripts/markdown-table-cell-wrapper-integration-proof.mjs)
- Live line-break-bearing publication proof: [frontend/scripts/markdown-table-cell-line-break-publication-proof.mjs](../frontend/scripts/markdown-table-cell-line-break-publication-proof.mjs)
- Live `Shift+Enter` event-ordering proof: [frontend/scripts/markdown-table-cell-shift-enter-event-ordering-proof.mjs](../frontend/scripts/markdown-table-cell-shift-enter-event-ordering-proof.mjs)
- Wrapper flush spike + tests: [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx), [frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx)

### Current Result

Status: completed for the critical focused-publication seam, including line-break-bearing nested state, wrapper awaitability, and the resolved browser-repro paths

Completion verdict: yes. Proof 2 is complete for the critical seam it was defined to prove.

The blur-independent publication primitive is proven, the completion-notification boundary is proven, the latest-wins coalescing contract is proven, the real wrapper-level `flushPendingEdits()` contract is exercised end to end in tests, and the real browser path now passes for both single-break and consecutive-break continued editing plus save/source-mode transitions.

### Proven So Far

- the installed nested table-cell editor can publish outward on `NESTED_EDITOR_UPDATED_COMMAND` without requiring blur
- that publication path updates parent table-cell mdast before redispatching `NESTED_EDITOR_UPDATED_COMMAND` upward
- the root editor path already re-exports markdown after nested publication reaches it
- the next rich-editor `onChange` after a forced nested publication is a real product-facing completion-notification boundary
- a queueMicrotask plus generation-counter coordinator can coalesce repeated publication requests into one shared latest-wins promise that resolves only after the latest completion is observed
- `MarkdownRichEditor` already owns the `MDXEditor` ref, the active-editor ref, the imperative handle surface, and the real `onChange` completion signal needed to attach that contract without changing ownership boundaries
- a real wrapper-level `flushPendingEdits()` proof spike can dispatch nested publication, coalesce repeated requests, and resolve only after the latest completion is observed

### Not Proven By The Existing Proof 2 Artifacts

- publication after a focused nested table cell contains a real Lexical line-break node
- publication from the transient trailing-break state immediately after `Shift+Enter`
- real event ordering between line-break insertion, the table plugin's existing Enter behavior, and outward publication
- save or source-mode flush after a line-break insertion sequence has exercised the real upstream publication seam

### Historical Not Yet Proven At Time Of Proof 2

- save can await the wrapper contract end to end against the installed editor path
- source-mode transition can await the wrapper contract end to end against the installed editor path

### Current Blocking Finding

No currently known blocking finding remains in this proof slice.

The earlier line-break-bearing focused-publication crash is now resolved in the app wrapper, and the later source-mode failure turned out to be a proof-harness locator bug.

### Newly Executed Follow-Up Proof Results

- The live `Shift+Enter` event-ordering proof now passes for the currently installed wrapper path.
	- `Shift+Enter` stays in the edited cell.
	- plain `Enter` still follows the upstream table-navigation path into the next row.
- The live line-break-bearing publication proof now passes for the continued-typing and save path.
	- `Shift+Enter`, continued typing, and save no longer reproduces `Lexical node does not exist in active editor state`.
	- The fix was app-owned: the wrapper now avoids requesting outward publication from nested `beforeinput`.
- The wrapper regression tests now cover the queue-level repair points directly.
	- nested `beforeinput` no longer triggers outward publication in the wrapper test harness
	- a second nested edit arriving during an in-flight publication retriggers and publishes the latest markdown
- The transient trailing-break save cases now pass.
	- immediate trailing-break toolbar Save now reaches upload and strips the unsupported trailing break safely
	- `Ctrl+S` from the same focused trailing-break state now reaches the same save completion boundary
	- the keyboard fix was app-owned: the save shortcut now matches the actual nested-editor key events reaching the viewer shortcut layer
- The trailing-break source-mode case now passes as well.
	- the live app still exposes `Source mode` after trailing `Shift+Enter`
	- the earlier failing proof used the wrong accessible role: MDXEditor exposes the mode switch as a `radio`, not a plain `button`
	- clicking the real Source mode control succeeds, opens the source editor, and does not preserve the unsupported trailing `<br />`
- Browser end-to-end coverage now also includes the consecutive-break save path.
	- two consecutive `Shift+Enter` breaks followed by continued typing save as canonical `A1<br /><br />bar`
- Browser end-to-end coverage now also includes a representative hard-editing sequence.
	- deleting across an internal break after adjacent `Shift+Enter` edits saves the joined canonical cell content
	- undo and redo across nested table-cell break edits round-trip correctly before save
- Browser end-to-end coverage now also includes a representative caret-motion sequence.
	- left and right arrow movement across the final internal break remains in the same cell and saves the expected canonical insertion position
	- left arrow movement across the first internal break also remains in the same cell and saves the expected canonical insertion position
- Browser end-to-end coverage now also includes a representative reopen/render sequence.
	- after saving consecutive internal breaks, a reload of the mocked file re-renders the same table cell with structural `<br>` elements in the viewer
- Mobile sanity coverage now includes both source-mode paths exercised so far.
	- the mobile More actions flow can still switch to source mode after a focused trailing `Shift+Enter`
	- the same mobile flow now also preserves canonical `A1<br />bar` output after `Shift+Enter` plus continued typing
	- the earlier shared desktop/mobile `A1&#xA;bar` mismatch is now resolved by explicitly dispatching nested editor synchronization before source-mode export
- The dedicated performance proof now exists and records real user-visible timings.
	- harness: [frontend/scripts/markdown-table-cell-performance-proof.mjs](../frontend/scripts/markdown-table-cell-performance-proof.mjs)
	- correctness held under burst input for both fixtures: no dropped uploads, one canonical save payload, and canonical source-mode content after save
	- latest measured timings on 2026-06-26 after the save/source-mode fixes:
	  - small fixture: publication `77.78 ms`, flush `104.77 ms`, source mode `190.61 ms`
	  - large fixture: publication `77.19 ms`, flush `225.22 ms`, source mode `175.06 ms`
	- those timings show some improvement, but they still exceed the provisional plan targets for small publication/flush/source-mode and for large flush, so performance remains a real follow-up item rather than an unrun proof

### Required Follow-Up Before Proof 2 Can Be Treated As Fully Satisfied Again

- preserve the resolved app-owned fixes in the wrapper:
	- do not request nested publication from nested `beforeinput`
	- do not manufacture a new nested publication request during save/source-mode flush when no work is pending
	- allow the save shortcut to match the actual nested-editor key events observed in the browser
- expand coverage toward any remaining adjacent-break caret-motion variants if exhaustive caret-motion proof is still desired
- follow up on the measured performance-budget overruns from the new performance proof

## Proof 3: Canonical Export As Sole Save Payload

### Artifact

- Save-path proof spike: [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx), [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- Save-path tests: [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)

### Current Result

Status: complete for the proven source-mode transition path, but still downstream of the unresolved line-break-bearing focused-publication seam

Completion verdict: yes. Proof 3 is complete.

The rich editor now exposes a real `flushPendingEdits()` plus `getCanonicalMarkdown()` contract, the viewer save path awaits that contract before persisting content, and save fails closed when flush or canonical export cannot produce a trusted payload.

### Proven So Far

- `MarkdownRichEditor` can expose canonical markdown directly from the installed editor export pipeline through an imperative handle method
- `MarkdownViewer` can await `flushPendingEdits()` before saving, then persist the canonical editor export instead of outer `draftContent`
- the persisted save payload can differ from stale outer draft state and still match canonical editor export exactly
- save remains blocked and surfaces an error when pending nested-publication flush fails
- save remains blocked and surfaces an error when canonical markdown export throws
- post-save content and baseline updates use the canonical saved payload because the viewer now seeds them from the same `savedContent` variable that was persisted

### Required Cases Covered

- save while rich-text editor state is authoritative and the persisted payload must come from canonical export rather than outer draft state
- save failure path when flush rejects
- save failure path when canonical export throws

### Historical Not Yet Proven At Time Of Proof 3

- the end-to-end real table-cell canonicalization path through save after the export-boundary transform is wired into the production editor export
- source-mode transition consumption of the same flush-and-canonical-export contract

### Current Blocking Finding

No remaining blocker for Proof 3.

The remaining work has moved to Proof 4 and later implementation slices.

### Required Follow-Up Before Proof 3 Can Be Marked Proven

Completed.

## Proof 4: Source-Mode Transition Reliability

### Artifact

- Existing feasibility proof: [frontend/scripts/markdown-table-cell-source-mode-transition-proof.mjs](../frontend/scripts/markdown-table-cell-source-mode-transition-proof.mjs)
- Wrapper-level source-mode transition spike: [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)
- Production normalizer used by source-mode export: [frontend/src/components/Viewer/markdownTableCellLineBreaks.ts](../frontend/src/components/Viewer/markdownTableCellLineBreaks.ts)
- Focused editor tests: [frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx)

### Current Result

Status: fully completed successfully

Completion verdict: yes. Proof 4 is complete.

The wrapper-owned source-mode entry path can be intercepted before direct `viewMode$` mutation commits the transition, the wrapper can await `flushPendingEdits()`, canonicalize markdown through the production table-cell normalization utility, push canonical markdown back through `setMarkdown()`, and block the mode switch with a surfaced error if canonical export is unavailable.

Scope note: this proof still assumes the focused nested-publication seam is safe for the nested state being flushed. A separate missing proof now exists for source-mode entry after live line-break insertion inside a focused table cell.

This proof is completed by composition with Proof 2.

Proof 2 established that a focused nested table-cell editor can publish deterministically outward without blur and that `flushPendingEdits()` resolves only after the latest publication is observed.

Proof 4 now establishes that the real wrapper-owned source-mode entry path awaits that contract, canonicalizes the resulting markdown before mode commit, restores focus after successful mode entry, and fails closed with selection restoration when export cannot be produced.

### Proven So Far

- desktop and mobile source-mode entry requests owned by `MarkdownRichEditor` can be routed through a pre-commit async transition helper instead of directly calling `setViewMode("source")`
- that helper can await `flushPendingEdits()` before source-mode entry
- the wrapper canonicalizes source-mode markdown through the production table-cell normalization utility before pushing it back into editor state through `setMarkdown()`
- source-mode entry now normalizes multiple consecutive internal line breaks into canonical `<br />` output before mode commit
- source-mode entry now strips trailing in-cell line breaks before mode commit
- if canonical export is unavailable, source-mode entry fails closed, leaves mode unchanged, surfaces an error locally, and restores preserved selection when possible
- successful source-mode entry restores focus predictably through the wrapper's real post-mode-change focus bridge
- the surrounding viewer integration still passes after this wrapper-level spike

### Current Blocking Finding

No remaining blocker for Proof 4.

The later proof sequence is now complete.

## Proof 5: Structurally Scoped Viewer Rendering

### Artifact

- Viewer rendering transform: [frontend/src/components/Viewer/markdownTableCellLineBreaks.ts](../frontend/src/components/Viewer/markdownTableCellLineBreaks.ts)
- Viewer integration: [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- Viewer DOM tests: [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)

### Current Result

Status: fully completed successfully

Completion verdict: yes. Proof 5 is complete.

The viewer now uses a structural remark transform that converts canonical `<br />` html nodes into mdast `break` nodes only inside `tableCell` nodes before React rendering. That yields actual visual line breaks in table cells without rewriting non-table markdown content.

### Proven So Far

- viewer rendering detects table-cell context structurally through mdast traversal rather than raw string inspection
- canonical `<br />` inside markdown table cells renders as an actual visual line break
- literal `<br />` outside markdown tables remains literal visible text
- inline code containing `<br />` inside a table cell remains inline code and does not gain DOM break elements
- mixed inline formatting inside a table cell remains intact around rendered breaks
- the viewer-level proof passes through the real `ReactMarkdown` plus `remarkGfm` rendering path used by the product

### Current Blocking Finding

No remaining blocker for Proof 5.

The later proof sequence is now complete.

## Proof 6: Canonical Initialization Without False Dirty States

### Artifact

- Canonical load-state initialization: [frontend/src/components/Viewer/MarkdownViewer.tsx](../frontend/src/components/Viewer/MarkdownViewer.tsx)
- Initialization-focused viewer tests: [frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx](../frontend/src/components/Viewer/__tests__/MarkdownViewer.test.tsx)

### Current Result

Status: fully completed successfully

Completion verdict: yes. Proof 6 is complete.

Loaded markdown is now canonicalized before the viewer seeds `content`, `draftContent`, and the edit baseline. Entering edit mode therefore gives the rich editor and dirty-tracking baseline the same canonical markdown from the start, so the first no-op publication on untouched legacy content does not create a false dirty state.

### Proven So Far

- loaded markdown is canonicalized consistently before dirty tracking compares values
- edit baseline and rich-editor input are seeded from the same canonical content
- legacy table-cell `<br>` variants enter edit mode without immediately marking the session dirty
- numeric newline character references in table cells enter edit mode without immediately marking the session dirty
- canonical content normalized by the shared production utility remains pristine through the first no-op publication
- real user edits still mark the session dirty promptly after initialization

### Current Blocking Finding

No remaining blocker for Proof 6.

All critical proof gates are now complete.

### Required Follow-Up Before Proof 6 Can Be Marked Proven

Completed.

### Required Follow-Up Before Proof 5 Can Be Marked Proven

Completed.

### Required Follow-Up Before Proof 4 Can Be Marked Proven

Completed.

### Required Follow-Up Before Proof 2 Can Be Marked Proven

Completed.
