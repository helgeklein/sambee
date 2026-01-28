# ViewerControls - Centralized Toolbar Component

## Overview

`ViewerControls` is a centralized, configurable toolbar component shared by both the Image and PDF viewers. It consolidates the common UI patterns and reduces code duplication.

## Location

`frontend/src/components/Viewer/ViewerControls.tsx`

## Purpose

Before centralization:
- `ImageControls.tsx` (195 lines) - Image-specific toolbar
- `PDFControls.tsx` (357 lines) - PDF-specific toolbar
- ~80% code duplication for common elements

After centralization:
- `ViewerControls.tsx` (489 lines) - Single configurable toolbar
- Both viewers use the same component with different configurations

## Configuration

The component uses a config-based approach where each viewer specifies which controls to display:

### Configuration Interface

```typescript
interface ViewerControlsConfig {
  navigation?: boolean;      // Gallery navigation (Previous/Next)
  pageNavigation?: boolean;  // PDF page navigation with input
  zoom?: boolean;            // Zoom controls
  rotation?: boolean;        // Image rotation controls
  search?: boolean;          // Search functionality
  download?: boolean;        // Download button
}
```

### State Interfaces

Each control type has a corresponding state interface:

- **NavigationState** - Gallery navigation (currentIndex, totalItems, onNext, onPrevious)
- **PageNavigationState** - PDF pages (currentPage, totalPages, onPageChange)
- **ZoomState** - Zoom controls (onZoomIn, onZoomOut)
- **RotationState** - Image rotation (onRotateLeft, onRotateRight)
- **SearchState** - Search functionality (searchText, matches, handlers)

## Usage Examples

### Image Viewer Configuration

```typescript
<ViewerControls
  filename={filename}
  config={{
    navigation: images.length > 1,
    zoom: true,
    rotation: true,
  }}
  onClose={handleClose}
  navigation={
    images.length > 1
      ? {
          currentIndex,
          totalItems: images.length,
          onNext: handleNext,
          onPrevious: handlePrevious,
        }
      : undefined
  }
  zoom={{
    onZoomIn: () => setScale(scale * 1.2),
    onZoomOut: () => setScale(scale * 0.8),
  }}
  rotation={{
    onRotateLeft: () => setRotate(rotate - 90),
    onRotateRight: () => setRotate(rotate + 90),
  }}
/>
```

### PDF Viewer Configuration

```typescript
<ViewerControls
  filename={filename}
  config={{
    pageNavigation: true,
    zoom: true,
    search: true,
    download: true,
  }}
  onClose={onClose}
  pageNavigation={{
    currentPage,
    totalPages: numPages,
    onPageChange: handlePageChange,
  }}
  zoom={{
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
  }}
  search={{
    searchText,
    onSearchChange: handleSearchChange,
    searchMatches,
    currentMatch,
    onSearchNext: handleSearchNext,
    onSearchPrevious: handleSearchPrevious,
  }}
  onDownload={handleDownload}
/>
```

## Features

### Common Features (Both Viewers)
- Filename display with text truncation
- Zoom in/out controls with keyboard shortcuts (+/-)
- Close button with Escape key shortcut
- Mobile-responsive layout
- Safe area insets for mobile devices
- Consistent styling and spacing

### Image-Specific Features
- Gallery navigation (Previous/Next image)
- Image counter (e.g., "2 / 5")
- Rotation controls (left/right with R/Shift+R shortcuts)

### PDF-Specific Features
- Page navigation with input field
- Page counter (e.g., "3 / 10")
- Search toggle with expandable search panel
- Search match counter
- Download button

## Layout

The toolbar uses a two-row layout:

1. **First row**: Filename and main controls (always visible)
   - Filename (truncated with ellipsis)
   - Navigation/page navigation buttons
   - Zoom controls (grouped together)
   - Rotation controls (images only)
   - Search toggle (PDFs only)
   - Download button (PDFs only)
   - Close button

2. **Second row**: Search panel (only when search is expanded)
   - Search input field
   - Match counter
   - Previous/Next match buttons

## Accessibility

- All buttons have `aria-label` attributes
- Keyboard shortcuts documented in tooltips (`title` attribute)
- Proper button disabled states
- Focus management for keyboard navigation

## Mobile Optimizations

- Reduced button sizes on mobile
- Fewer buttons visible (e.g., only zoom in, not zoom out)
- Responsive spacing and font sizes
- Safe area insets for notched devices
- Search panel expands to full width on mobile

## Testing

The component has comprehensive unit tests in:
`frontend/src/components/Viewer/__tests__/ViewerControls.test.tsx`

Tests cover:
- Rendering with different configurations
- Button click handlers
- Search panel toggle
- All control types (navigation, zoom, rotation, etc.)

## Benefits of Centralization

1. **Reduced Code Duplication**: Single source of truth for toolbar UI
2. **Consistency**: Both viewers have identical styling and behavior
3. **Maintainability**: Changes to toolbar affect both viewers automatically
4. **Type Safety**: TypeScript interfaces ensure correct configuration
5. **Testability**: Single set of tests covers both use cases
6. **Extensibility**: Easy to add new control types or viewers

## Migration Notes

### Old Components (Deprecated)
- `ImageControls.tsx` - Replaced by ViewerControls
- `PDFControls.tsx` - Replaced by ViewerControls

These files can be removed once the migration is confirmed stable.

### Breaking Changes
None - the old components are still present but unused.

## Future Enhancements

Potential additions that would benefit both viewers:
- Fullscreen toggle
- Print functionality
- Share button
- Presentation mode
- Thumbnail view toggle
- Settings/preferences menu
