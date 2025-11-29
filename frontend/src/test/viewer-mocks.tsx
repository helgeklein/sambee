/**
 * Test utilities for View components
 */

// Mock for react-photo-view
export const createPhotoViewMock = () => ({
  PhotoProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="photo-provider">{children}</div>,
  PhotoView: ({ children, src }: { children: React.ReactNode; src: string }) => (
    <div data-testid="photo-view" data-src={src}>
      {children}
    </div>
  ),
});

// Mock for MarkdownView component
export const createMarkdownViewMock = () => ({
  default: ({ path, onClose }: { connectionId: string; path: string; onClose: () => void }) => (
    <div data-testid="markdown-view" data-path={path}>
      Markdown View
      <button onClick={onClose} type="button">
        Close
      </button>
    </div>
  ),
});

// Mock for ImageView component
export const createImageViewMock = () => ({
  default: ({
    path,
    onClose,
    images,
    currentIndex,
  }: {
    connectionId: string;
    path: string;
    onClose: () => void;
    images?: string[];
    currentIndex?: number;
  }) => (
    <div data-testid="image-view" data-path={path}>
      Image View: {path}
      {images && images.length > 1 && (
        <span data-testid="gallery-info">
          {(currentIndex ?? 0) + 1} / {images.length}
        </span>
      )}
      <button onClick={onClose} type="button">
        Close
      </button>
    </div>
  ),
});
