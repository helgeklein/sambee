# Markdown Table Cell Newlines Critical Proofs Plan

## Purpose

This document identifies the critical pieces on which the success of the markdown table-cell newline plan depends.

It also defines how each critical piece must be proven before implementation proceeds.

Proofs 1 through 6 have now been completed with proof-driven spikes and focused tests. This document now serves primarily as an archival record of the proof criteria and what was proven at each critical seam.

This is a proof-gated companion to:

- [MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md](./MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md)

Now that all critical proofs are complete, this document should not be used by itself as the feature-completion or release-readiness signal. Remaining implementation and stability work is tracked in [MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md](./MARKDOWN_TABLE_CELL_NEWLINES_IMPLEMENTATION_PLAN.md).

## Current Proof Status

- Critical Piece 1 is complete.
- Critical Piece 1A is complete.
- Critical Piece 2 is complete for ordinary focused publication, line-break-bearing continued typing, consecutive internal breaks, toolbar Save, `Ctrl+S`, and source-mode entry from the focused trailing-break state.
- Critical Piece 3 is complete.
- Critical Piece 4 is complete for the wrapper-owned flush/export path, including the focused trailing-break source-mode path.
- Critical Piece 5 is complete.
- Critical Piece 6 is complete.

## Post-Proof Gap Discovered During Implementation

After the original proof set was completed, real-browser `Shift+Enter` enablement exposed narrower seams that the earlier Proof 2 artifacts did not execute directly.

The first missing seam was:

- focused nested table-cell publication after the nested editor contains a real Lexical line-break node

That seam has now been resolved in the app wrapper: the failing path was nested auto-publication from `beforeinput`, not an unavoidable upstream publication failure.

The later suspected source-mode seam has also now been resolved: the failing proof used the wrong accessible role for MDXEditor's mode-switch control.

What the earlier proofs did cover:

- ordinary focused nested publication without blur
- wrapper-level coalescing and awaitability
- export-boundary canonicalization after structurally valid table-cell children already exist

What they did not cover:

- publication from a live nested table cell whose editor state already contains one or more line-break nodes
- publication from the transient trailing-break state immediately after `Shift+Enter` and before subsequent typing
- real event ordering between nested key handling, line-break insertion, the table plugin's `KEY_ENTER_COMMAND`, and outward publication

What is now covered by the newly executed follow-up proofs:

- publication after a focused nested table cell contains a real line-break node and the user continues typing
- publication after a focused nested table cell contains consecutive internal line-break nodes and the user continues typing or saves
- immediate trailing-break toolbar Save
- trailing-break `Ctrl+S`
- real event ordering between `Shift+Enter` and plain `Enter`
- wrapper-level regression coverage for nested `beforeinput` suppression and in-flight latest-wins retriggering

The additional proofs below are no longer blockers for `Shift+Enter` enablement. They remain useful as archival criteria for the now-completed critical seam, while the remaining product work has moved into harder editing semantics and broader end-to-end coverage tracked in the implementation plan.

## Why This Separate Plan Exists

The main implementation plan is broad and end-to-end. That is useful for execution, but it can hide the fact that only a small number of technical seams actually determine whether the approach will succeed.

Those seams are:

- whether GFM table markdown can be normalized structurally and safely
- whether focused nested table-cell edits can be published outward reliably without blur
- whether canonical export can become the only trusted save/source-mode payload
- whether source-mode transitions can be made reliable without focus or selection regressions
- whether viewer rendering can stay structurally scoped to table cells without corrupting other markdown
- whether canonical initialization can keep dirty tracking pristine on untouched legacy content

If any one of those pieces fails, the overall plan becomes much riskier or needs redesign.

## What Counts As Convincing Proof

A proof is convincing only if it satisfies all of the following:

- it exercises the actual abstraction boundary that the final implementation will rely on
- it can fail in a specific, falsifiable way
- it produces repeatable evidence, not just a one-off observation
- it covers both the success path and the key failure or edge cases
- it is narrow enough that passing it genuinely increases confidence in the design, rather than merely exercising unrelated code

Preferred proof forms, in order:

1. a focused automated test or fixture corpus
2. a narrow executable spike using the real library or editor surface
3. a local prototype or harness that demonstrates the exact behavior boundary
4. a documented code-reading proof only when execution is genuinely impossible

Manual observation alone is not sufficient for any critical piece unless it is paired with durable automated evidence.

## Exit Rule

Remaining feature work may proceed only after every still-open critical piece below is marked proven.

If any proof fails, stop and revise the main plan before coding the full feature.

## Critical Piece 1: Structural GFM Table Normalization Is Safe

### Why This Piece Is Critical

The entire strategy depends on AST-based normalization of markdown table cells.

If GFM table markdown is not parsed and serialized in a way that preserves table structure and surrounding inline content safely, the plan loses its foundation and falls back toward unsafe string rewriting.

### What Must Be Proven

- GFM pipe tables parse into table and tableCell nodes in the normalization path we intend to use.
- The normalization utility can rewrite only table-cell newline variants without corrupting non-target content.
- Serialization after normalization does not damage valid markdown constructs such as escaped pipes, inline code, emphasis, or links.
- Trailing in-cell breaks can be stripped without unintended changes to non-trailing content.
- Literal in-cell line breaks are not expected to survive into raw pipe-table markdown; they must be intercepted before that representation is finalized.

### Required Proof

Build a focused normalization harness or unit-test corpus around the exact parser/stringifier stack the feature will use.

Minimum proof corpus:

- tables containing `<br>`, `<br/>`, and `<br />`
- tables containing decimal and hexadecimal numeric newline references
- tables containing escaped pipes
- tables containing inline code with `|`
- tables containing emphasis and links around break content
- markdown with literal `<br />` outside tables
- tables with trailing line breaks that must be stripped

This proof explicitly does not require raw pipe-table markdown containing literal in-cell newline characters to normalize successfully.

That case must be prevented earlier, before raw pipe-table row text is produced.

### Convincing Evidence

- snapshot or fixture-based tests that compare input and normalized output
- explicit assertions that only the intended table-cell content changed
- at least one round-trip test showing stable repeated normalization

### Failure Conditions

- no tableCell nodes are available in the parse tree
- serialization rewrites unrelated markdown formatting in unacceptable ways
- normalization changes non-table content
- trailing-break stripping affects non-trailing breaks or non-table content
- the design still depends on recovering literal in-cell newline characters after they have already been emitted into raw pipe-table row syntax

## Critical Piece 1A: Literal In-Cell Line Breaks Are Canonicalized Before Pipe-Table Stringification

### Why This Piece Is Critical

Proof 1 showed that once literal newline characters have already been emitted into raw pipe-delimited table row syntax, post-parse AST normalization cannot reliably recover the intended in-cell meaning.

That means the design succeeds only if literal in-cell line-break semantics are canonicalized before final pipe-table markdown text is produced.

### What Must Be Proven

- the editor/export pipeline exposes a structural boundary before final markdown stringification
- that boundary still distinguishes in-cell line-break semantics from final raw pipe-table row text
- we can canonicalize those line-break semantics to `<br />` at that boundary
- no save path, source-mode path, or nested-publication path can leak literal in-cell newline characters into raw pipe-table markdown

### Required Proof

Build a narrow proof around the real export pipeline used by the installed editor package.

At minimum, the proof must establish:

- where Lexical line-break nodes are lowered during export
- whether table-cell publication happens at an mdast boundary before final `toMarkdown()` stringification
- where a canonicalization hook can be inserted so table-cell line breaks become `<br />` before raw table rows are emitted

Preferred proof form:

1. an executable spike or harness that demonstrates the export boundary and the emitted node shape
2. paired with an automated code-reading assertion if needed to pin the package behavior precisely

### Convincing Evidence

- evidence that the pre-stringify boundary really exists in the installed package
- evidence showing the current emitted node shape for line breaks at that boundary
- evidence that the chosen hook point can convert those semantics to canonical `<br />` before final table markdown is produced

### Failure Conditions

- no usable structural boundary exists before pipe-table stringification
- line-break semantics are already irreversibly flattened before any hookable boundary
- a required path still emits literal in-cell newline characters into raw pipe-table markdown

## Critical Piece 2: Focused Nested Table-Cell Edits Can Be Published Reliably Without Blur

### Why This Piece Is Critical

The plan requires dirty tracking, save correctness, and source-mode correctness while the caret is still inside a nested table-cell editor.

If focused nested edits cannot be published outward reliably, the rest of the design does not hold.

### What Must Be Proven

- a focused nested table-cell editor can trigger outward publication without requiring blur
- the publication mechanism uses the real editor surface the final implementation will rely on
- repeated keystrokes can be coalesced without losing the final state
- publication can be awaited deterministically before save or mode switch

### Required Proof

Create a narrow editor spike or test harness using the installed editor package and the nested table-cell editor path.

The proof must show:

- a dirty edit in a table cell causes publication into the parent markdown state while focus remains in the cell
- `NESTED_EDITOR_UPDATED_COMMAND` or the exact chosen primitive is sufficient for the real path
- a single coalesced pending-publication promise can represent the current outstanding work correctly

### Convincing Evidence

- automated editor test or spike output showing parent markdown updates before blur
- assertions that save/flush can await publication completion
- assertions that rapid consecutive edits still produce the latest published markdown

### Failure Conditions

- parent markdown updates only after blur or mode switch
- coalescing loses edits or races under repeated input
- no deterministic signal exists for “publication complete”

## Critical Piece 2A: Focused Publication Remains Safe After A Real Line-Break Node Exists

### Why This Piece Is Critical

The original focused-publication proofs established that publication can happen without blur and can be awaited deterministically.

They did not establish that the upstream table-editor publication path remains valid once the nested cell contains a real Lexical line-break node.

That missing case is now the concrete blocker for `Shift+Enter`.

### What Must Be Proven

- a focused nested table cell containing a real line-break node can publish outward without throwing
- the real upstream table-editor path (`saveAndFocus(...)`, `updateCellContents(...)`, and `NESTED_EDITOR_UPDATED_COMMAND`) is the path being exercised
- publication succeeds both after line-break insertion plus continued typing and after explicit flush requests
- publication either safely rejects or intentionally defers unsupported transient trailing-break states instead of crashing

### Required Proof

Build a real editor harness around the installed table-cell editor path.

Required cases:

- insert one line break into a focused table cell, continue typing, and force outward publication
- insert multiple consecutive internal line breaks, continue typing, and force outward publication
- attempt publication immediately after `Shift+Enter` while the break is still transiently trailing
- call the real save/flush boundary after a line-break insertion sequence
- call the real source-mode transition boundary after a line-break insertion sequence

Preferred proof form:

1. a focused executable harness against the real MDX editor table-cell path
2. paired with wrapper-level automated tests where they can assert the product-facing completion signals

### Convincing Evidence

- repeatable evidence that no `Lexical node does not exist in active editor state` exception occurs in the exercised cases
- evidence that the parent markdown export updates only after the latest nested line-break-bearing state is safely incorporated
- evidence showing what happens in the transient trailing-break state: safe publication, explicit deferral, or fail-closed behavior

### Failure Conditions

- publication throws once a line-break node exists in the focused nested cell
- save or source-mode flush reaches the same crashing publication seam
- the design still depends on publishing a transient unsupported trailing-break state as if it were stable persisted content

## Critical Piece 2B: Event Ordering Around `Shift+Enter` Does Not Trigger Table Navigation Or Premature Publication

### Why This Piece Is Critical

`Shift+Enter` sits on top of several real event layers:

- Lexical key handling
- the table plugin's existing `KEY_ENTER_COMMAND`
- any wrapper-local interception
- outward nested publication

If the order is wrong, the editor can navigate cells instead of inserting a break, or publish an unstable nested state too early.

### What Must Be Proven

- `Shift+Enter` inserts a line break instead of triggering normal table Enter navigation
- plain `Enter` still follows the existing table behavior
- outward publication happens only after the nested editor state is safe to export
- no custom interception corrupts focus, selection, or the table plugin's unchanged plain-Enter behavior

### Required Proof

Add a focused interaction proof around the real event path.

Required cases:

- `Shift+Enter` in a focused table cell
- plain `Enter` in the same focused table cell
- `Shift+Enter`, then continued typing, then publication
- `Shift+Enter`, then save or source-mode request before blur

Preferred proof form:

1. browser-level or real editor-harness execution of the actual key events
2. paired with assertions about which cell remains focused and what markdown becomes observable afterward

### Convincing Evidence

- evidence that `Shift+Enter` no longer moves focus into another cell or row
- evidence that plain `Enter` behavior remains unchanged
- evidence that publication follows a stable post-insertion state rather than the pre-commit keydown phase

### Failure Conditions

- `Shift+Enter` still triggers normal table navigation
- custom key handling depends on brittle event-phase timing
- the product can only appear correct after blur or mode switching repairs the state

## Critical Piece 3: Canonical Export Can Become the Only Trusted Save Payload

Status: complete

### Why This Piece Is Critical

The plan explicitly rejects fallback to outer draft state while live rich-text state exists.

If canonical export cannot become the sole trusted payload for save, the design remains vulnerable to stale saves.

### What Must Be Proven

- the rich editor can expose a reliable `flushPendingEdits()` plus `getCanonicalMarkdown()` contract
- the returned markdown includes focused nested edits that have not yet blurred
- save can fail closed if canonical export cannot be produced

### Required Proof

Build a save-focused test or harness proving that the saved payload differs from stale outer draft state when necessary and always matches canonical export.

Required cases:

- save while actively focused inside an edited table cell
- save immediately after repeated in-cell edits
- save after legacy break variants were normalized
- save failure path when flush or canonical export throws or rejects

### Convincing Evidence

- assertions that the persisted payload equals canonical export, not merely current draft state
- assertions that save is blocked and error surfaced when canonical export is unavailable
- assertions that post-save baseline uses canonical saved content

### Failure Conditions

- persisted content can still come from stale outer draft state
- save proceeds after export failure
- canonical export diverges from what source mode or dirty tracking sees

## Critical Piece 4: Source-Mode Transitions Can Be Made Reliable Without Focus Regressions

Status: complete

### Why This Piece Is Critical

The source-mode transition is the most delicate async UI boundary in the plan.

It must flush nested state, canonicalize markdown, update editor state, switch modes, and preserve usability.

### What Must Be Proven

- the source-mode toggle can be intercepted before direct `viewMode$` mutation commits the transition
- canonical markdown can be pushed back into editor state before entering source mode
- focus, selection, and scroll behavior remain stable enough to be acceptable
- failure paths leave the user in a coherent rich-text state

### Required Proof

Build a narrow source-mode transition harness or editor test around the real toggle path.

Required cases:

- switch from rich-text to source mode while caret remains in an edited table cell
- switch after multiple consecutive internal line breaks
- switch when trailing in-cell breaks must be stripped
- failure path where flush or export is forced to fail

### Convincing Evidence

- assertions that source mode shows canonical `<br />` tags, not raw newline variants
- assertions that focus lands in a predictable and usable target after success
- assertions that failure leaves mode unchanged and preserves selection when possible

### Failure Conditions

- mode changes before canonicalization is applied
- source mode shows stale or non-canonical content
- focus or selection becomes erratic enough to undermine the feature

## Critical Piece 5: Viewer Rendering Stays Structurally Scoped To Table Cells

Status: complete

### Why This Piece Is Critical

The plan promises that `<br />` is rendered as a visual line break only inside markdown table cells and remains literal elsewhere.

If rendering is not structurally scoped, the feature risks rewriting content it should not touch.

### What Must Be Proven

- rendering logic can detect table-cell context structurally, not by raw string inspection
- canonical `<br />` inside table cells becomes a visual line break
- literal `<br />` outside table cells remains literal
- inline code and other nested content remain intact

### Required Proof

Add viewer-level tests around the exact remark and rendering pipeline the final feature will use.

Required cases:

- canonical `<br />` inside table cells
- literal `<br />` outside tables
- inline code containing `<br />` inside a table cell
- mixed formatting inside a table cell around breaks

### Convincing Evidence

- DOM assertions proving that table cells render visual breaks
- DOM assertions proving that non-table markdown is unchanged
- no recursive child rewriting or raw string heuristics required

### Failure Conditions

- rendering transforms non-table content
- inline code or nested inline content is rewritten incorrectly
- the transform relies on non-structural string matching

## Critical Piece 6: Canonical Initialization Prevents False Dirty States

Status: complete

### Why This Piece Is Critical

The plan now requires normalization on viewer load and canonical seeding of edit-mode baseline and draft state.

If initialization is inconsistent, users can enter edit mode on legacy content and immediately appear dirty even before making an intentional edit.

### What Must Be Proven

- loaded legacy content is canonicalized consistently before dirty tracking compares values
- edit baseline and rich-editor input are seeded from the same canonical content
- first nested publication does not create a false dirty state on untouched legacy content

### Required Proof

Create initialization-focused tests around viewer load plus enter-edit behavior.

Required cases:

- legacy `<br>` variants in tables
- numeric newline character references in tables
- canonical content that should remain pristine

### Convincing Evidence

- assertions that entering edit mode on legacy content does not immediately enable save or mark unsaved changes
- assertions that the first no-op publication keeps dirty state false
- assertions that actual edits still mark the session dirty promptly

### Failure Conditions

- untouched legacy content becomes dirty on entry or first publication
- baseline and draft state diverge before user edits

## Suggested Proof Order

1. Completed: structural GFM table normalization for valid raw pipe-table markdown.
2. Completed: literal in-cell line breaks are canonicalized before pipe-table stringification.
3. Completed: focused nested publication without blur.
4. Completed: canonical export as the sole save payload.
5. Completed: source-mode transition reliability.
6. Completed: viewer rendering scope.
7. Completed: canonical initialization and no false dirty state.

This order matters because later pieces depend on earlier ones.

## Proof Review Checklist

Before implementation starts, review each proof and confirm:

- the proof exercised the real library path, not a stand-in abstraction
- the pass condition is explicit and automated where possible
- the main failure modes were tested, not just the happy path
- the evidence is saved in tests, fixtures, or a documented harness
- the proof increases confidence in the exact design we plan to ship

## Go / No-Go Rule

Go only if all critical pieces are proven.

No-go if any proof shows:

- AST normalization is not structurally safe enough
- literal in-cell line breaks cannot be canonicalized before raw pipe-table stringification
- focused nested publication is not reliably awaitable
- canonical export cannot fully replace stale outer draft state
- source-mode transitions cannot be stabilized without unacceptable UX regressions
- viewer rendering cannot stay structurally scoped to table cells
- canonical initialization cannot prevent false dirty states
