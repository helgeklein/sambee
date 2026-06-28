# Markdown Table Controls Reserved Gutter Implementation Plan

## Purpose

This document defines a concrete implementation proposal for markdown table controls that remain usable on all supported screen sizes without relying on collision-prone edge overflow.

This is a pre-implementation planning document. It is intended to be reviewed before any code changes are made.

## Requested Outcome

- Table row, column, and table-level controls remain visually adjacent to the table edges.
- Controls never depend on available page margin outside the editor content area.
- Controls remain reachable on narrow viewports and when a table is flush against the content boundary.
- Keyboard navigation inside the table and between tables, code blocks, and surrounding markdown remains unchanged.
- The implementation does not reintroduce a fake visible first column or disturb table content alignment.

## Current State

Current markdown table control styling is owned in:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Current validation surface exists in:

- [frontend/e2e/markdown-viewer.spec.ts](../frontend/e2e/markdown-viewer.spec.ts)

Current behavior:

- MDXEditor renders structural table tool cells inside the table DOM.
- The current implementation collapses those structural cells to zero width and repositions their buttons outside the table with absolute positioning.
- Left and right controls currently rely on rendering beyond the table boundary.
- When the table sits at or near the content edge, the controls either clip, overlap the content boundary, or require ad hoc overflow overrides.
- The current CSS approach is visually close to the target design, but it is brittle because visibility depends on spare space outside the content column.

## Design Decision

Adopt a reserved interaction gutter around each editable markdown table block.

This means:

- the table keeps its visual border and content geometry
- the controls render inside explicit surrounding rails owned by the table block
- the editor no longer needs to guess whether left or right overflow space exists

This is preferred over collision-aware runtime placement for this surface because:

- the controls are persistent structural affordances, not transient popovers
- the surrounding editor already has complex nested focus and keyboard behavior
- a deterministic layout solution is easier to test and maintain than per-frame measurement and flip logic

## Proposed UX Model

### Layout

Each table block gets four invisible control rails:

- left rail for row menu buttons
- top rail for column controls
- right rail for add-column and table-level destructive affordances
- bottom rail for add-row controls

Target rail sizes:

- left rail: `MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
- right rail: `MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
- top rail: `MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
- bottom rail: `MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`

No extra gap should exist between the rail and the table border. Controls should appear immediately adjacent to the table edge, as they do now when space allows.

### Visibility

- Rails remain visually empty by default.
- Control buttons appear when the table is hovered or contains focus.
- A hovered or focused control remains visible even if the pointer briefly leaves the table border and travels within the reserved rail.
- Controls must remain keyboard reachable when focus enters them.

### Responsive behavior

- Narrow screens use the same rail model rather than flipping controls inside the table.
- If the available editor width becomes too small for a full left and right rail plus table content, horizontal scrolling is acceptable for the table block itself.
- The table content should not collapse or shift independently just to fit the controls.

## Proposed DOM Ownership

The reserved gutter should be owned by the table decorator wrapper, not the full editor content area.

Recommended host:

- the nearest `[data-lexical-decorator='true']` element that wraps the table block

Rationale:

- this keeps the gutter local to each table block
- it avoids moving unrelated markdown paragraphs, lists, and code blocks
- it aligns with the existing navigation code, which already treats the decorator wrapper as the table block boundary

## Concrete Implementation Plan

### Phase 1: Introduce a wrapper-owned table frame

Create a local layout frame around each markdown table decorator block.

Recommended styling shape:

- table decorator wrapper becomes `position: relative`
- wrapper becomes `display: inline-block` or `display: inline-flex` depending on the DOM behavior verified in-browser
- wrapper gets padding equal to the reserved rails:
  - `padding-left: MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
  - `padding-right: MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
  - `padding-top: MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
  - `padding-bottom: MARKDOWN_TABLE_TOOL_BUTTON_SIZE_PX`
- wrapper width remains content-based rather than stretching to the full editor width

Important constraint:

- the wrapper must reserve the interaction space without altering the visual alignment of the table content relative to other markdown blocks

The table itself should remain visually located where it is today, but the reserved rails become part of its block box.

### Phase 2: Stop collapsing all control geometry to pure overflow

Update the current table control CSS so controls anchor inside the reserved rails rather than outside the table block.

Recommended changes:

- keep the structural MDXEditor tool cells visually collapsed from the perspective of table content layout
- anchor body left buttons at the inner edge of the left rail, not outside the wrapper
- anchor right-side add-column controls at the inner edge of the right rail
- anchor header and footer controls within the top and bottom rails
- destructive table action in the top-right corner should live in the right/top rail junction instead of escaping beyond the wrapper

Net effect:

- controls continue to look edge-adjacent
- no control depends on external page margin
- no control needs content-container `overflow-x: visible` hacks to be visible

### Phase 3: Remove editor-level overflow compensations

After the wrapper-owned rails are working:

- remove any contenteditable overflow overrides that were introduced only to reveal left controls
- keep overflow behavior as local as possible to the table block wrapper
- verify that non-table markdown content remains unaffected

### Phase 4: Harden pointer and focus behavior

Ensure hover and focus behavior is owned by the wrapper frame, not only by the table element.

Recommended visibility selector direction:

- controls become visible on wrapper `:hover` and wrapper `:focus-within`
- controls stay visible on control `:hover` and `:focus-visible`

This prevents a hover gap between the table edge and the control while also keeping interaction local.

## Implementation Seams

### Styling seam

Primary implementation surface:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Expected work:

- introduce constants for rail sizing if the existing button-size constant is not sufficient on its own
- add wrapper selectors for the table decorator block
- retarget current button positioning selectors from table-edge overflow to wrapper rail placement
- simplify or remove compensating overflow rules introduced during the current exploratory pass

### Accessibility seam

The current row and column triggers should be treated as proper menu buttons.

Minimum requirements:

- preserve `button` semantics
- preserve or add `aria-label` where missing
- expose `aria-haspopup="menu"` and `aria-expanded` consistently if not already handled by MDXEditor
- ensure visibility does not depend on hover alone; focused controls must also reveal themselves

### Navigation seam

Existing keyboard movement logic must not be reopened as part of this layout change.

Relevant file:

- [frontend/src/components/Viewer/MarkdownRichEditor.tsx](../frontend/src/components/Viewer/MarkdownRichEditor.tsx)

Constraint:

- the reserved gutter must not change the logical block boundary assumptions used by table and code-block arrow navigation

## Validation Plan

### Existing regression checks to keep

Run the focused editor navigation command after each substantive table-control layout change:

```bash
cd /workspace/frontend && npx playwright test e2e/markdown-viewer.spec.ts -g "moves ArrowDown to the cell below when the caret is at the bottom of a cell|moves ArrowUp selection out of a code block after returning from the adjacent table"
```

### New browser behavior checks to add

Add focused coverage for reserved-gutter behavior in:

- [frontend/e2e/markdown-viewer.spec.ts](../frontend/e2e/markdown-viewer.spec.ts)

Required scenarios:

- left row controls are visible and reachable when the table is flush with the left content edge
- right controls are visible and reachable when the table is near the right content edge
- controls remain visible while moving the pointer from the table body into the control rail
- top and bottom controls remain immediately adjacent to the table border
- table content width and cell alignment do not visibly shift when controls become visible

### Manual validation

Validate on the demo route at multiple viewport widths:

- wide desktop
- medium editor width where the table nearly fills the content area
- narrow width where left and right rails compete most strongly with content width

## Acceptance Criteria

- No table control requires spare page margin outside the editor content area.
- Left, right, top, and bottom controls are all immediately adjacent to the table border.
- No fake first column or extra visible table column appears.
- The surrounding markdown content does not shift when controls appear.
- Controls remain reachable by both pointer and keyboard.
- Existing focused table/code-block navigation regressions continue to pass.

## Out of Scope

- Collision-aware dynamic flipping of controls between inside and outside positions
- Replacing edge controls with a single floating contextual toolbar
- Reworking MDXEditor upstream DOM structure
- Revisiting code-block or non-table editor controls

## Recommended Execution Order

1. Add a wrapper-owned reserved rail around the table decorator block.
2. Re-anchor all four control families into those rails.
3. Remove editor-content overflow compensations.
4. Add focused Playwright coverage for left/right visibility and hover reachability.
5. Run the existing keyboard regression slice plus the new control-specific tests.

## Recommendation

Proceed with the reserved-gutter design as the default implementation path.

It is the simplest approach that satisfies the layout requirement across screen sizes without reintroducing fragile page-edge overflow dependencies or adding runtime positioning complexity.
