# PDF Viewer Component - Design Plan

## Overview

A client-side PDF viewer component that enables in-browser PDF viewing with search capabilities, following established patterns from the ImageViewer component.

## Requirements

### Core Requirements
1. **Client-side rendering** - PDF must be rendered in the browser to enable search functionality
2. **Search capability** - Users must be able to search text within PDFs
3. **Navigation** - Page-by-page navigation with keyboard shortcuts
4. **Responsive** - Works on desktop and mobile devices
5. **Consistent UX** - Follows patterns established by ImageViewer

### Technical Requirements
- React component using TypeScript
- Material-UI for consistent styling
- Proper error handling and loading states
- Memory-efficient blob URL management
- React StrictMode compatibility

## Library Selection

### Recommended: react-pdf + pdfjs-dist

**Why react-pdf:**
- Built on PDF.js (Mozilla's proven PDF renderer)
- React-friendly API with hooks
- Active maintenance and community
- Built-in text layer support for search
- Canvas-based rendering for precise control

**Key Dependencies:**
```json
{
  "react-pdf": "^10.0.0",
  "pdfjs-dist": "^4.0.0"
}
```

**Alternatives Considered:**
- `@react-pdf-viewer/core` - More complex, less flexible
- Raw PDF.js - Too low-level, reinventing the wheel
- `react-pdf-js` - Abandoned, outdated

## Architecture

### Component Structure

```
PDFViewer.tsx (Main component)
├── PDFControls.tsx (Toolbar component)
└── PDFSearchPanel.tsx (Search UI - optional initial scope)
```

### Component Hierarchy

**Option A: ImageViewer Pattern (Recommended)**
```tsx
<Dialog fullScreen PaperProps={{ overflow: 'hidden' }}>
  <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ flexShrink: 0, zIndex: 1 }}>
      <PDFControls />
    </Box>
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', minHeight: 0 }}>
      <Document file={pdfUrl}>
        <Page />
      </Document>
    </Box>
  </Box>
</Dialog>
```

**Option B: MarkdownViewer Pattern (Alternative)**
```tsx
<Dialog
  open={true}
  onClose={onClose}
  fullScreen={isMobile}
  maxWidth="xl"
>
  <DialogTitle>
    {filename}
    <IconButton onClick={onClose}><CloseIcon /></IconButton>
  </DialogTitle>
  <DialogContent sx={{ overflow: 'auto', p: 0 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PDFControls />
      <Box sx={{ flex: 1 }}>
        <Document file={pdfUrl}>
          <Page />
        </Document>
      </Box>
    </Box>
  </DialogContent>
</Dialog>
```

**Recommendation:** Use Option A (ImageViewer pattern) for fullscreen PDF viewing experience.

### Props Interface

```tsx
interface ViewerComponentProps {
  connectionId: string;
  path: string;
  onClose: () => void;
  // Not applicable for PDFs (no gallery mode)
  images?: string[];
  currentIndex?: number;
  onCurrentIndexChange?: (index: number) => void;
}
```

## Key Lessons from ImageViewer and MarkdownViewer

### ✅ Patterns to Follow

1. **Blob URL Management (CRITICAL - from ImageViewer)**
   ```tsx
   useEffect(() => {
     let isMounted = true;
     let blobUrl: string | null = null;
     const abortController = new AbortController();
     
     const fetchPdf = async () => {
       // Fetch via API with auth headers
       const blob = await apiService.getPdfBlob(connectionId, path, {
         signal: abortController.signal
       });
       
       if (!isMounted) return;
       
       blobUrl = URL.createObjectURL(blob);
       setPdfUrl(blobUrl);
     };
     
     fetchPdf();
     
     return () => {
       isMounted = false;
       abortController.abort();
       if (blobUrl) {
         URL.revokeObjectURL(blobUrl);
       }
     };
   }, [connectionId, path]);
   ```
   
   **Why:** Prevents memory leaks and React StrictMode double-mounting issues

2. **Layout Structure**
   ```tsx
   <Box sx={{
     position: 'relative',
     width: '100%',
     height: '100%',
     display: 'flex',
     flexDirection: 'column',
     overflow: 'hidden'
   }}>
     {/* Controls - doesn't shrink */}
     <Box sx={{ flexShrink: 0, zIndex: 1 }}>
       <PDFControls />
     </Box>
     
     {/* Content area - fills remaining space */}
     <Box sx={{
       flex: 1,
       display: 'flex',
       alignItems: 'center',
       justifyContent: 'center',
       overflow: 'hidden',
       minHeight: 0  // CRITICAL for flex overflow
     }}>
       {/* PDF content */}
     </Box>
   </Box>
   ```
   
   **Why:** Ensures controls don't shrink and content fills available space

3. **Loading States**
   - Show previous content while loading (prevents flicker)
   - Use CircularProgress overlay with semi-transparent background
   - Don't clear content until new content is ready

4. **Error Handling**
   ```tsx
   const getErrorMessage = (err: unknown): string => {
     if (isApiError(err) && err.response?.data?.detail) {
       return err.response.data.detail;
     }
     // Extract detailed error from axios/network errors
     return "Failed to load PDF";
   };
   ```

5. **Keyboard Shortcuts**
   - Arrow keys for navigation (next/previous page)
   - Escape to close
   - +/- for zoom
   - Home/End for first/last page
   - Enter for fullscreen
   - Prevent default on relevant keys

6. **Mobile Considerations**
   - Responsive controls (smaller on mobile)
   - Touch gestures (double-tap to zoom)
   - Safe area insets for notched displays
   - Appropriate button sizes for touch targets

7. **Separate Controls Component**
   - Keep toolbar logic separate from viewer logic
   - Pass state and handlers via props
   - Easier to test and maintain

8. **TypeScript Strict Mode**
   - Proper type definitions
   - No `any` types
   - Null checks for optional props

9. **Simple Dialog Usage (from MarkdownViewer)**
   ```tsx
   <Dialog
     open={true}
     onClose={onClose}
     fullScreen={fullScreen}
     maxWidth="xl"
     sx={{
       '& .MuiDialog-container': {
         width: '100vw',
         maxWidth: '100vw'
       },
       '& .MuiDialog-paper': {
         width: { xs: '100vw', sm: 'calc(100vw - 64px)' },
         maxWidth: { xs: '100vw', sm: '1200px' },
         height: { xs: '100vh', sm: '90vh' },
         margin: { xs: 0, sm: 4 }
       }
     }}
   >
   ```
   
   **Why:** MarkdownViewer uses a simpler dialog pattern than ImageViewer's fullscreen approach. This could be appropriate for PDFs if we want desktop windowed mode.

10. **Text Content Fetching Pattern (from MarkdownViewer)**
    ```tsx
    useEffect(() => {
      const loadContent = async () => {
        try {
          setLoading(true);
          setError(null);
          const data = await apiService.getFileContent(connectionId, path);
          setContent(data);
        } catch (err) {
          setError("Failed to load markdown file");
          logError("Error loading markdown:", { error: err });
        } finally {
          setLoading(false);
        }
      };
      
      loadContent();
    }, [connectionId, path]);
    ```
    
    **Why:** Cleaner pattern for async loading with proper error handling. No need for isMounted check since we're using state setters (React handles unmounted updates).

11. **Auto-focus Content Area (from MarkdownViewer)**
    ```tsx
    useEffect(() => {
      if (!loading && !error && contentRef.current) {
        setTimeout(() => {
          contentRef.current?.focus();
        }, 100);
      }
    }, [loading, error]);
    ```
    
    **Why:** Enables keyboard scrolling immediately. Important for keyboard navigation in PDF viewer.

12. **Width Constraint Strategy (from MarkdownViewer)**
    ```tsx
    sx={{
      minWidth: 0,
      width: '100%',
      maxWidth: '100%',
      // Ensure all children respect container width
      '& *': {
        boxSizing: 'border-box',
        minWidth: 0,
        maxWidth: '100%'
      }
    }}
    ```
    
    **Why:** Prevents content overflow on narrow screens. Critical for responsive design.

13. **DialogTitle Pattern (from MarkdownViewer)**
    ```tsx
    <DialogTitle sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: 1,
      borderColor: 'divider'
    }}>
      <Typography variant="h6">{filename}</Typography>
      <IconButton onClick={onClose}>
        <CloseIcon />
      </IconButton>
    </DialogTitle>
    ```
    
    **Why:** Clean title bar with filename and close button. Could complement or replace custom toolbar approach.

14. **Overflow Handling (from MarkdownViewer)**
    ```tsx
    <DialogContent
      sx={{
        overflowY: 'auto',
        overflowX: 'hidden',
        height: '100%',
        minWidth: 0
      }}
    >
    ```
    
    **Why:** Proper overflow configuration prevents layout issues on mobile.

### 🤔 Architectural Decisions

**Dialog Approach: Fullscreen vs. Windowed**

ImageViewer uses fullscreen dialog:
```tsx
<Dialog 
  fullScreen
  PaperProps={{ sx: { backgroundColor: 'rgba(0, 0, 0, 0.9)' }}}
>
```

MarkdownViewer uses responsive dialog:
```tsx
<Dialog
  fullScreen={isMobile}  // Only fullscreen on mobile
  maxWidth="xl"
  sx={{ '& .MuiDialog-paper': { height: '90vh' }}}
>
```

**Recommendation for PDF Viewer:**
- **Fullscreen mode** (like ImageViewer) is better for PDFs
- Provides maximum reading space
- Consistent with image viewing experience
- PDFs benefit from large viewport (like images)
- Can add windowed mode as future enhancement

**Toolbar Approach: Custom vs. DialogTitle**

ImageViewer uses custom toolbar:
```tsx
<Box sx={{ flexShrink: 0 }}>
  <ImageControls {...props} />
</Box>
```

MarkdownViewer uses DialogTitle:
```tsx
<DialogTitle>
  {/* Title and close button */}
</DialogTitle>
```

**Recommendation for PDF Viewer:**
- **Custom toolbar** (like ImageViewer) is better for PDFs
- Need space for navigation, zoom, search controls
- DialogTitle too limited for PDF controls
- Can use DialogTitle pattern for simple viewers only

**Content Loading: Text vs. Blob**

MarkdownViewer fetches text content:
```tsx
const data = await apiService.getFileContent(connectionId, path);
setContent(data); // String
```

ImageViewer fetches blob and creates URL:
```tsx
const blob = await apiService.getImageBlob(connectionId, path);
const blobUrl = URL.createObjectURL(blob);
setImageUrl(blobUrl); // URL string
```

**Recommendation for PDF Viewer:**
- **Blob URL approach** (like ImageViewer) required
- react-pdf expects file URL or Uint8Array
- Blob approach enables proper cleanup
- Maintains authentication via API call

### ❌ Mistakes to Avoid

1. **Don't use refs for blob URLs** (ImageViewer lesson)
   - Use local variables in effect closures instead
   - Refs can cause stale closures and memory leaks

2. **Don't forget minHeight: 0 on flex children**
   - Required for proper overflow behavior in flex layouts
   - Missing this causes content to not shrink properly

3. **Don't clear content immediately on load**
   - Causes jarring flicker
   - Keep showing previous content until new content ready

4. **Don't forget AbortController**
   - Without it, in-flight requests continue after unmount
   - Can cause memory leaks and state updates after unmount

5. **Don't hardcode dimensions**
   - Use flexbox and percentages
   - Let content adapt to container size

6. **Don't forget React.StrictMode compatibility**
   - Effects run twice in development
   - Must handle cleanup properly

7. **Don't use overly complex dialog configurations** (MarkdownViewer lesson)
   - Keep dialog props simple when fullscreen is sufficient
   - Avoid unnecessary sx overrides
   - Let MUI defaults work when possible

8. **Don't forget to handle width constraints** (MarkdownViewer lesson)
   - Set minWidth: 0 to prevent flex overflow
   - Use maxWidth: '100%' to prevent content from expanding
   - Apply boxSizing: 'border-box' consistently

9. **Don't skip the finally block in loading** (MarkdownViewer lesson)
   ```tsx
   try {
     setLoading(true);
     // load content
   } catch (err) {
     setError(message);
   } finally {
     setLoading(false);  // Always runs
   }
   ```
   - Ensures loading state is cleared even on error
   - Prevents stuck loading indicators

10. **Don't forget auto-focus for keyboard navigation** (MarkdownViewer lesson)
    - Focus content area after load
    - Enables immediate keyboard shortcuts
    - Use small delay (100ms) for dialog transition

## Feature Specifications

### 1. Content Loading

**Async Loading Pattern (from MarkdownViewer):**
```tsx
useEffect(() => {
  let isMounted = true;
  let blobUrl: string | null = null;
  const abortController = new AbortController();
  
  const loadPdf = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const blob = await apiService.getPdfBlob(connectionId, path, {
        signal: abortController.signal
      });
      
      if (!isMounted) return;
      
      blobUrl = URL.createObjectURL(blob);
      setPdfUrl(blobUrl);
    } catch (err) {
      if (!isMounted) return;
      setError(getErrorMessage(err));
      logError("Failed to load PDF", { error: err, path });
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };
  
  loadPdf();
  
  return () => {
    isMounted = false;
    abortController.abort();
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
  };
}, [connectionId, path]);
```

**Key Improvements:**
- Uses `finally` block to ensure loading state cleared (MarkdownViewer pattern)
- Combines blob URL management from ImageViewer
- Proper abort controller for cleanup
- Structured error handling with logging

**Auto-focus After Load (from MarkdownViewer):**
```tsx
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!loading && !error && containerRef.current) {
    setTimeout(() => {
      containerRef.current?.focus();
    }, 100);
  }
}, [loading, error]);

// In JSX:
<Box ref={containerRef} tabIndex={0} sx={{ '&:focus': { outline: 'none' }}}>
  {/* PDF content */}
</Box>
```

### 2. Page Navigation

**Controls:**
- Previous page button (disabled on first page)
- Next page button (disabled on last page)
- Page number input (allows jumping to specific page)
- Total page count display

**Keyboard Shortcuts:**
- `ArrowLeft` / `ArrowRight` - Previous/Next page
- `Home` - First page
- `End` - Last page
- `PageUp` / `PageDown` - Previous/Next page (alternative)

**State Management:**
```tsx
const [numPages, setNumPages] = useState<number>(0);
const [pageNumber, setPageNumber] = useState<number>(1);

const handleDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
  setNumPages(numPages);
  setPageNumber(1);
};
```

### 3. Zoom Controls

**Zoom Modes:**
- `fit-page` - Fit entire page in viewport (default)
- `fit-width` - Fit page width, scroll vertically
- Custom zoom - 50% to 300%

**Controls:**
- Zoom in button (+)
- Zoom out button (-)
- Zoom percentage dropdown or input
- Fit page button
- Fit width button

**Keyboard Shortcuts:**
- `+` / `=` - Zoom in
- `-` / `_` - Zoom out

**Implementation:**
```tsx
type ZoomMode = 'fit-page' | 'fit-width' | number;
const [scale, setScale] = useState<ZoomMode>('fit-page');

// Calculate scale for fit modes
const pageScale = useMemo(() => {
  if (scale === 'fit-page') {
    // Calculate based on container dimensions
    return containerHeight / PAGE_HEIGHT;
  } else if (scale === 'fit-width') {
    return containerWidth / PAGE_WIDTH;
  }
  return scale; // Numeric zoom
}, [scale, containerHeight, containerWidth]);
```

### 4. Search Functionality

**Phase 1 - Basic Search (MVP):**
- Search input field in toolbar
- Find next/previous match buttons
- Highlight current match
- Show match count (e.g., "3 of 12")
- Navigate between matches

**Phase 2 - Advanced Search (Future):**
- Case-sensitive toggle
- Whole word toggle
- Regular expression support
- Search results panel with context
- Highlight all matches simultaneously

**Implementation Strategy:**
```tsx
const [searchText, setSearchText] = useState<string>('');
const [searchMatches, setSearchMatches] = useState<number>(0);
const [currentMatch, setCurrentMatch] = useState<number>(0);

// react-pdf provides text layer support
// Use onLoadSuccess callback to access text content
const handleLoadSuccess = (page: any) => {
  page.getTextContent().then((textContent: any) => {
    // Extract and search text
    const text = textContent.items.map((item: any) => item.str).join(' ');
    // Implement search logic
  });
};
```

**UX Considerations:**
- Debounce search input (300ms) to avoid excessive re-renders
- Show "No matches found" when appropriate
- Clear search on document close
- Persist search term while navigating pages
- Auto-focus search input when opened with keyboard shortcut

### 5. PDF Rendering

**react-pdf Configuration:**
```tsx
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = 
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

<Document
  file={pdfUrl}
  onLoadSuccess={handleDocumentLoadSuccess}
  onLoadError={handleLoadError}
  loading={<CircularProgress />}
  error={<Alert severity="error">Failed to load PDF</Alert>}
>
  <Page
    pageNumber={pageNumber}
    scale={pageScale}
    renderTextLayer={true}  // Required for search
    renderAnnotationLayer={true}  // For links and forms
    loading={<CircularProgress />}
  />
</Document>
```

**Performance Considerations:**
- Only render current page (not all pages)
- Use canvas rendering for better performance
- Consider virtualizing pages for very large PDFs (future enhancement)
- Lazy load PDF.js worker

### 6. Responsive Design

**Desktop:**
- Toolbar at top with full controls
- Comfortable spacing and button sizes
- Display filename in toolbar

**Mobile:**
- Compact toolbar
- Smaller buttons
- Bottom sheet for search (optional)
- Touch gestures for navigation (swipe)
- Hide less critical buttons (use dropdown menu)

**Safe Area Handling:**
```tsx
paddingTop: `calc(${theme.spacing(1)} + env(safe-area-inset-top, 0px))`,
paddingBottom: `env(safe-area-inset-bottom, 0px)`
```

### 7. Content Area Width Constraints

**From MarkdownViewer - Preventing Overflow:**
```tsx
<Box
  sx={{
    // Critical width constraints
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    
    // Ensure PDF pages don't overflow container
    '& .react-pdf__Page': {
      maxWidth: '100%',
      height: 'auto'
    },
    
    // Ensure canvas respects container
    '& .react-pdf__Page__canvas': {
      maxWidth: '100%',
      height: 'auto !important',
      width: 'auto !important'
    }
  }}
>
  <Document file={pdfUrl}>
    <Page />
  </Document>
</Box>
```

**Why This Matters:**
- Prevents horizontal scrolling on narrow screens
- Ensures PDF fits within viewport
- Critical for mobile responsiveness
- Learned from MarkdownViewer's careful width management

### 8. Download Support

**Features:**
- Download original PDF button in toolbar
- Preserve original filename
- Show download progress (optional)

**Implementation:**
```tsx
const handleDownload = () => {
  const downloadUrl = apiService.getDownloadUrl(connectionId, path);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  link.click();
};
```

## API Integration

### New API Endpoint Required

```python
@router.get("/viewer/{connection_id}/pdf")
async def get_pdf_blob(
    connection_id: str,
    path: str = Query(...),
    current_user: User = Depends(get_current_user)
) -> Response:
    """
    Fetch PDF file as blob for client-side rendering.
    Similar to get_image_blob but for PDFs.
    """
    # Validate connection ownership
    # Fetch file from SMB share
    # Return as application/pdf with proper headers
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="{filename}"'
        }
    )
```

### Frontend API Service

```typescript
// In src/services/api.ts
async getPdfBlob(
  connectionId: string,
  path: string,
  options?: { signal?: AbortSignal }
): Promise<Blob> {
  const token = localStorage.getItem("access_token");
  const response = await this.api.get(
    `/viewer/${connectionId}/pdf`,
    {
      params: { path },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "blob",
      signal: options?.signal,
    }
  );
  return response.data;
}
```

## File Type Registry Integration

```typescript
// In src/utils/FileTypeRegistry.ts
{
  extensions: ['.pdf'],
  mimeTypes: ['application/pdf'],
  category: 'document',
  viewerComponent: () => import('../components/Viewer/PDFViewer'),
  icon: 'pdf',
  color: '#d32f2f',
  description: 'PDF Document',
}
```

## Testing Strategy

### Unit Tests

1. **PDFViewer Component**
   - Renders loading state
   - Renders error state
   - Calls API with correct parameters
   - Cleans up blob URL on unmount
   - Handles keyboard shortcuts
   - Navigation buttons work correctly

2. **PDFControls Component**
   - Renders all controls
   - Calls handlers with correct arguments
   - Disables buttons appropriately
   - Mobile responsive behavior

### Integration Tests

1. **Full Workflow**
   - Open PDF from file browser
   - Navigate pages
   - Search within PDF
   - Zoom in/out
   - Close viewer

2. **Error Scenarios**
   - Network failure during load
   - Invalid PDF file
   - Access denied
   - Missing file

### Performance Tests

1. **Memory Leaks**
   - Verify blob URLs are revoked
   - Check memory usage after opening/closing multiple PDFs
   - Verify AbortController cancels requests

2. **Rendering Performance**
   - Large PDF files (100+ pages)
   - High-resolution pages
   - Page navigation speed

## Implementation Phases

### Phase 1 - MVP (Core Functionality)
- [x] Design plan (this document)
- [ ] Install dependencies (react-pdf, pdfjs-dist)
- [ ] Configure Vite for PDF.js worker
- [ ] Create basic PDFViewer component
- [ ] Create PDFControls component
- [ ] Implement page navigation
- [ ] Implement zoom (fit-page, fit-width, numeric)
- [ ] Add to FileTypeRegistry
- [ ] Backend API endpoint for PDF blob
- [ ] Basic error handling
- [ ] Loading states
- [ ] Unit tests
- [ ] Integration tests

### Phase 2 - Search (High Priority)
- [ ] Basic text search UI
- [ ] Search navigation (next/previous)
- [ ] Highlight current match
- [ ] Match counter
- [ ] Clear search functionality
- [ ] Keyboard shortcut for search (Ctrl+F / Cmd+F)

### Phase 3 - Polish
- [ ] Download button
- [ ] Fullscreen support
- [ ] Rotation
- [ ] Mobile optimizations
- [ ] Touch gestures
- [ ] Print support

### Phase 4 - Advanced Features (Future)
- [ ] Advanced search options
- [ ] Search results panel
- [ ] Highlight all matches
- [ ] Page thumbnails sidebar
- [ ] Annotation support
- [ ] Form filling support
- [ ] Multi-page view (side-by-side)
- [ ] Thumbnail navigation (optional)
- [ ] Bookmark support (optional)

## Performance Considerations

### Memory Management
- Revoke blob URLs immediately on unmount
- Only render current page (not all pages)
- Clear search results when not needed
- Use React.memo for expensive components

### Rendering Optimization
- Use canvas rendering (default in react-pdf)
- Implement page caching for adjacent pages (future)
- Lazy load PDF.js worker
- Debounce resize events

### Bundle Size
- PDF.js worker loaded separately (code splitting)
- react-pdf is ~200KB gzipped
- pdfjs-dist worker is ~500KB gzipped
- Total addition: ~700KB (acceptable for PDF viewing)

## Security Considerations

1. **Authentication**
   - All PDF requests include auth token
   - Backend validates user access to file
   - No direct file URLs exposed

2. **Content Security**
   - Blob URLs are temporary and revoked
   - PDFs rendered in sandboxed canvas
   - No arbitrary JavaScript execution from PDFs

3. **Rate Limiting**
   - Backend should rate-limit PDF requests
   - Prevent abuse of conversion/download

## Documentation Updates Required

### User Documentation
- Update VIEWER_SUPPORT.md
- Add PDF to supported file types
- Document keyboard shortcuts
- Document search functionality

### Developer Documentation
- Component architecture
- Testing guidelines
- Adding new features to PDF viewer
- Troubleshooting common issues

## Success Metrics

### Functionality
- ✅ PDFs open and render correctly
- ✅ All pages accessible via navigation
- ✅ Search finds text in PDFs
- ✅ Zoom works smoothly
- ✅ Keyboard shortcuts functional
- ✅ Mobile responsive

### Performance
- ✅ Page load time < 2 seconds for typical PDFs
- ✅ Page navigation < 500ms
- ✅ Search response < 1 second
- ✅ No memory leaks after 10 open/close cycles

### UX
- ✅ Consistent with ImageViewer patterns
- ✅ Intuitive controls
- ✅ Helpful error messages
- ✅ Smooth animations

## Risk Assessment

### High Risk
- **PDF.js compatibility** - Some PDFs may not render correctly
  - Mitigation: Test with diverse PDF files, provide fallback to download
  
- **Performance with large PDFs** - Memory issues with 100+ page PDFs
  - Mitigation: Only render current page, add warnings for large files

### Medium Risk
- **Search performance** - Slow on large documents
  - Mitigation: Debounce search input, show progress indicator

- **Mobile experience** - Touch gestures may conflict with zoom/pan
  - Mitigation: Test thoroughly on real devices, use established gesture libraries

### Low Risk
- **Browser compatibility** - PDF.js is well-supported
- **Bundle size** - Acceptable for the functionality provided

## Summary: Lessons from Both Viewers

### From ImageViewer
✅ Blob URL management with AbortController
✅ Fullscreen dialog approach
✅ Custom toolbar for rich controls
✅ Proper flex layout (flexShrink: 0, flex: 1, minHeight: 0)
✅ Gallery navigation patterns
✅ Loading state management (don't clear content immediately)
✅ Comprehensive keyboard shortcuts
✅ Mobile touch gestures

### From MarkdownViewer
✅ Simple async loading pattern with finally block
✅ Auto-focus content area for keyboard navigation
✅ Width constraint strategy (minWidth: 0, maxWidth: 100%)
✅ Responsive dialog sizing with mobile fullscreen
✅ Clean DialogTitle pattern (for reference)
✅ Proper overflow handling
✅ Content padding for readability

### Best Practices Synthesis

**For PDF Viewer, combine the best of both:**

1. **Loading Pattern:** MarkdownViewer's clean async + ImageViewer's blob management
2. **Dialog Approach:** ImageViewer's fullscreen (PDFs need space like images)
3. **Toolbar:** ImageViewer's custom controls (PDFs need many controls)
4. **Layout:** ImageViewer's flex structure + MarkdownViewer's width constraints
5. **Focus:** MarkdownViewer's auto-focus pattern (critical for keyboard nav)
6. **Error Handling:** MarkdownViewer's finally block + ImageViewer's detailed errors
7. **Mobile:** ImageViewer's safe areas + MarkdownViewer's responsive sizing

## Conclusion

This design synthesizes proven patterns from both ImageViewer and MarkdownViewer, taking the best aspects of each:

- **ImageViewer contributions:** Blob management, fullscreen UX, rich controls, gallery navigation
- **MarkdownViewer contributions:** Clean loading pattern, auto-focus, width constraints, finally blocks

The result is a robust PDF viewer that:
1. Properly manages blob URL lifecycle (ImageViewer lesson)
2. Uses clean async patterns with finally blocks (MarkdownViewer lesson)
3. Implements fullscreen viewing with rich controls (ImageViewer pattern)
4. Prevents overflow with proper width constraints (MarkdownViewer lesson)
5. Auto-focuses for immediate keyboard navigation (MarkdownViewer lesson)
6. Handles errors gracefully (both viewers)
7. Works responsively on mobile and desktop (both viewers)

The phased approach ensures core functionality is delivered quickly while maintaining extensibility for future enhancements.
