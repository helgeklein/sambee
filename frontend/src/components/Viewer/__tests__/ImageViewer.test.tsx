import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import ImageViewer from "../ImageViewer";

vi.mock("yet-another-react-lightbox", () => ({
  __esModule: true,
  default: ({ slides, index }: { slides: Array<{ src: string }>; index: number }) => (
    <div data-testid="image-lightbox" data-current-src={slides[index]?.src ?? ""} />
  ),
}));

vi.mock("yet-another-react-lightbox/plugins/fullscreen", () => ({
  __esModule: true,
  default: {},
}));

vi.mock("yet-another-react-lightbox/plugins/zoom", () => ({
  __esModule: true,
  default: {},
}));

const mockUseCachedImageGallery = vi.fn(() => ({
  currentIndex: 0,
  setCurrentIndex: vi.fn(),
  currentPath: "/images/photo.jpg",
  filename: "photo.jpg",
  imageCacheRef: { current: new Map() },
  getCachedImageSrc: () => undefined,
  loadingStates: new Map(),
  errorStates: new Map(),
  showLoadingSpinner: false,
  markCachedImagesAsLoaded: vi.fn(),
}));

vi.mock("../../../hooks/useCachedImageGallery", () => ({
  useCachedImageGallery: () => mockUseCachedImageGallery(),
}));

vi.mock("../../../services/api", () => ({
  default: {
    getImageBlob: vi.fn(),
  },
}));

vi.mock("../../../services/logger", () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

describe("ImageViewer", () => {
  beforeEach(() => {
    mockUseCachedImageGallery.mockReset();
    mockUseCachedImageGallery.mockReturnValue({
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
      currentPath: "/images/photo.jpg",
      filename: "photo.jpg",
      imageCacheRef: { current: new Map() },
      getCachedImageSrc: () => undefined,
      loadingStates: new Map(),
      errorStates: new Map(),
      showLoadingSpinner: false,
      markCachedImagesAsLoaded: vi.fn(),
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("min-width"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("shows a read-only badge in the toolbar when opened in read-only mode", () => {
    render(
      <SambeeThemeProvider>
        <ImageViewer connectionId="conn-1" path="/images/photo.jpg" onClose={() => {}} isReadOnly={true} />
      </SambeeThemeProvider>
    );

    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("closes shortcuts help on Escape without closing the viewer", async () => {
    const onClose = vi.fn();

    render(
      <SambeeThemeProvider>
        <ImageViewer connectionId="conn-1" path="/images/photo.jpg" onClose={onClose} />
      </SambeeThemeProvider>
    );

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "?" });

    await waitFor(() => {
      expect(screen.getByText("Image viewer shortcuts")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Image viewer shortcuts")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders slide sources from the hook cache accessor instead of the raw cache ref", () => {
    mockUseCachedImageGallery.mockReturnValue({
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
      currentPath: "/images/photo.jpg",
      filename: "photo.jpg",
      imageCacheRef: { current: new Map([[0, "blob:stale-ref"]]) },
      getCachedImageSrc: (index: number) => (index === 0 ? "blob:fresh-accessor" : undefined),
      loadingStates: new Map(),
      errorStates: new Map(),
      showLoadingSpinner: false,
      markCachedImagesAsLoaded: vi.fn(),
    });

    render(
      <SambeeThemeProvider>
        <ImageViewer connectionId="conn-1" path="/images/photo.jpg" onClose={() => {}} images={["/images/photo.jpg"]} />
      </SambeeThemeProvider>
    );

    expect(screen.getByTestId("image-lightbox")).toHaveAttribute("data-current-src", "blob:fresh-accessor");
  });
});
