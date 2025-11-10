# Performance Profiling Guide

## Overview

The Browser component now includes comprehensive performance instrumentation to help identify bottlenecks during scrolling operations. This document explains how to use the profiling system to analyze and optimize performance.

## Enabling Profiling

In `/workspace/frontend/src/pages/Browser.tsx`, there are two feature flags at the top of the file:

```typescript
const FOCUS_TRACE_ENABLED = false;
const PERF_TRACE_ENABLED = false;
```

### FOCUS_TRACE_ENABLED
When set to `true`, logs focus overlay visibility changes:
- `[FOCUS] Hiding overlay`
- `[FOCUS] Showing overlay`
- `[FOCUS] updateFocusOverlayImmediate called`

### PERF_TRACE_ENABLED
When set to `true`, logs detailed timing measurements for all operations. **This is the main profiling flag.**

## How to Profile

1. **Enable Profiling**
   ```typescript
   const PERF_TRACE_ENABLED = true;
   ```

2. **Open Browser DevTools**
   - Press F12 or right-click → Inspect
   - Switch to the Console tab

3. **Perform Test Scrolling**
   - Navigate to a directory with many files (100+)
   - Scroll using mouse wheel, trackpad, or keyboard
   - Try different scroll speeds (slow, medium, fast)

4. **Analyze Console Output**
   - Look for operations exceeding their thresholds
   - Identify patterns and bottlenecks
   - Note aggregate metrics from SCROLL reports

5. **Disable Profiling**
   ```typescript
   const PERF_TRACE_ENABLED = false;
   ```

## Console Output Reference

### Individual Operation Timings

The profiling system measures these operations:

#### Overlay Updates
```
[PERF] overlayUpdate: 3.45ms
```
- **What**: Total time to update focus overlay position
- **Threshold**: 5ms
- **Logged if**: Operation takes longer than threshold
- **Indicates**: Overall overlay update performance

```
[PERF] getVirtualItems: 1.23ms
```
- **What**: Time for TanStack Virtual to calculate visible items
- **Threshold**: 1ms
- **Indicates**: Virtual scrolling calculation efficiency

```
[PERF] layoutRead: 0.15ms
```
- **What**: Time to read scrollTop and clientHeight from DOM
- **Threshold**: 1ms
- **Indicates**: DOM layout thrashing (should be very fast)

```
[PERF] styleUpdate: 0.08ms
```
- **What**: Time to update overlay element styles via cssText
- **Threshold**: 1ms
- **Indicates**: DOM style update efficiency (batched, should be fast)

#### Scroll Handler
```
[PERF] scrollRAF: 5.67ms
```
- **What**: Time for RAF callback during scroll
- **Threshold**: 10ms (16.67ms = 60fps frame budget)
- **Indicates**: Scroll event processing efficiency

#### FileRow Rendering
```
[PERF] fileRow_0: 2.34ms
[PERF] fileRow_0_formatting: 0.12ms
[PERF] fileRow_0_render: 1.89ms
```
- **fileRow_N**: Total time to render row N
  - **Threshold**: 5ms
- **fileRow_N_formatting**: Time for formatFileSize/formatDate
  - **Threshold**: 1ms
- **fileRow_N_render**: Time for React/Material-UI rendering
  - **Threshold**: 2ms
- **Indicates**: Individual row rendering performance

### Aggregate Metrics

Every second during scrolling, you'll see:

```
[PERF SCROLL] Scroll events: 45.2/s | RAF callbacks: 60.0/s | Overlay updates: 3 | Renders: 12
```

- **Scroll events**: Number of scroll events per second
  - High values (100+/s) indicate rapid scrolling
  - Low values (10-30/s) indicate slow scrolling
  
- **RAF callbacks**: RequestAnimationFrame callbacks per second
  - Should max out at 60/s (one per frame)
  - Lower values indicate RAF throttling is working
  
- **Overlay updates**: Number of overlay position updates
  - Low values indicate caching and rapid-scroll-skip are working
  - High values suggest overlay is updating too frequently
  
- **Renders**: Component re-renders during the period
  - Should be minimal due to memoization
  - High values indicate excessive re-rendering

## Performance Optimizations in Place

The Browser component has 8 major optimizations:

### 1. Callback Stability
Uses refs instead of state to prevent callback recreation:
- `focusedIndexRef` instead of `focusedIndex` in callbacks
- Prevents ALL FileRow components from re-rendering

### 2. Virtual Items Caching
```typescript
getCachedVirtualItems()
```
- 16ms time-based cache
- Prevents redundant TanStack Virtual calculations
- Invalidates every frame during rapid updates

### 3. RAF Throttling
```typescript
requestAnimationFrame(() => {
  updateFocusOverlayImmediate();
});
```
- Limits scroll handler to max 60fps
- Prevents excessive overlay updates

### 4. Batched Style Updates
```typescript
overlay.style.cssText = `...all properties...`;
```
- Single reflow instead of 3-4 individual property updates
- Reduces layout thrashing

### 5. Rapid Scroll Detection
```typescript
const isRapidScrolling = timeSinceLastScroll < 50;
if (isRapidScrolling) {
  overlay.style.opacity = "0";
  return; // Skip updates
}
```
- Detects consecutive scrolls within 50ms
- Hides overlay during fast scrolling
- Restores after 100ms delay

### 6. Memoized FileRow Styles
```typescript
const fileRowStyles = useMemo(() => ({ ... }), [theme]);
```
- Stable style objects prevent Material-UI recalculation
- Prevents cascade of child re-renders

### 7. Stable handleFileClick
```typescript
const handleFileClick = useCallback(...)
```
- Uses `focusedIndexRef` instead of `focusedIndex` state
- Removes from React.memo dependencies
- Prevents FileRow re-renders

### 8. Memoized measureElement
```typescript
const measureElement = useMemo(...)
```
- Prevents virtualizer instance recreation
- Stabilizes TanStack Virtual internals

## Interpreting Results

### Good Performance Indicators
- ✅ Scroll events: 30-60/s during moderate scrolling
- ✅ RAF callbacks: 60/s max (one per frame)
- ✅ Overlay updates: <5 per second
- ✅ Renders: <10 per second
- ✅ Individual operations below thresholds

### Performance Issues
- ⚠️ `overlayUpdate` consistently >5ms → Overlay positioning is slow
- ⚠️ `getVirtualItems` >1ms → TanStack Virtual calculation overhead
- ⚠️ `fileRow_N` >5ms → Row rendering is slow (check Material-UI theme)
- ⚠️ RAF callbacks <60/s during fast scroll → Bottleneck in scroll handler
- ⚠️ High render count → Excessive re-rendering (check React.memo)

### Expected Baseline
With current optimizations, typical values during moderate scrolling:
- overlayUpdate: 2-4ms
- getVirtualItems: 0.5-1ms
- layoutRead: <0.2ms
- styleUpdate: <0.1ms
- scrollRAF: 3-7ms
- fileRow_N: 1-3ms

## Further Optimization Strategies

If profiling reveals bottlenecks:

### If getVirtualItems is slow (>2ms)
- TanStack Virtual internals are the issue
- Consider reducing `overscan` (currently 10)
- May need to accept this as baseline performance

### If fileRow_N is slow (>5ms)
- Material-UI theme calculations may be heavy
- Consider using plain CSS instead of `sx` prop
- Reduce Typography/Chip components
- Use CSS-in-JS with emotion directly

### If overlayUpdate is slow (>10ms)
- Increase cache duration (currently 16ms)
- Increase rapid scroll threshold (currently 50ms)
- Consider removing overlay entirely during scroll

### If many re-renders
- Check React DevTools Profiler
- Verify React.memo comparison functions
- Ensure all callbacks are stable (useCallback with refs)

## Profiling Best Practices

1. **Profile in production build** (`npm run build && npm run preview`)
   - Development builds have React DevTools overhead
   - Production shows real-world performance

2. **Test with large datasets** (500+ files)
   - Small lists won't reveal bottlenecks
   - Performance issues scale with data size

3. **Test different scroll methods**
   - Mouse wheel (rapid scrolling)
   - Trackpad (smooth scrolling)
   - Keyboard (PageDown, Arrow keys)
   - Each has different characteristics

4. **Compare before/after**
   - Profile with optimization enabled
   - Profile with optimization disabled
   - Measure actual improvement

5. **Consider hardware**
   - Test on slower hardware
   - CPU throttling in DevTools (Performance tab → CPU: 4x slowdown)
   - Mobile devices have less CPU power

## Disabling Profiling

**Important**: Always disable profiling before committing code:

```typescript
const FOCUS_TRACE_ENABLED = false;
const PERF_TRACE_ENABLED = false;
```

Profiling has overhead:
- `performance.now()` calls add ~0.1ms per operation
- Console.log is expensive (1-5ms per log)
- Can affect the measurements themselves
- Should only be enabled during active debugging

## Example Analysis Session

```
// Enable profiling
PERF_TRACE_ENABLED = true

// Start scrolling...

[PERF] overlayUpdate: 3.2ms
[PERF] getVirtualItems: 0.8ms
[PERF] layoutRead: 0.12ms
[PERF] styleUpdate: 0.06ms
[PERF] scrollRAF: 4.5ms
[PERF SCROLL] Scroll events: 42.1/s | RAF callbacks: 60.0/s | Overlay updates: 2 | Renders: 3

// Analysis:
// - All operations well within thresholds ✅
// - RAF at max 60fps ✅
// - Low overlay updates (2/sec) ✅
// - Minimal re-renders (3/sec) ✅
// - Conclusion: Performance is optimal
```

## Related Documentation

- [TanStack Virtual Docs](https://tanstack.com/virtual/latest)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [Browser Performance](https://developer.chrome.com/docs/devtools/performance/)

## Support

If profiling reveals issues that can't be resolved with current optimizations:
1. Capture console output during problem scroll
2. Note hardware specs (CPU, RAM, browser)
3. Create issue with profiling data
4. Include reproduction steps
