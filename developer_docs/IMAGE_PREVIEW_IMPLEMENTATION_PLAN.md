# Image Preview Component - Implementation Plan

## Overview

This plan outlines the implementation of a robust image preview component following the strategy defined in DEVELOPMENT_PLAN.md. The component will support PNG, JPEG, GIF, WebP, and SVG formats with zoom, pan, rotation, and metadata display features.

## Current State Analysis

**Existing Preview Infrastructure:**
- ✅ `MarkdownPreview.tsx` component serving as reference implementation
- ✅ Backend preview API endpoint: `/api/preview/{connection_id}/file?path=...`
- ✅ File streaming with proper MIME type detection via `StorageBackend`
- ✅ Dialog-based preview UI pattern established
- ✅ Responsive design (fullScreen on mobile)

**Integration Points:**
- Browser component conditionally renders preview based on file type
- Preview triggered by file click (line 2045 in Browser.tsx)
- `selectedFile` state tracks current preview

## Architecture Design

### Component Hierarchy

```
PreviewComponent (Abstract Interface)
├── MarkdownPreview (existing)
└── ImagePreview (new)
    ├── ImageViewer (core rendering)
    ├── ImageControls (zoom, rotate, pan controls)
    ├── ImageMetadata (EXIF data display)
    └── ImageLoadingState (progressive loading)
```

### Preview Component Registry Pattern

Create a registry to map MIME types to preview components:

```typescript
// frontend/src/components/Preview/PreviewRegistry.ts
type PreviewComponentProps = {
  connectionId: string;
  path: string;
  onClose: () => void;
};

type PreviewComponent = React.FC<PreviewComponentProps>;

const PREVIEW_REGISTRY: Map<RegExp, PreviewComponent> = new Map([
  [/^text\/markdown$/, MarkdownPreview],
  [/^image\/(png|jpeg|gif|webp|svg\+xml)$/, ImagePreview],
  // Future: /^application\/pdf$/, PdfPreview
]);

export const getPreviewComponent = (mimeType: string): PreviewComponent | null => {
  for (const [pattern, component] of PREVIEW_REGISTRY) {
    if (pattern.test(mimeType)) {
      return component;
    }
  }
  return null;
};
```

## Implementation Options Analysis

### Option 1: React-based Image Library

Three primary libraries to consider, each with different strengths:

#### 1a. react-photo-view ⭐ RECOMMENDED

**Overview:** Modern, lightweight image viewer with excellent touch support and clean API.

**Pros:**
- ✅ Smallest bundle size (~25KB gzipped)
- ✅ Excellent touch/gesture support (pinch, swipe)
- ✅ Built-in gallery mode with navigation
- ✅ Modern, clean API with TypeScript support
- ✅ Smooth animations and transitions
- ✅ Actively maintained (last update: 2024)
- ✅ Works great with React 18+
- ✅ Easy to customize overlay/toolbar
- ✅ Keyboard shortcuts supported

**Cons:**
- ❌ Less feature-rich than react-image-gallery
- ❌ No built-in slideshow mode
- ❌ Smaller community than alternatives
- ❌ Less extensive documentation

**Gallery Mode:** Built-in support via PhotoProvider wrapper around multiple images

**Best for:** Single image viewing with optional gallery navigation. Perfect match for our use case.

#### 1b. react-image-gallery

**Overview:** Feature-rich gallery component with extensive customization options.

**Pros:**
- ✅ Comprehensive feature set (thumbnails, slideshow, fullscreen)
- ✅ Large community and extensive documentation
- ✅ Battle-tested in production
- ✅ Highly customizable
- ✅ Built-in thumbnail navigation
- ✅ Slideshow mode with autoplay
- ✅ Video support

**Cons:**
- ❌ Larger bundle size (~80KB gzipped)
- ❌ More complex API (steeper learning curve)
- ❌ Gallery-focused (overkill for single image preview)
- ❌ Requires more configuration for simple use cases
- ❌ Less modern codebase (class components)
- ❌ Heavier dependencies

**Gallery Mode:** Core feature, very robust with thumbnails

**Best for:** Photo gallery applications where gallery mode is the primary use case.

#### 1c. react-medium-image-zoom

**Overview:** Minimal, lightweight zoom component inspired by Medium's image zoom behavior.

**Pros:**
- ✅ Extremely lightweight (~8KB gzipped)
- ✅ Simple, elegant API
- ✅ Smooth zoom animations
- ✅ Perfect TypeScript support
- ✅ Zero configuration needed
- ✅ Works inline (doesn't require modal/dialog)
- ✅ Minimal dependencies

**Cons:**
- ❌ No gallery mode support
- ❌ No rotation or advanced controls
- ❌ No pan/drag functionality
- ❌ Zoom-in-place only (not fullscreen overlay)
- ❌ No touch gesture support
- ❌ Very limited feature set

**Gallery Mode:** Not supported - would need custom implementation

**Best for:** Inline image zoom on a page. Not suitable for our dialog-based preview needs.

### Summary: Library Comparison

| Feature | react-photo-view | react-image-gallery | react-medium-image-zoom |
|---------|------------------|---------------------|------------------------|
| Bundle Size (gzipped) | ~25KB | ~80KB | ~8KB |
| Gallery Mode | ✅ Built-in | ✅✅ Core feature | ❌ Not supported |
| Fullscreen/Modal | ✅ Yes | ✅ Yes | ❌ Inline only |
| Zoom & Pan | ✅ Yes | ✅ Yes | ⚠️ Zoom only |
| Touch Gestures | ✅✅ Excellent | ✅ Good | ❌ No |
| Rotation | ✅ Yes | ❌ No | ❌ No |
| Keyboard Shortcuts | ✅ Yes | ✅ Yes | ⚠️ Limited |
| TypeScript | ✅ Full support | ⚠️ Types available | ✅ Full support |
| Complexity | ⬜⬜⬛⬛⬛ Simple | ⬜⬜⬜⬜⬛ Complex | ⬜⬛⬛⬛⬛ Very simple |
| **Recommendation** | ⭐ **Best fit** | Overkill | Too limited |

**Conclusion:** `react-photo-view` strikes the perfect balance for our needs - lightweight, modern, supports gallery mode, and has all essential features.

### Option 2: Custom Implementation with CSS Transform

**Core approach:**
- Use CSS `transform: scale()` for zoom
- `translate()` for panning
- React state for transform values
- Touch/mouse event handlers

**Pros:**
- ✅ Full control over UX and behavior
- ✅ Zero dependencies (smaller bundle)
- ✅ Perfect design system integration
- ✅ Learning opportunity for team
- ✅ Can optimize exactly for your use case

**Cons:**
- ❌ Longer development time (3-5 days)
- ❌ Need to handle edge cases (zoom limits, boundaries)
- ❌ More testing required
- ❌ Mobile gestures are complex to implement correctly
- ❌ Accessibility requires careful implementation

### Option 3: Canvas-based Rendering (Konva.js, Fabric.js)

**Libraries:**
- `react-konva`: React wrapper for Konva.js
- `fabric.js`: Powerful canvas manipulation

**Pros:**
- ✅ Advanced manipulation capabilities (annotations future feature)
- ✅ High performance for complex operations
- ✅ Precise pixel-level control
- ✅ Good for future features (drawing, cropping)

**Cons:**
- ❌ Overkill for basic image viewing
- ❌ Larger bundle size (200-300KB)
- ❌ More complex to implement
- ❌ Accessibility challenges (canvas is not semantic)
- ❌ SEO/screen reader issues

### Option 4: Native Browser APIs (Pinch-Zoom-Element)

**Approach:**
- Use `<pinch-zoom>` web component
- Leverage native browser zoom behavior
- Minimal JavaScript

**Pros:**
- ✅ Extremely lightweight
- ✅ Native performance
- ✅ Minimal code to maintain
- ✅ Works with any content type

**Cons:**
- ❌ Limited customization
- ❌ Web component compatibility considerations
- ❌ No rotation/metadata features built-in
- ❌ Need polyfills for older browsers

## Recommended Approach: Single Library Strategy

**Implementation (5-7 days):** Use `react-photo-view` with custom enhancements
- Fast time to market (library handles complex zoom/pan logic)
- Production-ready features out of the box
- Excellent mobile experience with touch gestures
- Built-in gallery mode support
- Custom toolbar for additional controls
- Lightweight (~25KB) - minimal bundle impact
- No server-side processing needed
- No EXIF metadata complexity

**Why not custom implementation:**
- Zoom/pan with smooth transitions is complex to implement correctly
- Touch gestures (pinch-zoom, swipe) require significant effort
- react-photo-view is battle-tested and maintained
- Bundle size is acceptable for the features gained
- Can always migrate later if needed, but unlikely to be necessary

## Detailed Implementation Plan

### Backend Changes (0.5 days)

#### 1. Add Image Size Limits
```python
# backend/app/core/config.py
class Settings(BaseSettings):
    # ... existing settings ...
    MAX_IMAGE_PREVIEW_SIZE: int = 50 * 1024 * 1024  # 50MB
```

#### 2. Add Range Request Support (for large images)
```python
# backend/app/api/preview.py
# Modify preview_file to support HTTP Range headers
# Enables progressive loading for very large images

from fastapi import Request
from fastapi.responses import StreamingResponse

@router.get("/{connection_id}/file")
async def preview_file(
    request: Request,
    connection_id: uuid.UUID,
    path: str = Query(..., description="Path to the file"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Stream file contents for preview with Range request support"""
    # ... existing code ...
    
    # Check for Range header
    range_header = request.headers.get("Range")
    
    if range_header:
        # Parse Range header and return partial content (206)
        # Useful for very large images
        pass
    
    # Return full file as before
    # ...
```

**Note:** Backend remains simple - no server-side image conversion, thumbnail generation, or EXIF extraction. The browser handles image rendering natively.

### Frontend Changes (4-5 days)

#### Day 1: Project Setup & Core Component

**Install dependencies:**
```bash
npm install react-photo-view
```

**Create base component:**
```typescript
// frontend/src/components/Preview/ImagePreview.tsx
import React, { useState, useEffect } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';

interface ImagePreviewProps {
  connectionId: string;
  path: string;
  onClose: () => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  connectionId,
  path,
  onClose,
}) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Construct preview URL
        const url = `/api/preview/${connectionId}/file?path=${encodeURIComponent(path)}`;
        setImageUrl(url);
        
      } catch (err) {
        setError('Failed to load image');
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [connectionId, path]);

  const filename = path.split('/').pop() || path;

  return (
    <PhotoProvider
      visible={true}
      onClose={onClose}
      loadingElement={<CircularProgress />}
      toolbarRender={({ rotate, onRotate, onScale, scale }) => (
        <CustomToolbar
          filename={filename}
          onRotate={onRotate}
          onScale={onScale}
          rotate={rotate}
          scale={scale}
          onClose={onClose}
        />
      )}
    >
      <PhotoView src={imageUrl}>
        <img src={imageUrl} alt={filename} style={{ display: 'none' }} />
      </PhotoView>
    </PhotoProvider>
  );
};
```

#### Day 2: Controls, Toolbar & Gallery Mode

**Create custom toolbar:**
```typescript
// frontend/src/components/Preview/ImageControls.tsx
import {
  ZoomIn,
  ZoomOut,
  RotateRight,
  RotateLeft,
  Close,
  Download,
  ArrowBack,
  ArrowForward,
} from '@mui/icons-material';

interface ImageControlsProps {
  filename: string;
  onRotate: (angle: number) => void;
  onScale: (scale: number) => void;
  rotate: number;
  scale: number;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  currentIndex?: number;
  totalImages?: number;
}

export const ImageControls: React.FC<ImageControlsProps> = ({
  filename,
  onRotate,
  onScale,
  rotate,
  scale,
  onClose,
  onNext,
  onPrevious,
  currentIndex,
  totalImages,
}) => {
  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bgcolor: 'rgba(0,0,0,0.8)',
        color: 'white',
        p: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        zIndex: 9999,
      }}
    >
      <Typography variant="h6" sx={{ flex: 1 }}>
        {filename}
        {totalImages && totalImages > 1 && (
          <Typography variant="caption" sx={{ ml: 2, opacity: 0.7 }}>
            {currentIndex! + 1} / {totalImages}
          </Typography>
        )}
      </Typography>
      
      {/* Gallery navigation */}
      {totalImages && totalImages > 1 && (
        <>
          <IconButton
            color="inherit"
            onClick={onPrevious}
            disabled={currentIndex === 0}
            title="Previous image (Left arrow)"
          >
            <ArrowBack />
          </IconButton>
          
          <IconButton
            color="inherit"
            onClick={onNext}
            disabled={currentIndex === totalImages - 1}
            title="Next image (Right arrow)"
          >
            <ArrowForward />
          </IconButton>
        </>
      )}
      
      <IconButton color="inherit" onClick={() => onScale(scale * 1.2)} title="Zoom in (+)">
        <ZoomIn />
      </IconButton>
      
      <IconButton color="inherit" onClick={() => onScale(scale * 0.8)} title="Zoom out (-)">
        <ZoomOut />
      </IconButton>
      
      <IconButton color="inherit" onClick={() => onRotate(rotate + 90)} title="Rotate right (R)">
        <RotateRight />
      </IconButton>
      
      <IconButton color="inherit" onClick={() => onRotate(rotate - 90)} title="Rotate left (Shift+R)">
        <RotateLeft />
      </IconButton>
      
      <IconButton color="inherit" onClick={onClose} title="Close (Escape)">
        <Close />
      </IconButton>
    </Box>
  );
};
```

**Implement Gallery Mode:**
```typescript
// frontend/src/components/Preview/ImagePreview.tsx
// Gallery mode: Show multiple images with navigation

interface ImagePreviewProps {
  connectionId: string;
  path: string;
  onClose: () => void;
  // Gallery mode: provide all images in current directory
  images?: string[];  // Array of image paths
  currentIndex?: number;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],  // Default to single image
  currentIndex: initialIndex = 0,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentPath = images[currentIndex];
  
  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, images.length]);
  
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);
  
  // Keyboard shortcuts for gallery navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrevious]);
  
  const imageUrl = `/api/preview/${connectionId}/file?path=${encodeURIComponent(currentPath)}`;
  const filename = currentPath.split('/').pop() || currentPath;
  
  return (
    <PhotoProvider
      visible={true}
      onClose={onClose}
      index={currentIndex}
      onIndexChange={setCurrentIndex}
      images={images.map(imgPath => ({
        src: `/api/preview/${connectionId}/file?path=${encodeURIComponent(imgPath)}`,
        key: imgPath,
      }))}
      toolbarRender={({ rotate, onRotate, onScale, scale }) => (
        <ImageControls
          filename={filename}
          onRotate={onRotate}
          onScale={onScale}
          rotate={rotate}
          scale={scale}
          onClose={onClose}
          onNext={handleNext}
          onPrevious={handlePrevious}
          currentIndex={currentIndex}
          totalImages={images.length}
        />
      )}
    >
      {/* PhotoProvider handles rendering */}
    </PhotoProvider>
  );
};
```

#### Day 3: Browser Integration & Gallery Mode

**Update Browser.tsx to support gallery mode:**
```typescript
// frontend/src/pages/Browser.tsx

const [selectedFileInfo, setSelectedFileInfo] = useState<{
  path: string;
  mimeType: string;
  index?: number;  // For gallery mode
} | null>(null);

// Get all image files in current directory for gallery mode
const imageFiles = useMemo(() => {
  return files
    .filter(f => f.type === 'file' && f.name.match(/\.(png|jpe?g|gif|webp|svg)$/i))
    .map(f => `${currentPath}/${f.name}`.replace(/^\/+/, ''));
}, [files, currentPath]);

const handleFileClick = useCallback((file: FileEntry) => {
  if (file.type === 'file') {
    const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
    
    if (isImage) {
      const filePath = `${currentPath}/${file.name}`.replace(/^\/+/, '');
      const imageIndex = imageFiles.indexOf(filePath);
      
      setSelectedFileInfo({
        path: filePath,
        mimeType: 'image/*',  // Generic for image detection
        index: imageIndex >= 0 ? imageIndex : 0,
      });
    } else {
      // Fetch MIME type for non-images
      api.getFileInfo(selectedConnectionId, `${currentPath}/${file.name}`)
        .then(info => {
          setSelectedFileInfo({
            path: `${currentPath}/${file.name}`,
            mimeType: info.mime_type || 'application/octet-stream',
          });
        });
    }
  }
}, [selectedConnectionId, currentPath, imageFiles]);

// ... in render ...

{selectedFileInfo && (() => {
  const PreviewComponent = getPreviewComponent(selectedFileInfo.mimeType);
  return PreviewComponent ? (
    <PreviewComponent
      connectionId={selectedConnectionId}
      path={selectedFileInfo.path}
      onClose={() => setSelectedFileInfo(null)}
      // Gallery mode for images
      images={selectedFileInfo.mimeType.startsWith('image/') ? imageFiles : undefined}
      currentIndex={selectedFileInfo.index}
    />
  ) : null;
})()}
```

#### Day 4: Advanced Features & Polish

**Add image preloading for gallery mode:**
```typescript
// frontend/src/components/Preview/ImagePreview.tsx

// Preload adjacent images for smoother gallery navigation
useEffect(() => {
  if (images && images.length > 1) {
    const preloadImage = (path: string) => {
      const img = new Image();
      img.src = `/api/preview/${connectionId}/file?path=${encodeURIComponent(path)}`;
    };
    
    // Preload next image
    if (currentIndex < images.length - 1) {
      preloadImage(images[currentIndex + 1]);
    }
    
    // Preload previous image
    if (currentIndex > 0) {
      preloadImage(images[currentIndex - 1]);
    }
  }
}, [currentIndex, images, connectionId]);
```

**Add keyboard shortcuts:**
```typescript
// Enhanced keyboard navigation
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        handlePrevious();
        break;
      case 'ArrowRight':
        e.preventDefault();
        handleNext();
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case '+':
      case '=':
        e.preventDefault();
        onScale(scale * 1.2);
        break;
      case '-':
      case '_':
        e.preventDefault();
        onScale(scale * 0.8);
        break;
      case 'r':
        e.preventDefault();
        if (e.shiftKey) {
          onRotate(rotate - 90);
        } else {
          onRotate(rotate + 90);
        }
        break;
      case 'Home':
        e.preventDefault();
        setCurrentIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setCurrentIndex(images.length - 1);
        break;
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [handleNext, handlePrevious, onClose, scale, rotate, images.length]);
```

**Add loading states:**
```typescript
// Show loading indicator while image loads
const [imageLoaded, setImageLoaded] = useState(false);

return (
  <PhotoProvider
    loadingElement={
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress size={60} />
      </Box>
    }
    // ... rest of props
  />
);
```

#### Day 5: Testing & Polish

**Unit tests:**
```typescript
// frontend/src/components/Preview/__tests__/ImagePreview.test.tsx

describe('ImagePreview', () => {
  it('renders image with correct URL', () => {
    // Test URL construction
  });

  it('shows loading state initially', () => {
    // Test loading indicator
  });

  it('handles zoom controls', () => {
    // Test zoom in/out
  });

  it('handles rotation', () => {
    // Test rotate buttons
  });

  it('displays metadata panel', () => {
    // Test EXIF display
  });

  it('handles large images gracefully', () => {
    // Test size limits
  });

  it('shows error for failed loads', () => {
    // Test error handling
  });
});
```

**Integration tests:**
```typescript
// frontend/src/pages/__tests__/Browser-image-preview.test.tsx

describe('Browser - Image Preview', () => {
  it('opens image preview when clicking image file', async () => {
    // Mock file with image MIME type
    // Click file
    // Verify ImagePreview renders
  });

  it('supports keyboard shortcuts in image preview', () => {
    // Test Escape to close
    // Test arrow keys for navigation (if multiple images)
  });
  
  it('opens gallery mode with multiple images', async () => {
    // Mock directory with 3 images
    // Click second image
    // Verify gallery shows 2/3
    // Test navigation to next/previous
  });
  
  it('preloads adjacent images in gallery mode', async () => {
    // Verify Image objects created for next/prev images
  });
  
  it('navigates gallery with keyboard shortcuts', async () => {
    // Test Left/Right arrows
    // Test Home/End keys
  });
});
```

## File Size Considerations

### Bundle Size Analysis

| Library | Gzipped Size | Features |
|---------|--------------|----------|
| react-photo-view | ~25KB | Zoom, pan, gestures, gallery mode |
| **Total Impact** | **~25KB** | Complete solution |

**Mitigation strategies:**
1. Code splitting - lazy load preview components
2. Tree-shaking - import only needed features
3. Only load preview when user clicks an image

```typescript
// Use dynamic imports
const ImagePreview = lazy(() => import('./components/Preview/ImagePreview'));

// In Browser.tsx
<React.Suspense fallback={<CircularProgress />}>
  {selectedFileInfo?.mimeType.startsWith('image/') && (
    <ImagePreview {...props} />
  )}
</React.Suspense>
```

**Note:** No EXIF library needed, no server-side processing - keeps bundle minimal.

## Progressive Enhancement Strategy

### Phase 1: Basic Viewing (MVP)
- ✅ Display image
- ✅ Close button
- ✅ Responsive dialog
- ✅ Zoom in/out
- ✅ Pan/drag

### Phase 2: Gallery Mode (Core Feature)
- ✅ Navigate between images in directory
- ✅ Keyboard shortcuts (Left/Right arrows)
- ✅ Touch gestures (swipe)
- ✅ Image counter (2/10)
- ✅ Preload adjacent images

### Phase 3: Advanced Controls
- ✅ Rotate left/right
- ✅ Keyboard shortcuts (R, +, -, Escape, Home, End)
- ✅ Custom toolbar with controls
- ✅ Loading states

### Phase 4: Performance
- ✅ Lazy loading component
- ✅ Image preloading (adjacent)
- ✅ Optimized re-renders

### Phase 5: Future Enhancements
- ⬜ Image comparison (side-by-side)
- ⬜ Basic editing (crop, brightness)
- ⬜ Slideshow mode (auto-advance)
- ⬜ Thumbnail strip preview

## Performance Optimizations

### 1. Lazy Loading
```typescript
// Only load image component when needed
const ImagePreview = React.lazy(() => 
  import('./components/Preview/ImagePreview')
);

// In Browser.tsx
<React.Suspense fallback={<CircularProgress />}>
  {selectedFileInfo?.mimeType.startsWith('image/') && (
    <ImagePreview {...props} />
  )}
</React.Suspense>
```

### 2. Image Size Limits
```typescript
// Check file size before loading
const MAX_PREVIEW_SIZE = 50 * 1024 * 1024; // 50MB

if (file.size > MAX_PREVIEW_SIZE) {
  return <Alert>Image too large. Download to view.</Alert>;
}
```

### 3. Caching Strategy
```typescript
// Use browser cache for previewed images
const imageUrl = useMemo(() => {
  const base = `/api/preview/${connectionId}/file?path=${encodeURIComponent(path)}`;
  // Add cache-busting only if file changed
  const cacheKey = `${path}-${file.modified}`;
  return `${base}&cache=${cacheKey}`;
}, [connectionId, path, file.modified]);
```

### 4. Gallery Preloading
```typescript
// Preload images in background for smooth navigation
const preloadQueue = useMemo(() => {
  const queue: string[] = [];
  
  // Prioritize adjacent images
  if (currentIndex < images.length - 1) {
    queue.push(images[currentIndex + 1]);
  }
  if (currentIndex > 0) {
    queue.push(images[currentIndex - 1]);
  }
  
  // Optionally preload further images
  if (currentIndex < images.length - 2) {
    queue.push(images[currentIndex + 2]);
  }
  
  return queue;
}, [currentIndex, images]);

useEffect(() => {
  preloadQueue.forEach(path => {
    const img = new Image();
    img.src = `/api/preview/${connectionId}/file?path=${encodeURIComponent(path)}`;
  });
}, [preloadQueue, connectionId]);
```

## Accessibility Considerations

1. **Keyboard Navigation:**
   - Escape: Close preview
   - +/-: Zoom in/out
   - Arrow Left/Right: Navigate to previous/next image in gallery
   - R: Rotate right
   - Shift+R: Rotate left
   - Home: Jump to first image
   - End: Jump to last image

2. **Screen Readers:**
   - Alt text from filename
   - ARIA labels on all controls
   - Announce zoom level changes

3. **Focus Management:**
   - Trap focus within preview dialog
   - Restore focus to trigger element on close
   - Clear focus indicators

```typescript
// Example accessibility implementation
<Dialog
  open={true}
  onClose={onClose}
  aria-labelledby="image-preview-title"
  aria-describedby="image-preview-description"
>
  <DialogTitle id="image-preview-title">
    {filename}
  </DialogTitle>
  
  <img
    src={imageUrl}
    alt={`Preview of ${filename}`}
    role="img"
    aria-describedby="image-metadata"
  />
  
  <IconButton
    onClick={onZoomIn}
    aria-label="Zoom in"
    title="Zoom in (+ key)"
  >
    <ZoomIn />
  </IconButton>
</Dialog>
```

## Testing Strategy

### Unit Tests (Vitest)
- Component rendering
- State management
- Event handlers
- Error handling

### Integration Tests
- File selection → preview opening
- Preview controls interaction
- Metadata extraction
- Error states

### E2E Tests (optional, Playwright/Cypress)
- Full user flow
- Different image formats
- Large file handling
- Mobile gestures

### Performance Tests
- Lighthouse scores
- Bundle size limits
- Memory usage
- Load time metrics

## Rollout Plan

### Week 1: Core Implementation
- Day 1 (0.5 days): Backend size limits and range support
- Day 1.5: Frontend registry pattern setup
- Day 2: Basic ImagePreview component with react-photo-view
- Day 3: Gallery mode implementation
- Day 4: Custom toolbar and keyboard shortcuts
- Day 5: Browser integration and testing

### Week 2: Polish & Deploy
- Day 1: Image preloading optimization
- Day 2: Accessibility improvements
- Day 3: Comprehensive testing (unit, integration)
- Day 4: Cross-browser testing (Chrome, Firefox, Safari, Edge)
- Day 5: Documentation and production deployment

## Success Metrics

- ✅ All image formats render correctly
- ✅ Load time <1s for images <5MB
- ✅ Lighthouse accessibility score >90
- ✅ Bundle size increase <100KB
- ✅ Zero console errors
- ✅ Works on mobile (iOS Safari, Chrome)
- ✅ Test coverage >85%

## Future Considerations

### Thumbnail Strip
Add thumbnail navigation at bottom of gallery:
```typescript
// Show thumbnails of all images in gallery
<Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', gap: 1, p: 2 }}>
  {images.map((imgPath, idx) => (
    <img
      key={imgPath}
      src={`/api/preview/${connectionId}/file?path=${encodeURIComponent(imgPath)}`}
      onClick={() => setCurrentIndex(idx)}
      style={{
        width: 60,
        height: 60,
        objectFit: 'cover',
        cursor: 'pointer',
        opacity: idx === currentIndex ? 1 : 0.5,
        border: idx === currentIndex ? '2px solid white' : 'none',
      }}
    />
  ))}
</Box>
```

**Note:** This would benefit from server-side thumbnail generation in the future, but can work with direct image loading for now (just slower).

### Slideshow Mode
Auto-advance through images:
```typescript
const [slideshowActive, setSlideshowActive] = useState(false);

useEffect(() => {
  if (slideshowActive) {
    const timer = setInterval(() => {
      handleNext();
      if (currentIndex === images.length - 1) {
        setSlideshowActive(false); // Stop at end
      }
    }, 3000); // 3 seconds per image
    
    return () => clearInterval(timer);
  }
}, [slideshowActive, currentIndex, images.length, handleNext]);
```

### Format-Specific Features
- **SVG:** Consider sanitizing and rendering inline for better quality (security concern - sanitize first)
- **GIF:** Browser handles animation natively, no special handling needed
- **WebP:** Modern format, no fallback needed (older browsers not a concern)
- **AVIF/HEIC:** Not supported - users can download if needed (no server-side conversion)

## Conclusion

**Recommended Implementation:** `react-photo-view` with custom toolbar and gallery mode integration.

**Timeline:** 5-7 days for complete feature including gallery mode
**Risk Level:** Low (proven library, no server-side complexity)
**Maintenance:** Low (minimal custom code, library handles complexity)
**Bundle Impact:** ~25KB gzipped (acceptable for feature set)

**Key Decisions:**
- ✅ No EXIF metadata extraction (keep it simple)
- ✅ No server-side image conversion (browser handles natively)
- ✅ No thumbnail generation yet (unclear storage strategy)
- ✅ Modern formats only (WebP supported, no legacy fallbacks)
- ✅ Gallery mode included from start (core feature)

This streamlined approach focuses on delivering excellent image viewing and gallery navigation without unnecessary complexity, following the elegant architecture principles from your development plan.
