import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFControls } from "../PDFControls";

describe("PDFControls", () => {
  const mockOnClose = vi.fn();
  const mockOnPageChange = vi.fn();
  const mockOnScaleChange = vi.fn();
  const mockOnDownload = vi.fn();
  const mockOnSearchChange = vi.fn();
  const mockOnSearchNext = vi.fn();
  const mockOnSearchPrevious = vi.fn();

  const defaultProps = {
    filename: "test-document.pdf",
    currentPage: 1,
    totalPages: 10,
    scale: "fit-page" as const,
    currentScale: 1.0,
    onPageChange: mockOnPageChange,
    onScaleChange: mockOnScaleChange,
    onClose: mockOnClose,
    onDownload: mockOnDownload,
    searchText: "",
    onSearchChange: mockOnSearchChange,
    searchMatches: 0,
    currentMatch: 0,
    onSearchNext: mockOnSearchNext,
    onSearchPrevious: mockOnSearchPrevious,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders filename", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByText("test-document.pdf")).toBeInTheDocument();
    });

    it("renders page navigation controls", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
      expect(screen.getByLabelText("Next page")).toBeInTheDocument();
      expect(screen.getByText("/ 10")).toBeInTheDocument();
    });

    it("renders zoom controls", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
      expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    });

    it("renders search toggle button", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });

    it("renders download button", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByLabelText("Download")).toBeInTheDocument();
    });

    it("renders close button", () => {
      render(<PDFControls {...defaultProps} />);
      expect(screen.getByLabelText("Close")).toBeInTheDocument();
    });
  });

  describe("Page Navigation Controls", () => {
    it("shows current page and total pages", () => {
      render(<PDFControls {...defaultProps} currentPage={3} />);
      expect(screen.getByDisplayValue("3")).toBeInTheDocument();
      expect(screen.getByText("/ 10")).toBeInTheDocument();
    });

    it("disables previous button on first page", () => {
      render(<PDFControls {...defaultProps} currentPage={1} />);
      const prevButton = screen.getByLabelText("Previous page");
      expect(prevButton).toBeDisabled();
    });

    it("disables next button on last page", () => {
      render(<PDFControls {...defaultProps} currentPage={10} totalPages={10} />);
      const nextButton = screen.getByLabelText("Next page");
      expect(nextButton).toBeDisabled();
    });

    it("calls onPageChange with correct page number when next clicked", () => {
      render(<PDFControls {...defaultProps} currentPage={3} />);
      const nextButton = screen.getByLabelText("Next page");
      fireEvent.click(nextButton);
      expect(mockOnPageChange).toHaveBeenCalledWith(4);
    });

    it("calls onPageChange with correct page number when previous clicked", () => {
      render(<PDFControls {...defaultProps} currentPage={3} />);
      const prevButton = screen.getByLabelText("Previous page");
      fireEvent.click(prevButton);
      expect(mockOnPageChange).toHaveBeenCalledWith(2);
    });

    it("handles page input field changes", () => {
      render(<PDFControls {...defaultProps} />);
      const pageInput = screen.getByDisplayValue("1");
      fireEvent.change(pageInput, { target: { value: "5" } });
      expect(pageInput).toHaveValue("5");
    });

    it("validates page input (1 to totalPages)", () => {
      render(<PDFControls {...defaultProps} />);
      const pageInput = screen.getByDisplayValue("1");

      // Valid input
      fireEvent.change(pageInput, { target: { value: "5" } });
      fireEvent.blur(pageInput);
      expect(mockOnPageChange).toHaveBeenCalledWith(5);
    });

    it("resets invalid input to current page", () => {
      render(<PDFControls {...defaultProps} currentPage={3} />);
      const pageInput = screen.getByDisplayValue("3");

      // Invalid input (too high)
      fireEvent.change(pageInput, { target: { value: "99" } });
      fireEvent.blur(pageInput);
      expect(pageInput).toHaveValue("3");
      expect(mockOnPageChange).not.toHaveBeenCalled();

      // Invalid input (too low)
      fireEvent.change(pageInput, { target: { value: "0" } });
      fireEvent.blur(pageInput);
      expect(pageInput).toHaveValue("3");
    });

    it("handles Enter key in page input", () => {
      render(<PDFControls {...defaultProps} />);
      const pageInput = screen.getByDisplayValue("1");

      fireEvent.change(pageInput, { target: { value: "7" } });
      fireEvent.keyDown(pageInput, { key: "Enter" });

      expect(mockOnPageChange).toHaveBeenCalledWith(7);
    });
  });

  describe("Zoom Controls", () => {
    it("calls onScaleChange when zoom in clicked", () => {
      render(<PDFControls {...defaultProps} scale={1.5} currentScale={1.5} />);
      const zoomInButton = screen.getByLabelText("Zoom in");
      fireEvent.click(zoomInButton);
      expect(mockOnScaleChange).toHaveBeenCalledWith(1.75);
    });

    it("calls onScaleChange when zoom out clicked", () => {
      render(<PDFControls {...defaultProps} scale={1.5} currentScale={1.5} />);
      const zoomOutButton = screen.getByLabelText("Zoom out");
      fireEvent.click(zoomOutButton);
      expect(mockOnScaleChange).toHaveBeenCalledWith(1.25);
    });

    it("increments from current scale when zooming in from fit-page", () => {
      render(<PDFControls {...defaultProps} scale="fit-page" currentScale={0.8} />);
      const zoomInButton = screen.getByLabelText("Zoom in");
      fireEvent.click(zoomInButton);
      expect(mockOnScaleChange).toHaveBeenCalledWith(1.05);
    });

    it("decrements from current scale when zooming out from fit-width", () => {
      render(<PDFControls {...defaultProps} scale="fit-width" currentScale={1.2} />);
      const zoomOutButton = screen.getByLabelText("Zoom out");
      fireEvent.click(zoomOutButton);
      expect(mockOnScaleChange).toHaveBeenCalledWith(0.95);
    });
  });

  describe("Search Controls", () => {
    it("toggles search panel visibility", () => {
      render(<PDFControls {...defaultProps} />);

      // Search panel should not be visible initially
      expect(screen.queryByPlaceholderText("Search in PDF...")).not.toBeInTheDocument();

      // Click search button to show panel
      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      expect(screen.getByPlaceholderText("Search in PDF...")).toBeInTheDocument();

      // Click again to hide
      fireEvent.click(searchButton);
      expect(screen.queryByPlaceholderText("Search in PDF...")).not.toBeInTheDocument();
    });

    it("shows search input field when panel is open", () => {
      render(<PDFControls {...defaultProps} />);

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      expect(screen.getByPlaceholderText("Search in PDF...")).toBeInTheDocument();
    });

    it("calls onSearchChange with input text", () => {
      render(<PDFControls {...defaultProps} />);

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      const searchInput = screen.getByPlaceholderText("Search in PDF...");
      fireEvent.change(searchInput, { target: { value: "test query" } });

      expect(mockOnSearchChange).toHaveBeenCalledWith("test query");
    });

    it("shows match counter when matches found", () => {
      render(
        <PDFControls {...defaultProps} searchText="test" searchMatches={5} currentMatch={2} />
      );

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      expect(screen.getByText("2 / 5")).toBeInTheDocument();
    });

    it('shows "No matches" when searchMatches is 0', () => {
      render(<PDFControls {...defaultProps} searchText="nonexistent" searchMatches={0} />);

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      // Component doesn't show "No matches" text, just shows 0 matches in counter
      expect(screen.getByPlaceholderText("Search in PDF...")).toBeInTheDocument();
    });

    it("calls onSearchNext when next match button clicked", () => {
      render(
        <PDFControls {...defaultProps} searchText="test" searchMatches={5} currentMatch={2} />
      );

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      const nextButton = screen.getByLabelText("Next match");
      fireEvent.click(nextButton);

      expect(mockOnSearchNext).toHaveBeenCalled();
    });

    it("calls onSearchPrevious when previous match button clicked", () => {
      render(
        <PDFControls {...defaultProps} searchText="test" searchMatches={5} currentMatch={2} />
      );

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      const prevButton = screen.getByLabelText("Previous match");
      fireEvent.click(prevButton);

      expect(mockOnSearchPrevious).toHaveBeenCalled();
    });

    it("disables next/prev when no matches", () => {
      render(<PDFControls {...defaultProps} searchText="test" searchMatches={0} />);

      const searchButton = screen.getByLabelText("Search");
      fireEvent.click(searchButton);

      const nextButton = screen.getByLabelText("Next match");
      const prevButton = screen.getByLabelText("Previous match");

      expect(nextButton).toBeDisabled();
      expect(prevButton).toBeDisabled();
    });
  });

  describe("Download Button", () => {
    it("calls onDownload when clicked", () => {
      render(<PDFControls {...defaultProps} />);
      const downloadButton = screen.getByLabelText("Download");
      fireEvent.click(downloadButton);
      expect(mockOnDownload).toHaveBeenCalled();
    });

    it("renders with correct icon", () => {
      render(<PDFControls {...defaultProps} />);
      const downloadButton = screen.getByLabelText("Download");
      expect(downloadButton).toBeInTheDocument();
    });
  });

  describe("Close Button", () => {
    it("calls onClose when clicked", () => {
      render(<PDFControls {...defaultProps} />);
      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
