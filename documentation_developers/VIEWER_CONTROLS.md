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

## Search Architecture Notes

The search UI in `ViewerControls` is shared, but the search engine itself is viewer-specific.

- **PDF viewer:** Uses extracted PDF text plus page-level match tracking and overlay highlights.
- **Rendered Markdown/text viewers:** Use the shared DOM text search utility in `frontend/src/utils/domTextSearch.ts`.
- **Markdown edit mode:** Uses MDXEditor's `searchPlugin` and `useEditorSearch` hook through a bridge in `frontend/src/components/Viewer/MarkdownRichEditor.tsx`.

### DOM Text Search Utility

The DOM text search utility exists so rendered text viewers can share one implementation for:

- search term matching
- match counting
- current-match activation
- DOM highlight cleanup

### Why Inline Boundaries Are Searchable

Rendered Markdown often splits visible text across inline elements such as:

- emphasis (`<em>`)
- strong text (`<strong>`)
- links (`<a>`)
- inline code wrappers

Users still perceive that content as one continuous string, so the DOM text search utility builds a logical text index across inline nodes and maps logical matches back to one or more physical highlight elements.

Example:

```html
sam<strong>bee</strong>
```

Searching for `sambee` should count as one match, not two partial matches.

### Why Block Boundaries Are Not Searchable

The DOM text search utility intentionally inserts logical separators between block-level elements such as paragraphs, list items, table cells, and headings.

This prevents false positives where text from separate visual blocks would otherwise be concatenated into a single searchable string.

Example:

```html
<p>sam</p>
<p>bee</p>
```

Searching for `sambee` should **not** match across those two paragraphs.

### Guidance for Future Text-Based Viewers

If you add another rendered text viewer:

- reuse `ViewerControls` for the search panel and navigation controls
- reuse `frontend/src/utils/domTextSearch.ts` for rendered-content matching
- preserve the same rule: inline boundaries are searchable, block boundaries are not

If you add an editor search experience later, keep it separate from the rendered-view DOM search utility.

### Markdown Edit-Mode Search

Markdown edit mode deliberately does not reuse `domTextSearch.ts`.

- The rendered-view search utility mutates the rendered DOM with highlight wrappers, which is correct for read-only content.
- MDXEditor is an active Lexical editor, so edit-mode search uses the editor's own search primitives and CSS highlight ranges instead.
- The outer viewer still owns the search row in `ViewerControls`, but `MarkdownViewer` routes that UI to different backends depending on mode.

Current behavior:

- **Rendered mode:** `MarkdownViewer` drives `domTextSearch.ts`.
- **Edit mode, rich-text view:** `MarkdownViewer` passes search state into `MarkdownRichEditor`, which bridges it to MDXEditor's `searchPlugin`.
- **Edit mode, source/diff view:** The shared viewer search action is disabled because the rich-text search plugin does not reliably cover embedded CodeMirror editors.

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
