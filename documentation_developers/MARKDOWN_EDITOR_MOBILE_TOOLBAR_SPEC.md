# Markdown Editor Mobile Toolbar Spec

## Purpose

This document defines the mobile-toolbar redesign for the rich-text markdown editor.

The current editor toolbar is desktop-sized and remains a single horizontally scrolling strip on small screens. This creates poor mobile ergonomics, weak discoverability, and unnecessary command density.

This spec defines a mobile-specific toolbar model that preserves core editing speed while moving lower-frequency commands into overflow.

## Problem Statement

The rich-text markdown editor toolbar in [frontend/src/components/Viewer/MarkdownRichEditor.tsx](frontend/src/components/Viewer/MarkdownRichEditor.tsx) currently:

- renders the full desktop command set on all screen sizes,
- keeps all commands visible at once,
- forces a single-row toolbar with horizontal scrolling,
- mixes frequent and infrequent actions together,
- risks small effective tap areas if the toolbar is compressed to fit mobile.

This is the wrong mobile pattern for an editor toolbar.

## Research Basis

This spec follows the product direction supported by current platform guidance:

- Material 3 app bars should focus on the current context and only a small number of essential actions.
- Apple Human Interface Guidelines recommend avoiding overcrowded toolbars, prioritizing the most important items, and moving secondary actions into a More menu as width shrinks.
- WCAG guidance recommends targets of at least `44 x 44` CSS pixels for touch interactions, especially for frequent actions.

These sources all favor prioritization and overflow over default horizontal scrolling.

## Scope

This spec covers only the inner MDX rich-text editor toolbar used in markdown edit mode.

It does not redefine:

- the outer viewer toolbar in [frontend/src/components/Viewer/ViewerControls.tsx](frontend/src/components/Viewer/ViewerControls.tsx),
- markdown search behavior,
- desktop toolbar behavior,
- keyboard shortcut behavior,
- source/diff editor internals,
- general viewer layout outside the editor toolbar.

## Product Decision

Mobile uses a compact primary toolbar plus an overflow menu.

### Core rules

- Mobile must not default to a horizontally scrolling rich-text toolbar.
- Mobile must not attempt to fit the full desktop command set by shrinking controls below comfortable touch size.
- The most common commands remain directly visible.
- Less common commands move into a single overflow menu.
- Switching between rich-text, diff, and source is secondary on mobile and should live in the overflow menu.

## Goals

- Eliminate default horizontal panning for the markdown editor toolbar on mobile.
- Preserve one-tap access to the most common editing actions.
- Keep touch targets comfortably tappable.
- Reduce visual clutter and improve command discoverability.
- Keep desktop behavior unchanged.
- Keep source and diff mode accessible without dedicating scarce primary-toolbar space to them.

## Non-Goals

- Redesigning the desktop editor toolbar.
- Redesigning the outer viewer header.
- Introducing a fully customizable toolbar.
- Hiding toolbar actions behind multiple nested menus.
- Removing any existing editing capability.
- Changing the markdown search UI.

## Breakpoint Rule

The mobile toolbar behavior must apply at the same breakpoint family already used by the viewer components:

- `theme.breakpoints.down("sm")`

This keeps the editor aligned with the existing mobile behavior in [frontend/src/components/Viewer/ViewerControls.tsx](frontend/src/components/Viewer/ViewerControls.tsx).

## Target Experience

### Rich-text mode on mobile

When the user edits markdown on a small screen:

- the editor toolbar fits within the viewport width,
- the toolbar does not require horizontal scrolling for common actions,
- high-frequency actions are always visible,
- secondary insert and formatting actions are available from a single More button,
- mode switching remains reachable from the More menu,
- all visible controls remain large enough for touch use.

### Source and diff modes on mobile

When the editor is in source or diff mode:

- the mode switch remains reachable from the same overflow affordance,
- rich-text-only controls are not shown,
- the toolbar remains visually compact,
- the toolbar still fits the viewport without horizontal scrolling.

### Placement relative to the main app bar

On mobile, the editor toolbar should render as a full-width secondary bar directly below the main viewer app bar.

Rules:

- the main viewer app bar remains the primary navigation and file-context surface,
- the editor toolbar becomes a dedicated formatting surface,
- the editor toolbar spans the full available content width,
- the editor toolbar should visually read as attached to the app bar stack rather than as a floating inline strip,
- the editor content begins below this secondary toolbar.

This gives the editor toolbar enough horizontal room, preserves a stable location, and cleanly separates document-level actions from editing actions.

## Toolbar Model

## 1. Visible primary actions on mobile

The mobile rich-text toolbar must show only the following actions directly:

- Undo
- Redo
- Bold
- Italic
- More actions

Optional candidate if width permits after implementation review:

- Lists toggle

### Rationale

- Undo and redo are frequent and low-friction recovery tools.
- Bold and italic are the most common inline formatting actions.
- More actions provides access to the rest of the toolset without crowding the bar.
- Lists are common, but they are not common enough to justify crowding the primary row if width becomes tight.
- Mode switching is important but secondary; it should remain easy to reach without consuming scarce first-row space.

## 2. Overflow menu contents on mobile

The More menu must contain the lower-frequency actions that are currently always visible on desktop.

Initial mobile overflow contents:

- Rich-text / diff / source mode toggle
- Block type / heading selection
- Lists toggle
- Inline code
- Create link
- Insert table
- Insert thematic break
- Insert code block

### Ordering

Overflow items must be ordered by likely frequency and conceptual grouping:

1. Lists toggle
2. Block type / heading selection
3. Create link
4. Inline code
5. Rich-text / diff / source mode toggle
6. Insert table
7. Insert thematic break
8. Insert code block

This keeps common editing actions near the top, retains mode switching in an easy-to-find place, and pushes structural insertion actions lower.

## 3. Desktop behavior

Desktop keeps the existing full toolbar composition.

This spec does not reduce desktop capability or require overflow behavior on larger screens.

## UX Rules

## 1. No default horizontal scrolling on mobile

For mobile toolbar mode:

- the rich-text action cluster must fit without requiring horizontal scroll,
- `overflowX: auto` must not be the primary mobile layout strategy,
- horizontal scroll may remain as a defensive fallback only if an unexpected width regression occurs.
- full-width toolbar placement below the main app bar is the preferred way to maximize available width before any fallback is considered.

## 2. Touch target requirements

- Every tappable primary toolbar action must retain at least a `44 x 44` CSS pixel target area.
- Dense icon-only buttons are acceptable only if their actual tappable area still meets that minimum.
- The More button must meet the same target size requirement.

## 3. Grouping rules

The mobile toolbar must preserve a small number of stable groups:

- editing history group,
- primary formatting group,
- overflow group.

The visual result should read as a maximum of three logical groups.

## 4. Overflow menu behavior

- The More button opens a single menu or action sheet.
- Menu items must include both icon and text label where practical.
- Selecting an action triggers it immediately and closes the menu.
- Disabled actions must remain visible if they can become available in the current session, but they must be clearly disabled.
- The menu must not contain nested submenus.

## 5. Rich-text mode switch behavior

- The mode switch moves into the More menu on mobile.
- The mode-switch action must be clearly labeled inside that menu.
- Switching out of rich-text mode hides rich-text-only controls, consistent with current behavior.
- When in source or diff mode, the same overflow affordance must still provide a path back to rich-text mode.

## 6. Focus and accessibility

- Toolbar buttons must keep meaningful `aria-label` values.
- Overflow menu items must have readable labels, not icon-only meaning.
- Keyboard access on non-touch devices must continue to work.
- The overflow trigger must expose expanded/collapsed state correctly.

## Architectural Decision

The toolbar must branch by screen size at composition time, not by CSS alone.

### Why

The current toolbar problem is primarily command density, not only spacing.

Pure CSS changes such as:

- smaller gaps,
- smaller icons,
- wrapping,
- reduced padding,

do not solve the underlying issue that too many commands are shown simultaneously on mobile.

The mobile solution must therefore use a different toolbar composition.

## Required Implementation Model

## 1. Toolbar composition branching

The toolbar contents in [frontend/src/components/Viewer/MarkdownRichEditor.tsx](frontend/src/components/Viewer/MarkdownRichEditor.tsx) must branch on a mobile breakpoint.

Preferred model:

- define a shared desktop toolbar contents component,
- define a separate mobile toolbar contents component,
- select one at render time using `useMediaQuery(theme.breakpoints.down("sm"))`.

This approach is preferred over deeply nested conditional JSX inside one toolbar body.

## 2. Mobile overflow state

The mobile toolbar will need local UI state for the More menu.

Expected state shape:

- overflow anchor element or open/close state,
- handlers for open and close,
- direct callbacks that call the existing command bridges.

The commands themselves must continue to use the existing editor command bridge.

## 3. Existing command bridges remain the source of truth

The following existing command paths should remain in place:

- undo/redo through the active editor,
- formatting via `applyFormat$`,
- insert actions through the current command bridge,
- mode switching via `DiffSourceToggleWrapper`.

This spec changes surface composition, not editor command ownership.

## 4. Toolbar placement remains a stacked-bar layout

The mobile editor toolbar should remain a separate secondary surface below the main viewer app bar, not an inline row embedded inside the editor body.

### Why

- it matches the distinction between document actions and editing actions,
- it gives the toolbar the full viewport width,
- it keeps the control location stable while the editor content scrolls,
- it avoids competing with the content area for horizontal space.

## Detailed Behavior

## 1. Mobile rich-text toolbar layout

The mobile rich-text toolbar should render in this logical order:

1. Undo
2. Redo
3. Bold
4. Italic
5. More actions trigger

If implementation review shows that the row still has comfortable width and target sizes on the narrowest supported viewport, `Lists toggle` may be promoted into the primary row after `Italic`.

## 2. Overflow actions

Each overflow item must call the same implementation path used by the current desktop toolbar.

Examples:

- Block type must invoke the same heading/block behavior as the desktop block selector.
- Lists toggle in overflow must invoke the same list behavior as the desktop toolbar.
- Create link must invoke the existing link dialog.
- Insert table must invoke the existing insert-table command.
- Insert code block must invoke the existing insert-code-block command.
- Mode switching in overflow must invoke the same rich-text/source/diff behavior used by the current toolbar.

No duplicate command implementations should be introduced.

## 3. Source and diff modes

The mobile source and diff toolbar should remain compact.

The preferred behavior is:

- keep the same overflow trigger available,
- do not render the rich-text primary formatting actions,
- keep mode-switching actions inside overflow,
- do not render the More actions trigger only if it would truly contain no relevant actions in that mode.

## 4. Wrapping policy

The toolbar should not wrap into multiple unpredictable rows as the primary solution.

Reason:

- wrapping makes action positions unstable,
- wrapping weakens muscle memory,
- wrapping often produces awkward interaction near the mode switch,
- wrapping still keeps too many actions visible.

## Acceptance Criteria

The implementation is acceptable only if all of the following are true on mobile viewport widths:

- the rich-text markdown toolbar fits without default horizontal scrolling,
- the toolbar exposes undo, redo, bold, italic, and More directly,
- block type, lists, inline code, link, mode switching, table, thematic break, and code block remain reachable through one overflow surface,
- the toolbar renders as a full-width secondary bar directly below the main app bar,
- primary buttons remain comfortably tappable,
- desktop retains the current full toolbar,
- source and diff modes remain accessible.

## File-Level Plan

## Frontend files to change

### [frontend/src/components/Viewer/MarkdownRichEditor.tsx](frontend/src/components/Viewer/MarkdownRichEditor.tsx)

- Add screen-size detection for mobile toolbar composition.
- Extract current toolbar contents into clearer desktop and mobile render paths.
- Add mobile More-menu state and trigger.
- Remove mobile dependence on the current always-visible full toolbar layout.
- Update toolbar container styling so mobile is not designed around horizontal scroll.
- Ensure the mobile editor toolbar renders as a full-width stacked secondary bar below the main viewer app bar.

### [frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx](frontend/src/components/Viewer/__tests__/MarkdownRichEditor.test.tsx)

- Add tests for mobile toolbar composition.
- Verify primary mobile actions are visible.
- Verify secondary actions move into overflow.
- Verify mode switching is reachable through overflow on mobile.
- Verify desktop still renders the full toolbar.

## Optional extraction files

If [frontend/src/components/Viewer/MarkdownRichEditor.tsx](frontend/src/components/Viewer/MarkdownRichEditor.tsx) becomes too large, it is acceptable to extract mobile toolbar helpers into a dedicated local file under the same folder.

Any extraction must keep command ownership and behavior unchanged.

## Test Plan

Minimum validation:

1. Focused component tests for mobile and desktop toolbar variants.
2. Frontend type check.
3. Frontend lint.

Recommended assertions:

- mobile toolbar does not expose table and code-block buttons directly,
- mobile toolbar exposes a More trigger,
- opening More reveals secondary actions,
- opening More reveals mode-switch actions,
- selecting an overflow action calls the existing command path,
- desktop still exposes the current direct actions.

## Open Questions

These do not block implementation, but should be resolved during polish if needed:

- Whether the mobile overflow should use a standard anchored menu or a bottom sheet.
- Whether lists should remain in overflow or be promoted into the primary row after device testing.
- Whether the source/diff actions inside overflow should be grouped under a single submenu-like row or rendered as direct menu items.

## Recommended Implementation Order

1. Add mobile toolbar composition branching.
2. Add the More trigger and overflow items.
3. Keep the mode switch visible and verify rich-text/source/diff behavior.
4. Tighten mobile toolbar styling only after the composition change is complete.
5. Add regression tests.
