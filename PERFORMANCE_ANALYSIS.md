# Performance Analysis: Arrow Key Navigation

## Problem Identified

While holding the arrow down key, the Browser component exhibits excessive re-rendering:

### Profiling Data (8 seconds of arrow key held)
```
170 component re-renders
~21 renders per second
~10 overlay updates (0.10ms each - fast)
1 slow layoutRead: 3.30ms (anomaly)
```

### Root Cause

**The `focusedIndex` state triggers a layout effect on every change:**

```typescript
useLayoutEffect(() => {
  updateFocusOverlayImmediate();
}, [focusedIndex, updateFocusOverlayImmediate]);
```

**Problem cascade:**
1. Arrow key press → `updateFocus(next)` called
2. RAF queues focus state update
3. `setFocusedIndex()` triggers state change
4. **useLayoutEffect runs synchronously** (blocks render)
5. `updateFocusOverlayImmediate()` reads DOM (scrollTop, clientHeight)
6. Writes to DOM (cssText style update)
7. **Full Browser component re-render**
8. React reconciles all child components
9. Repeat 20+ times per second when holding arrow key

### Performance Impact

**Current:**
- 21 renders/sec during keyboard navigation
- Each render involves:
  - Full component reconciliation
  - Memoized FileRow comparisons (even though skipped)
  - Virtualizer recalculation
  - Material-UI theme access
  - Effect cleanup and re-execution

**Expected:**
- Should be 0-2 renders/sec
- Overlay should update via ref manipulation only
- State should update only when navigation stops

## Solution Strategy

### Option 1: Debounced Focus State Updates ⭐ **RECOMMENDED**

**Approach:**
- Use `focusedIndexRef` for immediate overlay updates
- Debounce `focusedIndex` state updates (e.g., 150ms)
- Only commit to state after user stops pressing keys
- Overlay reads from ref, not state

**Benefits:**
- Minimal code changes
- Preserves existing behavior for mouse clicks (immediate)
- Reduces keyboard navigation renders to ~0-2/sec
- Overlay remains smooth (ref-based updates)

**Implementation:**
```typescript
const focusedIndexRef = React.useRef(0);
const focusedIndexDebounceRef = React.useRef<number | null>(null);

const updateFocus = (next: number, options) => {
  // Update ref immediately for overlay
  focusedIndexRef.current = next;
  updateFocusOverlayImmediate(); // Use ref, not state
  
  // Debounce state update
  if (focusedIndexDebounceRef.current !== null) {
    clearTimeout(focusedIndexDebounceRef.current);
  }
  focusedIndexDebounceRef.current = setTimeout(() => {
    setFocusedIndex(next);
  }, 150);
};
```

### Option 2: Remove focusedIndex from Effect Dependencies

**Approach:**
- Remove `focusedIndex` from the useLayoutEffect deps
- Manually call `updateFocusOverlayImmediate()` in `updateFocus`
- Effect only runs on scroll, not focus changes

**Risks:**
- Breaks React's dependency tracking
- Could miss edge cases where overlay needs update
- Makes code harder to reason about

### Option 3: Throttle Layout Effect

**Approach:**
- Keep effect, but throttle execution
- Use RAF to batch multiple focus changes

**Issues:**
- Still triggers state changes 20+/sec
- Still causes React reconciliation
- Just delays the problem, doesn't solve it

## Recommended Fix

Implement **Option 1** with these specifics:

1. **Add focusedIndexRef**
   ```typescript
   const focusedIndexRef = React.useRef(0);
   ```

2. **Modify updateFocusOverlayImmediate to use ref**
   ```typescript
   const updateFocusOverlayImmediate = React.useCallback(() => {
     const index = focusedIndexRef.current; // Read from ref
     // ... rest of function
   }, []);
   ```

3. **Update updateFocus to update ref immediately**
   ```typescript
   const updateFocus = (next, options) => {
     focusedIndexRef.current = next; // Immediate
     updateFocusOverlayImmediate(); // Overlay uses ref
     
     // Debounce state update for React re-renders
     // Only needed for accessibility, selection display, etc.
     debouncedSetFocusedIndex(next);
   };
   ```

4. **Remove focusedIndex from layout effect deps**
   ```typescript
   useLayoutEffect(() => {
     updateFocusOverlayImmediate();
   }, [updateFocusOverlayImmediate]); // Removed focusedIndex
   ```

5. **Add explicit overlay update on scroll**
   ```typescript
   // Scroll handler already calls updateFocusOverlayImmediate
   // No changes needed
   ```

## Expected Results After Fix

**Profiling output should show:**
```
[PERF] overlayUpdate: 0.10ms (unchanged - still fast)
[PERF] Browser component renders: 10 (vs 170 - 94% reduction)
```

**Render frequency:**
- During arrow key hold: 0-2 renders/sec (vs 21)
- Overlay updates: Smooth, ref-based (no state changes)
- Only commit to state after debounce expires

**User experience:**
- Visual overlay movement: Instant (ref-based)
- Keyboard navigation: Smooth, no lag
- CPU usage: Dramatically reduced
- Selection state: Updates after navigation stops (imperceptible delay)

## Implementation Priority

**High Priority** - This is the main bottleneck preventing smooth keyboard navigation.

The overlay updates themselves are fast (0.10ms), but triggering 21 full component re-renders per second is the actual performance killer.

## Testing Plan

1. Enable PERF_TRACE_ENABLED
2. Hold arrow down key for 5 seconds
3. Verify renders drop from ~100+ to <10
4. Verify overlay still moves smoothly
5. Verify selection state updates correctly after navigation stops
6. Test with mouse clicks (should remain immediate)
7. Test with PageUp/PageDown (should batch correctly)
