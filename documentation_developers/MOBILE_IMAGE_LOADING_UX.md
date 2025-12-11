# Mobile Image Loading UX Optimization

## Current Implementation

The Sambee image viewer already implements several best practices:

1. **Server-side resizing** - Images are resized based on viewport dimensions
2. **Progressive loading** - Current image loads first, then adjacent images (±2 range)
3. **Smart state management** - Loading state updates are deferred during touch gestures
4. **Blob URL caching** - Efficient memory management with cache invalidation
5. **Touch optimizations** - Multiple failsafes to handle dropped touch events

## Optimization Options

### Option A: Delayed Spinner Display (Quick Win)

**Concept**: Don't show loading spinner immediately. Wait 300ms before displaying it to avoid flash of loading state for fast loads.

**Implementation**: Add to `ImageViewer.tsx`:

```typescript
const [showLoadingSpinner, setShowLoadingSpinner] = useState(false);
const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);

// When image starts loading:
useEffect(() => {
  if (isLoading) {
    loadingTimerRef.current = setTimeout(() => {
      setShowLoadingSpinner(true);
    }, 300);
  } else {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    setShowLoadingSpinner(false);
  }
}, [isLoading]);

// In render:
{showLoadingSpinner && (
  <CircularProgress />
)}
```

**Benefits**:
- Images loading under 300ms show no spinner (feels instant)
- Reduces visual noise
- Industry standard (used by Instagram, Facebook, Twitter)

**Effort**: Low (1-2 hours)

---

### Option B: Skeleton Screen Placeholder

**Concept**: Show a simplified gray rectangle placeholder while image loads, instead of blank space or spinner.

**Implementation**: Add to `ImageViewer.tsx`:

```typescript
{isLoading && !blobUrl && (
  <Box
    sx={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#e0e0e0',
      animation: 'pulse 1.5s ease-in-out infinite',
      '@keyframes pulse': {
        '0%, 100%': { opacity: 1 },
        '50%': { opacity: 0.6 },
      },
    }}
  />
)}
```

**Benefits**:
- Better perceived performance (content area is defined)
- Modern UX pattern
- Less jarring than spinner

**Effort**: Low (1-2 hours)

**Can combine with**: Option A (300ms delay)

---

### Option C: Enhanced Error Handling with Retry

**Concept**: Add retry button and clearer error messages for failed loads.

**Implementation**: Add to `ImageViewer.tsx`:

```typescript
const [loadError, setLoadError] = useState<string | null>(null);

// In error handler:
catch (error) {
  if (error.code === 'ECONNABORTED') {
    setLoadError('Connection timeout');
  } else if (error.response?.status === 504) {
    setLoadError('Server timeout reading file');
  } else {
    setLoadError('Failed to load image');
  }
}

// In render:
{loadError && (
  <Box sx={{ textAlign: 'center', p: 2 }}>
    <Typography color="error">{loadError}</Typography>
    <Button
      variant="outlined"
      onClick={() => {
        setLoadError(null);
        // Retry load
      }}
      sx={{ mt: 2 }}
    >
      Retry
    </Button>
  </Box>
)}
```

**Benefits**:
- Users can recover from transient errors without refreshing
- Clear feedback about what went wrong
- Better UX for network share timeouts

**Effort**: Medium (2-3 hours)

---

### Option D: Low-Quality Image Placeholder (LQIP)

**Concept**: Show a tiny blurred version of the image while full-resolution loads (Instagram/Facebook approach).

**Implementation Requirements**:

1. **Backend** - Generate thumbnails (e.g., 20x20px, heavily compressed):
   ```python
   # In viewer.py
   @app.get("/api/images/{connection_id}/{path}/thumbnail")
   async def get_thumbnail(connection_id: str, path: str):
       # Generate tiny thumbnail (~1-2KB)
       thumb = pyvips.Image.new_from_file(full_path)
       thumb = thumb.thumbnail_image(20, height=20)
       thumb.write_to_buffer('.jpg[Q=70]')
   ```

2. **Frontend** - Load thumbnail first, then full image:
   ```typescript
   const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

   // Load thumbnail immediately (very fast, <50ms)
   fetchThumbnail(currentImage).then(setThumbnailUrl);

   // Load full image in background
   fetchFullImage(currentImage).then(setFullImageUrl);

   // Render:
   <img
     src={fullImageUrl || thumbnailUrl}
     style={!fullImageUrl ? { filter: 'blur(20px)' } : {}}
   />
   ```

**Benefits**:
- Most sophisticated approach
- Feels extremely fast (something always visible)
- Used by Instagram, Facebook, Medium

**Drawbacks**:
- Requires backend changes
- Additional storage/processing
- More complex cache management

**Effort**: High (1-2 days)

---

## Industry Examples

### Instagram
- 300ms delay before spinner
- LQIP with blur effect
- Skeleton for images not in cache
- Aggressive prefetching (next 3-5 images)

### Google Photos
- Skeleton screens everywhere
- LQIP from server
- Progressive JPEG loading
- Prefetch on scroll intent

### Pinterest
- Dominant color placeholder
- Progressive loading
- 500ms spinner delay
- Masonry layout with defined heights

### Twitter/X
- Dominant color background
- Progressive JPEG
- No spinner for cached images
- Retry button on errors

---

## Recommendation Priority

### High Priority (Quick Wins)
1. **Option A: 300ms Spinner Delay** - Industry standard, minimal code
2. **Option C: Retry Button** - Solves real user pain with network share timeouts

### Medium Priority (Quality Improvements)
3. **Option B: Skeleton Screens** - Modern UX, pairs well with Option A

### Low Priority (Nice to Have)
4. **Option D: LQIP System** - Most work, requires backend changes, marginal improvement over skeleton

---

## Implementation Notes

### Current Loading Flow
```
User swipes → Swiper changes slide → useEffect detects change →
Check cache → Not found → setIsLoading(true) → API call →
Blob conversion → Cache store → setIsLoading(false) → Display
```

### With Option A + B (Recommended)
```
User swipes → Swiper changes slide → useEffect detects change →
Check cache → Not found → Show skeleton immediately →
Start 300ms timer → API call → Blob conversion →
Cache store → Hide skeleton → Display image
(If API takes >300ms, also show spinner on skeleton)
```

### Testing Considerations
- Test with fast network (<300ms loads) - should see no spinner
- Test with slow network (>1s loads) - should see skeleton + spinner
- Test with network errors - should see retry button
- Test rapid swiping - loading states should be deferred during touch

---

## Current Touch Event Handling

The viewer already implements defensive programming for touch events:

1. **Primary handler**: `onTouchEnd` clears touch state
2. **Failsafe 1**: `onSlideChangeTransitionEnd` resets if stuck (~400ms)
3. **Failsafe 2**: 2-second timeout clears stuck state
4. **Failsafe 3**: Visibility change listener
5. **Failsafe 4**: Window blur listener
6. **Failsafe 5**: Component unmount cleanup

These ensure loading state updates work correctly even during rapid swiping.

---

## Future Considerations

### Progressive JPEG Loading
- Requires server to save JPEGs as progressive
- Browser automatically shows low-res version first
- Zero frontend code needed
- Compatible with all options above

### WebP with Fallback
- Better compression than JPEG
- Already supported by backend (format conversion)
- Consider making default format for mobile

### Service Worker Caching
- Cache thumbnails/skeletons in browser
- Instant display on revisit
- Requires service worker setup

---

## Related Files

- Frontend: `/workspace/frontend/src/components/Viewer/ImageViewer.tsx`
- Backend: `/workspace/backend/app/api/viewer.py`
- Image processing: `/workspace/backend/app/storage/base.py`
- Mobile logging: `/workspace/frontend/src/utils/logger.ts`
