# Performance Profiling - Quick Reference

## Quick Start

1. **Enable profiling** in `frontend/src/pages/Browser.tsx`:
   ```typescript
   const PERF_TRACE_ENABLED = true;  // Change false to true
   ```

2. **Open DevTools Console** (F12)

3. **Scroll through a long file list**

4. **Watch console output**:
   ```
   [PERF] overlayUpdate: 3.2ms
   [PERF] scrollRAF: 4.5ms
   [PERF SCROLL] Scroll events: 42/s | RAF: 60/s | Updates: 2 | Renders: 3
   ```

5. **Disable when done**:
   ```typescript
   const PERF_TRACE_ENABLED = false;
   ```

## Metrics Reference

| Metric | Threshold | What It Measures | Good Value |
|--------|-----------|------------------|------------|
| `overlayUpdate` | 5ms | Total overlay positioning time | <4ms |
| `getVirtualItems` | 1ms | TanStack Virtual calculation | <1ms |
| `layoutRead` | 1ms | DOM layout reads | <0.2ms |
| `styleUpdate` | 1ms | DOM style updates | <0.1ms |
| `scrollRAF` | 10ms | RAF callback execution | <7ms |
| `fileRow_N` | 5ms | Individual row render | <3ms |
| `fileRow_N_formatting` | 1ms | Date/size formatting | <0.5ms |
| `fileRow_N_render` | 2ms | React/MUI rendering | <2ms |

## Aggregate Metrics

```
[PERF SCROLL] Scroll events: 45.2/s | RAF callbacks: 60.0/s | Overlay updates: 3 | Renders: 12
```

- **Scroll events/s**: Event rate (high = fast scroll)
- **RAF callbacks/s**: Should max at 60/s
- **Overlay updates**: Should be <5/s
- **Renders**: Should be <10/s

## Troubleshooting

### High CPU Usage

**If `overlayUpdate` >5ms consistently:**
- Overlay positioning is slow
- Increase cache duration or rapid scroll threshold
- Consider hiding overlay during scroll entirely

**If `getVirtualItems` >2ms:**
- TanStack Virtual calculation overhead
- Reduce overscan from 10 to 5
- This may be unavoidable baseline

**If `fileRow_N` >5ms:**
- Row rendering is slow
- Material-UI theme overhead
- Consider replacing `sx` with plain CSS

**If many renders (>20/s):**
- Excessive component re-rendering
- Check React.memo comparison functions
- Verify callback stability (useCallback with refs)

### Low Performance

**Symptoms:**
- Operations exceed thresholds
- RAF callbacks <60/s during smooth scroll
- High render count

**Actions:**
1. Profile in production build (`npm run build && npm run preview`)
2. Test with CPU throttling (DevTools Performance → CPU: 4x slowdown)
3. Test with large dataset (500+ files)
4. Check browser Performance tab for flame graphs

## Performance Optimizations Active

✅ Callback stability (refs instead of state dependencies)
✅ Virtual items caching (16ms time-based)
✅ RAF throttling (max 60fps updates)
✅ Batched style updates (single cssText)
✅ Rapid scroll skipping (50ms threshold)
✅ Memoized FileRow styles (stable objects)
✅ Stable handleFileClick (no state dependencies)
✅ Memoized measureElement (stable virtualizer)

## Expected Baseline

Typical values during moderate scrolling on modern hardware:

```
[PERF] overlayUpdate: 2-4ms
[PERF] getVirtualItems: 0.5-1ms
[PERF] layoutRead: <0.2ms
[PERF] styleUpdate: <0.1ms
[PERF] scrollRAF: 3-7ms
[PERF] fileRow_0: 1-3ms
[PERF SCROLL] Scroll events: 30-60/s | RAF: 60/s | Updates: 2-4 | Renders: 3-8
```

## Remember

⚠️ **Always disable profiling before committing**:
```typescript
const PERF_TRACE_ENABLED = false;
```

Profiling adds overhead (~0.1ms per operation + console.log cost)

## Full Documentation

See [PERFORMANCE_PROFILING.md](/workspace/PERFORMANCE_PROFILING.md) for complete guide.
