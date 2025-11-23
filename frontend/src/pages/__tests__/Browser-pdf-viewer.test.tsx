/**
 * Browser Component - PDF Viewer Integration Tests
 * Tests for PDF file viewing workflows
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../services/api";
import { FileType } from "../../types";
import Browser from "../Browser";

// Mock the API service
vi.mock("../../services/api");
const mockedApi = apiService as MockedObject<typeof apiService>;

// Mock @tanstack/react-virtual
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

// Mock react-pdf
vi.mock("react-pdf", () => ({
  Document: ({
    children,
    onLoadSuccess,
    file,
  }: {
    children: React.ReactNode;
    onLoadSuccess?: (pdf: {
      numPages: number;
      getPage: (pageNum: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
      }>;
    }) => void;
    file: string;
  }) => {
    // Simulate successful load
    setTimeout(() => {
      const mockPdf = {
        numPages: 10,
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 612, height: 792 }),
          }),
      };
      onLoadSuccess?.(mockPdf);
    }, 0);
    return (
      <div data-testid="pdf-document" data-file={file}>
        {children}
      </div>
    );
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber}>
      PDF Page {pageNumber}
    </div>
  ),
  pdfjs: { version: "3.11.174", GlobalWorkerOptions: { workerSrc: "" } },
}));

// Mock ResizeObserver
global.ResizeObserver = class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
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

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:mock-pdf-url");
global.URL.revokeObjectURL = vi.fn();

describe("Browser - PDF Viewer Integration", () => {
  const renderBrowser = (initialPath = "/browse/test-server") => {
    return render(
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/browse/:connectionId/*" element={<Browser />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up authentication
    localStorage.setItem("access_token", "fake-token");

    // Mock successful API responses
    mockedApi.getConnections.mockResolvedValue([
      {
        id: "test-server",
        name: "Test Server",
        type: "smb",
        host: "test.local",
        share_name: "share",
        port: 445,
        username: "user",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ]);

    // Mock PDF blob response
    mockedApi.getPdfBlob.mockResolvedValue(
      new Blob(["mock pdf content"], { type: "application/pdf" })
    );

    // Mock download URL
    mockedApi.getDownloadUrl.mockReturnValue("/api/viewer/test-server/download?path=/document.pdf");
  });

  describe("Opening PDF", () => {
    it("opens PDF viewer when clicking PDF file", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser();

      // Wait for file to load
      const pdfFile = await screen.findByText("document.pdf");
      expect(pdfFile).toBeInTheDocument();

      // Click on PDF file
      fireEvent.click(pdfFile);

      // Should open PDF viewer
      await waitFor(() => {
        expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
      });
    });

    it("displays PDF filename in viewer", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "report.pdf",
            path: "/report.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser();

      const pdfFile = await screen.findByText("report.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByText("report.pdf")).toBeInTheDocument();
      });
    });

    it("loads and renders PDF document", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });
  });

  describe("Page Navigation Workflow", () => {
    beforeEach(async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
    });

    it("navigates to next page using button", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });

      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });
    });

    it("navigates to previous page using button", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Go to page 2
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

    it("jumps to specific page via input", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const pageInput = screen.getByDisplayValue("1");
      fireEvent.change(pageInput, { target: { value: "5" } });
      fireEvent.blur(pageInput);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "5");
      });
    });

    it("navigates using keyboard (ArrowLeft/Right)", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });

      // Navigate forward
      fireEvent.keyDown(window, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "2");
      });

      // Navigate backward
      fireEvent.keyDown(window, { key: "ArrowLeft" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("goes to first page (Home key)", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Go to page 5
      const pageInput = screen.getByDisplayValue("1");
      fireEvent.change(pageInput, { target: { value: "5" } });
      fireEvent.blur(pageInput);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "5");
      });

      // Press Home
      fireEvent.keyDown(window, { key: "Home" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });
    });

    it("goes to last page (End key)", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "1");
      });

      fireEvent.keyDown(window, { key: "End" });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toHaveAttribute("data-page", "10");
      });
    });
  });

  describe("Closing Viewer", () => {
    beforeEach(async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
    });

    it("closes on close button click", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId("pdf-page")).not.toBeInTheDocument();
      });
    });

    it("closes on Escape key", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByTestId("pdf-page")).not.toBeInTheDocument();
      });
    });

    it("returns to file browser after closing", async () => {
      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId("pdf-page")).not.toBeInTheDocument();
        // File should still be visible in browser
        expect(screen.getByText("document.pdf")).toBeInTheDocument();
      });
    });
  });

  describe("Error Scenarios", () => {
    it("displays error when PDF fetch fails", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      mockedApi.getPdfBlob.mockRejectedValue(new Error("Network error"));

      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load PDF/i)).toBeInTheDocument();
      });
    });

    it("shows error for access denied", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document.pdf",
            path: "/document.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      mockedApi.getPdfBlob.mockRejectedValue({
        response: { data: { detail: "Access denied" }, status: 403 },
      });

      renderBrowser();

      const pdfFile = await screen.findByText("document.pdf");
      fireEvent.click(pdfFile);

      await waitFor(() => {
        expect(screen.getByText("Access denied")).toBeInTheDocument();
      });
    });
  });

  describe("Multiple PDFs", () => {
    it("cleans up previous PDF when opening new one", async () => {
      mockedApi.listDirectory.mockResolvedValue({
        path: "/",
        items: [
          {
            name: "document1.pdf",
            path: "/document1.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
          {
            name: "document2.pdf",
            path: "/document2.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-02T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 2,
      });

      const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL");

      renderBrowser();

      // Open first PDF
      const pdf1 = await screen.findByText("document1.pdf");
      fireEvent.click(pdf1);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });

      // Close it
      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId("pdf-page")).not.toBeInTheDocument();
      });

      // Verify cleanup
      expect(revokeObjectURLSpy).toHaveBeenCalled();

      // Open second PDF
      const pdf2 = await screen.findByText("document2.pdf");
      fireEvent.click(pdf2);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page")).toBeInTheDocument();
      });
    });
  });
});
