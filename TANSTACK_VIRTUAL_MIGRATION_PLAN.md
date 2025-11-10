# TanStack Virtual Migration Plan

**Branch**: `Scroll-flickering-with-TanStack`  
**Date**: November 10, 2025  
**Goal**: Smooth, flicker-free scrolling with minimal CPU load for very long lists

## Success Criteria

- ✅ Scrolling by pressing-and-holding arrow down key is visually impeccable and flicker-free
- ✅ CPU load during sustained scrolling is minimal (<10%)
- ✅ 60fps performance maintained even with 100,000+ items
- ✅ Excellent keyboard navigation responsiveness

---

## Current State Analysis

### Technology Stack
- **Current**: `react-window` v2.2.2 with custom `FixedSizeList` component
- **Target**: `@tanstack/react-virtual`

### Key Components
- **Row height**: 68px (constant)
- **Custom keyboard navigation** with sophisticated focus management
- **Focus overlay** for visual selection feedback (positioned via transforms)
- **Viewport tracking** for optimized scroll alignment
- **Scroll synchronization** logic to prevent flickering

### Identified Challenges
1. Complex coordination between focus state, scroll position, and overlay positioning
2. Multiple RAF (requestAnimationFrame) queues for throttling updates
3. Manual viewport range tracking (`viewportRangeRef`)
4. Synchronization issues between keyboard events and scroll behavior

---

## Migration Strategy

### Phase 1: Preparation & Dependencies ⏱️ ~30 minutes

**1.1 Install TanStack Virtual**
```bash
npm install @tanstack/react-virtual
npm uninstall react-window @types/react-window
```

**1.2 Update test mocks**
- Create new mock for `@tanstack/react-virtual` in `/frontend/src/__mocks__/@tanstack/`
- Remove old `react-window.tsx` mock

**1.3 Review TanStack Virtual API**
Key differences to understand:
- `useVirtualizer` hook replaces component-based approach
- Virtual items expose `index`, `start`, `size`, `end`, `key`
- Built-in `scrollToIndex` with better alignment options
- Native overscan support for smoother scrolling

---

### Phase 2: Core Virtualization Migration ⏱️ ~2-3 hours

**2.1 Replace react-window with TanStack Virtual**

**Key changes:**
```tsx
// OLD
import { List as FixedSizeList } from "react-window";
const virtualListRef = React.useRef<ListRef>(null);

// NEW
import { useVirtualizer } from '@tanstack/react-virtual';
const parentRef = React.useRef<HTMLDivElement>(null);
```

**2.2 Implement useVirtualizer hook**

```tsx
const rowVirtualizer = useVirtualizer({
  count: sortedAndFilteredFiles.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => ROW_HEIGHT, // 68px
  overscan: 5, // Render 5 extra items above/below viewport
  // Enable smooth scrolling behavior
  scrollMargin: 0,
  // Optimize for keyboard navigation
  measureElement:
    typeof window !== 'undefined' && navigator.userAgent.includes('Firefox')
      ? undefined
      : (element) => element.getBoundingClientRect().height,
});
```

**2.3 Refactor row rendering**

Transform from `FixedSizeList` component pattern to manual rendering:

```tsx
// OLD - Component-based
<FixedSizeList
  listRef={virtualListRef}
  rowComponent={RowComponent}
  rowCount={sortedAndFilteredFiles.length}
  rowHeight={68}
  rowProps={rowProps}
/>

// NEW - Hook-based
<div
  ref={parentRef}
  style={{
    height: '100%',
    overflow: 'auto',
    contain: 'strict',
  }}
>
  <div
    style={{
      height: `${rowVirtualizer.getTotalSize()}px`,
      width: '100%',
      position: 'relative',
    }}
  >
    {rowVirtualizer.getVirtualItems().map((virtualItem) => (
      <div
        key={virtualItem.key}
        data-index={virtualItem.index}
        ref={rowVirtualizer.measureElement}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualItem.size}px`,
          transform: `translateY(${virtualItem.start}px)`,
        }}
      >
        {/* Render file row content */}
        <FileRow
          file={sortedAndFilteredFiles[virtualItem.index]}
          index={virtualItem.index}
          isSelected={virtualItem.index === focusedIndex}
          onClick={handleFileClick}
        />
      </div>
    ))}
  </div>
</div>
```

---

### Phase 3: Keyboard Navigation Optimization ⏱️ ~2-3 hours

**3.1 Replace scrollToRow with scrollToIndex**

TanStack Virtual provides superior scroll alignment:

```tsx
// OLD
virtualListRef.current.scrollToRow({
  index: focusedIndex,
  align: 'end',
  behavior: 'instant',
});

// NEW
rowVirtualizer.scrollToIndex(focusedIndex, {
  align: 'end',
  behavior: 'instant', // or 'smooth' | 'auto'
});
```

**3.2 Simplify viewport tracking**

Remove manual `viewportRangeRef` tracking - TanStack provides this:

```tsx
// OLD - Manual tracking
const viewportRangeRef = React.useRef({
  firstVisible: 0,
  lastVisible: visibleRowCountRef.current - 1,
  visibleCapacity: visibleRowCountRef.current,
});

// NEW - Use virtualizer state
const virtualItems = rowVirtualizer.getVirtualItems();
const firstVisible = virtualItems[0]?.index ?? 0;
const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? 0;
```

**3.3 Optimize ArrowUp/Down handlers**

Leverage TanStack's built-in smooth scrolling:

```tsx
case "ArrowDown": {
  e.preventDefault();
  const next = Math.min(focusedIndex + 1, fileCount - 1);
  if (next === focusedIndex) break;
  
  // Update focus
  setFocusedIndex(next);
  
  // TanStack handles intelligent scrolling automatically
  rowVirtualizer.scrollToIndex(next, {
    align: 'auto', // TanStack will choose best alignment
    behavior: e.repeat ? 'instant' : 'smooth',
  });
  break;
}
```

**3.4 Enhance PageUp/PageDown**

```tsx
case "PageDown": {
  e.preventDefault();
  const virtualItems = rowVirtualizer.getVirtualItems();
  const pageSize = virtualItems.length || 10;
  const next = Math.min(focusedIndex + pageSize, fileCount - 1);
  
  setFocusedIndex(next);
  rowVirtualizer.scrollToIndex(next, {
    align: 'end',
    behavior: 'instant',
  });
  break;
}
```

---

### Phase 4: Focus Overlay Refinement ⏱️ ~1-2 hours

**4.1 Sync overlay with TanStack virtual items**

```tsx
const updateFocusOverlay = React.useCallback(() => {
  const overlay = focusOverlayRef.current;
  if (!overlay || focusedIndex < 0) return;
  
  // Get virtual item for focused index
  const virtualItems = rowVirtualizer.getVirtualItems();
  const focusedVirtualItem = virtualItems.find(item => item.index === focusedIndex);
  
  if (!focusedVirtualItem) {
    // Item not in viewport
    overlay.style.opacity = '0';
    return;
  }
  
  // Position overlay using virtual item's start position
  overlay.style.opacity = '1';
  overlay.style.transform = `translateY(${focusedVirtualItem.start}px)`;
  overlay.style.height = `${focusedVirtualItem.size}px`;
}, [focusedIndex, rowVirtualizer]);
```

**4.2 Remove complex RAF coordination**

TanStack's rendering is already optimized, so we can simplify:

```tsx
// Remove these:
// - focusCommitRafRef
// - navThrottleRafRef  
// - pendingScrollRequestRef
// - skipNextLayoutScrollRef

// TanStack handles batching and optimization internally
```

---

### Phase 5: Performance Optimization ⏱️ ~1-2 hours

**5.1 Configure optimal overscan**

```tsx
const rowVirtualizer = useVirtualizer({
  // ... other config
  overscan: 5, // Start with 5, tune based on testing
  // Dynamic overscan for better keyboard navigation
  lanes: 1,
});
```

**5.2 Enable CSS containment**

```tsx
<div
  ref={parentRef}
  style={{
    height: '100%',
    overflow: 'auto',
    contain: 'strict', // Optimize layout/paint/style
    willChange: 'transform', // GPU acceleration hint
  }}
>
```

**5.3 Optimize row component with React.memo**

```tsx
const FileRow = React.memo(({ file, index, isSelected, onClick }: FileRowProps) => {
  // Row content
}, (prev, next) => {
  // Custom comparison for optimal re-renders
  return prev.index === next.index &&
         prev.isSelected === next.isSelected &&
         prev.file.name === next.file.name;
});
```

**5.4 Use measureElement only when needed**

```tsx
const rowVirtualizer = useVirtualizer({
  // ...
  measureElement:
    typeof window !== 'undefined' && 
    navigator.userAgent.includes('Firefox')
      ? undefined // Firefox has better default behavior
      : (element) => element.getBoundingClientRect().height,
});
```

---

### Phase 6: Testing & Validation ⏱️ ~2-3 hours

**6.1 Update test mocks**

Create `@tanstack/react-virtual` mock:

```tsx
// frontend/src/__mocks__/@tanstack/react-virtual.tsx
export const useVirtualizer = ({ count, estimateSize }: any) => ({
  getVirtualItems: () => 
    Array.from({ length: count }, (_, i) => ({
      index: i,
      key: i,
      start: i * estimateSize(),
      size: estimateSize(),
      end: (i + 1) * estimateSize(),
    })),
  getTotalSize: () => count * estimateSize(),
  scrollToIndex: vi.fn(),
  measureElement: vi.fn(),
});
```

**6.2 Update existing tests**

Fix tests in:
- `frontend/src/pages/__tests__/Browser-interactions.test.tsx`
- Update `data-testid="virtual-list"` references

**6.3 Manual testing checklist**

Test scenarios:
- [ ] Arrow up/down with key held - should be flicker-free
- [ ] PageUp/PageDown navigation - smooth and instant
- [ ] Home/End keys - jump to boundaries correctly
- [ ] Mouse scroll while using keyboard - no conflicts
- [ ] Very long lists (10,000+ items) - maintain 60fps
- [ ] Search filtering - virtualizer updates correctly
- [ ] Connection switching - proper cleanup/reset
- [ ] Browser back/forward - restore scroll position

**6.4 Performance metrics**

Monitor in Chrome DevTools:
- **FPS during arrow-hold**: Should maintain 60fps
- **CPU usage**: Should be <10% during scrolling
- **Memory**: No leaks during extended navigation
- **Layout thrashing**: Minimal forced reflows

---

### Phase 7: Cleanup & Documentation ⏱️ ~1 hour

**7.1 Remove obsolete code**

Delete:
- `viewportRangeRef` and related logic
- `pendingScrollRequestRef` 
- Multiple RAF throttling refs
- Manual viewport calculation functions
- Old `handleRowsRendered` callback

**7.2 Simplify state management**

```tsx
// Remove these refs (TanStack handles internally):
// - visibleRowCountRef
// - prevFocusedIndexRef (use effect dependencies)

// Keep essential refs:
// - parentRef (scroll container)
// - focusOverlayRef (visual feedback)
// - filesRef (stable file list reference)
```

**7.3 Update comments and documentation**

Add clear comments explaining:
- Why TanStack Virtual was chosen
- Configuration rationale (overscan, measureElement, etc.)
- Keyboard navigation behavior expectations

**7.4 Update CHANGE_NOTIFICATION.md**

Document the migration for future reference.

---

## Expected Outcomes

### Performance Improvements
- ✅ **60fps sustained scrolling** even with 100,000+ items
- ✅ **CPU usage reduction** from ~30-40% to <10% during arrow-hold
- ✅ **Zero flicker** during keyboard navigation
- ✅ **Instant responsiveness** - no perceptible lag

### Code Quality Improvements
- ✅ **~200-300 lines removed** (simplified state management)
- ✅ **Fewer refs and useEffects** (less complexity)
- ✅ **Better TypeScript types** (TanStack has excellent types)
- ✅ **More maintainable** (less custom scroll logic)

### User Experience Improvements
- ✅ **Smoother animations** during navigation
- ✅ **Better scroll alignment** (TanStack's auto mode is intelligent)
- ✅ **Accessible** (proper ARIA attributes maintained)
- ✅ **Responsive** to rapid keyboard input

---

## Risk Mitigation

**Risk 1: Breaking keyboard navigation**
- *Mitigation*: Implement feature flag to toggle between old/new implementations
- *Fallback*: Keep react-window code in a branch for quick rollback

**Risk 2: Performance regression on older browsers**
- *Mitigation*: Test on Firefox, Safari, older Chrome versions
- *Fallback*: Browser-specific overscan/measureElement configs

**Risk 3: Test failures**
- *Mitigation*: Update mocks incrementally, verify each test suite
- *Fallback*: Temporarily skip failing tests, fix progressively

**Risk 4: Focus overlay synchronization issues**
- *Mitigation*: Use TanStack's virtual item positions directly
- *Fallback*: Revert to manual calculation if needed

---

## Timeline Estimate

- **Phase 1** (Preparation): 30 minutes
- **Phase 2** (Core Migration): 2-3 hours
- **Phase 3** (Keyboard Navigation): 2-3 hours
- **Phase 4** (Focus Overlay): 1-2 hours
- **Phase 5** (Performance): 1-2 hours
- **Phase 6** (Testing): 2-3 hours
- **Phase 7** (Cleanup): 1 hour

**Total: 10-15 hours** (1.5-2 days of focused work)

---

## Progress Tracking

### Phase 1: Preparation & Dependencies ✅ COMPLETED
- [x] Plan stored in TANSTACK_VIRTUAL_MIGRATION_PLAN.md
- [x] Install @tanstack/react-virtual (v3.13.12)
- [x] Uninstall react-window and @types/react-window
- [x] Create new mock for @tanstack/react-virtual
- [x] Remove old react-window mock

### Phase 2: Core Virtualization Migration ✅ COMPLETED
- [x] Replace imports (react-window → @tanstack/react-virtual)
- [x] Implement useVirtualizer hook with proper configuration
- [x] Refactor row rendering from component-based to inline rendering
- [x] Remove old RowComponent and rowProps
- [x] Update all virtualListRef references to use parentRef
- [x] Replace scrollToRow calls with scrollToIndex
- [x] Fix dependency arrays in useEffect hooks
- [x] Remove unused code (handleRowsRendered, traceFocusWarn)
- [x] Verify build compiles successfully

### Phase 3: Keyboard Navigation Optimization
- [ ] Replace scrollToRow with scrollToIndex
- [ ] Simplify viewport tracking
- [ ] Optimize ArrowUp/Down handlers
- [ ] Enhance PageUp/PageDown

### Phase 4: Focus Overlay Refinement
- [ ] Sync overlay with TanStack virtual items
- [ ] Remove complex RAF coordination

### Phase 5: Performance Optimization
- [ ] Configure optimal overscan
- [ ] Enable CSS containment
- [ ] Optimize row component with React.memo
- [ ] Configure measureElement

### Phase 6: Testing & Validation
- [ ] Update test mocks
- [ ] Fix existing tests
- [ ] Manual testing
- [ ] Performance benchmarking

### Phase 7: Cleanup & Documentation
- [ ] Remove obsolete code
- [ ] Simplify state management
- [ ] Update comments
- [ ] Update CHANGE_NOTIFICATION.md
