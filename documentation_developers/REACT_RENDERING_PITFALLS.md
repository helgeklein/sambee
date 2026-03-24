# React Rendering Pitfalls

Known React rendering pitfalls encountered in this codebase, with prevention
rules and audit commands.

---

## Mid-Event Re-Render: First Click Swallowed (March 2026)

### Symptom

Clicking links in the Markdown viewer did nothing on the first click when the
viewer was opened via keyboard. The second click worked fine. Opening via mouse
click was unaffected.

### Root Cause

Four layers combined to produce the bug:

1. **Global capture-phase `pointerdown` handler** in `FileBrowser.tsx` called
   `setIsUsingKeyboard(false)` synchronously.
2. **React 18 SyncLane scheduling** — `pointerdown` is a discrete event, so the
   state update gets SyncLane priority and React flushes it via `queueMicrotask`
   — which runs between `pointerdown` and `click`.
3. **`DynamicViewer` was not memoized** — the microtask re-render cascaded
   through the entire viewer tree.
4. **react-markdown's `passNode: true`** injected a `node` prop that was spread
   onto native `<a>` elements via `{...props}`, causing DOM mutations
   (`setAttribute`) on the click target mid-event — making the browser lose the
   click.

### Why Keyboard-Only

After a keyboard open, `isUsingKeyboard` is `true`. The first pointer
interaction triggers a state change (`true` → `false`) and the destructive
re-render. After a mouse open, the opening click already set it to `false`, so
no state change occurs on subsequent clicks.

### Fix Applied

1. Deferred `setIsUsingKeyboard(false)` with `requestAnimationFrame` in
   `FileBrowser.tsx` so the state update no longer runs between `pointerdown`
   and `click`.
2. Wrapped `DynamicViewer` in `React.memo` so unrelated parent state changes
   don't cascade into the viewer portal tree.
3. Destructured `node: _node` out of react-markdown component override props to
   prevent it from leaking onto native DOM elements.

---

## Prevention Rules

### 1. Defer state updates in capture-phase native event handlers

Any `setState` in a capture-phase `pointerdown` or `mousedown` handler triggers
a SyncLane microtask flush mid-event. Use `requestAnimationFrame` to defer
unless a synchronous update is strictly required.

```tsx
// BAD — triggers SyncLane flush between pointerdown and click
document.addEventListener('pointerdown', () => {
  setIsUsingKeyboard(false);
}, { capture: true });

// GOOD — deferred past the click event
document.addEventListener('pointerdown', () => {
  rafId = requestAnimationFrame(() => {
    setIsUsingKeyboard(false);
  });
}, { capture: true });
```

### 2. Memoize portal-rendered components

Components rendered into MUI `Dialog` / `Modal` / `Popover` portals should be
wrapped in `React.memo` to prevent unrelated parent state changes from
triggering cascading re-renders in the portal tree.

Currently memoized: `DynamicViewer`, `ImageViewer`, `MarkdownViewer`,
`PDFViewer`.

### 3. Never spread third-party props onto DOM elements

When using react-markdown `components` overrides (or similar libraries that
inject extra props), always destructure library-injected props before spreading
the rest:

```tsx
// GOOD — `node` stays out of the DOM
a: ({ href, node: _node, ...props }) => <a {...props} href={href} />

// BAD — `node` leaks onto the native <a> element, causing DOM mutations
a: ({ ...props }) => <a {...props} />
```

---

## Audit Commands

Run these periodically or when debugging similar click/interaction issues:

```bash
# Find capture-phase event handlers that might call setState
grep -rn 'addEventListener.*capture' frontend/src/

# Find prop spreading in viewer components
grep -rn '\.\.\.props' frontend/src/components/Viewer/

# Verify all Dialog/Modal children are memoized
grep -rn 'React\.memo\|memo(' frontend/src/components/Viewer/
grep -rn 'React\.memo\|memo(' frontend/src/components/FileBrowser/DynamicViewer.tsx
```
