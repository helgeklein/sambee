/**
 * Test utilities for Preview components
 */

// Mock for react-photo-view
export const createPhotoViewMock = () => ({
  PhotoProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="photo-provider">{children}</div>
  ),
  PhotoView: ({ children, src }: { children: React.ReactNode; src: string }) => (
    <div data-testid="photo-view" data-src={src}>
      {children}
    </div>
  ),
});

// Mock for MarkdownPreview component
export const createMarkdownPreviewMock = () => ({
  default: ({ path, onClose }: { connectionId: string; path: string; onClose: () => void }) => (
    <div data-testid="markdown-preview" data-path={path}>
      Markdown Preview
      <button onClick={onClose} type="button">
        Close
      </button>
    </div>
  ),
});

// Mock for ImagePreview component
export const createImagePreviewMock = () => ({
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
    <div data-testid="image-preview" data-path={path}>
      Image Preview: {path}
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
