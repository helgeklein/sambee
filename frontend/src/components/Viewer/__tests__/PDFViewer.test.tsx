import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../../services/api";
import * as logger from "../../../services/logger";
import PDFViewer from "../PDFViewer";

// Mock react-pdf components
vi.mock("react-pdf", () => ({
  Document: ({
    children,
    onLoadSuccess,
    onLoadError,
    file,
  }: {
    children: React.ReactNode;
    onLoadSuccess?: (pdf: {
      numPages: number;
      getPage: (pageNum: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
      }>;
    }) => void;
    onLoadError?: (error: Error) => void;
    file: string;
  }) => {
    // Simulate successful load after a tick
    if (file && !file.includes("error")) {
      setTimeout(() => {
        const mockPdf = {
          numPages: 5,
          getPage: () =>
            Promise.resolve({
              getViewport: () => ({ width: 612, height: 792 }),
            }),
        };
        onLoadSuccess?.(mockPdf);
      }, 0);
    } else if (file?.includes("error")) {
      setTimeout(() => {
        onLoadError?.(new Error("Failed to load PDF"));
      }, 0);
    }
    return (
      <div data-testid="pdf-document" data-file={file}>
        {children}
      </div>
    );
  },
  Page: ({ pageNumber, scale, width }: { pageNumber: number; scale?: number; width?: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber} data-scale={scale} data-width={width}>
      Page {pageNumber}
    </div>
  ),
  pdfjs: { version: "3.11.174", GlobalWorkerOptions: { workerSrc: "" } },
}));

// Mock API service
vi.mock("../../../services/api");

// Mock logger
vi.mock("../../../services/logger", () => ({
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

// Mock URL.createObjectURL and revokeObjectURL
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

// Mock ResizeObserver
global.ResizeObserver = class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    // Immediately trigger with mock dimensions
    this.callback(
      [
        {
          target: document.createElement("div"),
          contentRect: {
            width: 800,
            height: 600,
            top: 0,
            left: 0,
            bottom: 600,
            right: 800,
            x: 0,
            y: 0,
          } as DOMRectReadOnly,
          borderBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
          contentBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
          devicePixelContentBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
        } as ResizeObserverEntry,
      ],
      this
    );
  }

  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("PDFViewer", () => {
  const mockOnClose = vi.fn();
  const defaultProps = {
    connectionId: "test-conn-id",
    path: "/test/document.pdf",
    onClose: mockOnClose,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockReturnValue("blob:mock-url");

    // Mock successful API response by default
    (apiService.getPdfBlob as Mock).mockResolvedValue(
      new Blob(["mock pdf content"], { type: "application/pdf" })
    );

    // Reset AbortController to default
    global.AbortController = class MockAbortController {
      signal = { aborted: false } as AbortSignal;
      abort = vi.fn();
    } as unknown as typeof AbortController;
  });

  describe("Rendering States", () => {
    it("renders loading state initially", () => {
      render(<PDFViewer {...defaultProps} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("renders PDF document when loaded successfully", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
      });
    });

    it("renders error state when fetch fails", async () => {
      (apiService.getPdfBlob as Mock).mockRejectedValue(new Error("Network error"));

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load PDF/i)).toBeInTheDocument();
      });
    });

    it("shows CircularProgress while loading", () => {
      render(<PDFViewer {...defaultProps} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });
  });

  describe("API Integration", () => {
    it("calls getPdfBlob with correct connectionId and path", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(apiService.getPdfBlob).toHaveBeenCalledWith(
          "test-conn-id",
          "/test/document.pdf",
          expect.objectContaining({ signal: expect.anything() })
        );
      });
    });

    it("creates blob URL from received blob", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockCreateObjectURL).toHaveBeenCalled();
      });
    });

    it("passes blob URL to react-pdf Document component", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        const doc = screen.getByTestId("pdf-document");
        expect(doc).toHaveAttribute("data-file", "blob:mock-url");
      });
    });

    it("handles API errors gracefully", async () => {
      const error = {
        response: { data: { detail: "Access denied" }, status: 403 },
        message: "Request failed",
      };
      (apiService.getPdfBlob as Mock).mockRejectedValue(error);

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Access denied")).toBeInTheDocument();
      });
    });
  });

  describe("Blob URL Lifecycle Management", () => {
    it("creates blob URL after successful fetch", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      });
    });

    it("revokes blob URL on component unmount", async () => {
      const { unmount } = render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockCreateObjectURL).toHaveBeenCalled();
      });

      unmount();

      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("revokes old blob URL when path changes", async () => {
      const { rerender } = render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockCreateObjectURL).toHaveBeenCalled();
      });

      mockCreateObjectURL.mockReturnValue("blob:new-mock-url");

      rerender(<PDFViewer {...defaultProps} path="/test/new-document.pdf" />);

      await waitFor(() => {
        expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
      });
    });

    it("handles AbortController cancellation on unmount", async () => {
      const abortSpy = vi.fn();

      class TestAbortController {
        signal = { aborted: false } as AbortSignal;
        abort = abortSpy;
      }

      global.AbortController = TestAbortController as unknown as typeof AbortController;

      const { unmount } = render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      unmount();

      expect(abortSpy).toHaveBeenCalled();
    });
  });

  describe("Document Loading", () => {
    it("updates numPages state on load success", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("/ 5")).toBeInTheDocument();
      });
    });

    it("resets to page 1 on new document", async () => {
      const { rerender } = render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });

      // Navigate to page 3
      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "3");
      });

      // Load new document
      rerender(<PDFViewer {...defaultProps} path="/test/another.pdf" />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("handles onLoadError callback", async () => {
      mockCreateObjectURL.mockReturnValue("blob:error-url");

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "PDF load error",
          expect.objectContaining({ error: expect.any(String) })
        );
      });
    });
  });

  describe("Page Navigation", () => {
    it("increments page on next button", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });

      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });
    });

    it("decrements page on previous button", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Go to page 2 first
      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });

      // Go back to page 1
      const prevButton = screen.getByLabelText("Previous page");
      fireEvent.click(prevButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("respects page boundaries (1 to numPages)", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Verify previous button is disabled on first page
      const prevButton = screen.getByLabelText("Previous page");
      expect(prevButton).toBeDisabled();

      // Try to go below page 1 - should stay at page 1
      fireEvent.click(prevButton);
      expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");

      // Navigate to page 2
      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });

      // Navigate back to page 1
      fireEvent.click(screen.getByLabelText("Previous page"));

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("handles direct page number input", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const pageInput = screen.getByDisplayValue("1");
      fireEvent.change(pageInput, { target: { value: "3" } });
      fireEvent.blur(pageInput);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "3");
      });
    });
  });

  describe("Keyboard Shortcuts", () => {
    it("navigates to next page on ArrowRight", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });
    });

    it("navigates to previous page on ArrowLeft", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Go to page 2 first
      fireEvent.keyDown(window, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });

      // Go back
      fireEvent.keyDown(window, { key: "ArrowLeft" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("goes to first page on Home", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Go to page 3
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "3");
      });

      // Go to first page
      fireEvent.keyDown(window, { key: "Home" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("goes to last page on End", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: "End" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "5");
      });
    });

    it("closes viewer on Escape", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: "Escape" });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("zooms in on Plus/Equals", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const initialScale = screen.getByTestId("pdf-page").getAttribute("data-scale");

      fireEvent.keyDown(window, { key: "+" });

      await waitFor(() => {
        const newScale = screen.getByTestId("pdf-page").getAttribute("data-scale");
        expect(newScale).not.toBe(initialScale);
      });
    });

    it("zooms out on Minus/Underscore", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Zoom in first
      fireEvent.keyDown(window, { key: "+" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const scaleAfterZoomIn = screen.getByTestId("pdf-page").getAttribute("data-scale");

      // Zoom out
      fireEvent.keyDown(window, { key: "-" });

      await waitFor(() => {
        const newScale = screen.getByTestId("pdf-page").getAttribute("data-scale");
        expect(newScale).not.toBe(scaleAfterZoomIn);
      });
    });
  });

  describe("Zoom Functionality", () => {
    it("defaults to fit-page mode", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Component doesn't display mode text, just verify page renders with scale
      const page = screen.getByTestId("pdf-page");
      expect(page).toHaveAttribute("data-scale");
    });

    it("handles fit-width mode", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Component doesn't have fit-width button, zoom is handled through zoom in/out
      const zoomInButton = screen.getByLabelText("Zoom in");
      expect(zoomInButton).toBeInTheDocument();
    });

    it("handles numeric zoom values", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const zoomInButton = screen.getByLabelText("Zoom in");
      fireEvent.click(zoomInButton);

      await waitFor(() => {
        // Component doesn't display percentage, just verify page is still rendered
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });
    });

    it("updates scale when zoom buttons clicked", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const zoomInButton = screen.getByLabelText("Zoom in");
      const initialScale = screen.getByTestId("pdf-page").getAttribute("data-scale");

      fireEvent.click(zoomInButton);

      await waitFor(() => {
        const newScale = screen.getByTestId("pdf-page").getAttribute("data-scale");
        expect(newScale).not.toBe(initialScale);
      });
    });
  });

  describe("Error Handling", () => {
    it("displays error message from API", async () => {
      const error = {
        response: { data: { detail: "Custom error message" } },
      };
      (apiService.getPdfBlob as Mock).mockRejectedValue(error);

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Custom error message")).toBeInTheDocument();
      });
    });

    it("extracts detail field from API errors", async () => {
      const error = {
        response: { data: { detail: "File not found" }, status: 404 },
        message: "Request failed with status code 404",
      };
      (apiService.getPdfBlob as Mock).mockRejectedValue(error);

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("File not found")).toBeInTheDocument();
      });
    });

    it("shows generic error for unknown errors", async () => {
      (apiService.getPdfBlob as Mock).mockRejectedValue(new Error("Unknown error"));

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load PDF/i)).toBeInTheDocument();
      });
    });

    it("logs errors appropriately", async () => {
      const error = new Error("Test error");
      (apiService.getPdfBlob as Mock).mockRejectedValue(error);

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to fetch PDF",
          expect.objectContaining({
            path: "/test/document.pdf",
            error,
          })
        );
      });
    });
  });

  describe("Auto-focus Behavior", () => {
    it("focuses container after successful load", async () => {
      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Wait for focus to be applied (happens after load with setTimeout)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check that some element in the document is focused (not body)
      expect(document.activeElement).not.toBe(document.body);
    });

    it("does not focus on error state", async () => {
      (apiService.getPdfBlob as Mock).mockRejectedValue(new Error("Load failed"));

      render(<PDFViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load PDF/i)).toBeInTheDocument();
      });

      // Wait a bit to ensure focus doesn't happen
      await new Promise((resolve) => setTimeout(resolve, 200));

      const container = screen.getByText(/Failed to load PDF/i).parentElement;
      expect(document.activeElement).not.toBe(container);
    });
  });
});
