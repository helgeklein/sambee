import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import ImageViewer from "../ImageViewer";

vi.mock("yet-another-react-lightbox", () => ({
  __esModule: true,
  default: () => <div data-testid="image-lightbox" />,
}));

vi.mock("yet-another-react-lightbox/plugins/fullscreen", () => ({
  __esModule: true,
  default: {},
}));

vi.mock("yet-another-react-lightbox/plugins/zoom", () => ({
  __esModule: true,
  default: {},
}));

vi.mock("../../../hooks/useCachedImageGallery", () => ({
  useCachedImageGallery: () => ({
    currentIndex: 0,
    setCurrentIndex: vi.fn(),
    currentPath: "/images/photo.jpg",
    filename: "photo.jpg",
    imageCacheRef: { current: new Map() },
    loadingStates: {},
    errorStates: {},
    showLoadingSpinner: false,
    markCachedImagesAsLoaded: vi.fn(),
  }),
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
});
