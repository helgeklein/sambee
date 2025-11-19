import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewerControls } from "../ViewerControls";

describe("ViewerControls", () => {
  it("renders filename", () => {
    const mockClose = vi.fn();
    render(<ViewerControls filename="test.pdf" config={{}} onClose={mockClose} />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
  });

  it("renders navigation buttons when configured", () => {
    const mockClose = vi.fn();
    const mockNext = vi.fn();
    const mockPrevious = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ navigation: true }}
        onClose={mockClose}
        navigation={{
          currentIndex: 0,
          totalItems: 3,
          onNext: mockNext,
          onPrevious: mockPrevious,
        }}
      />
    );

    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Next")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous")).toBeInTheDocument();
  });

  it("renders zoom controls when configured", () => {
    const mockClose = vi.fn();
    const mockZoomIn = vi.fn();
    const mockZoomOut = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ zoom: true }}
        onClose={mockClose}
        zoom={{
          onZoomIn: mockZoomIn,
          onZoomOut: mockZoomOut,
        }}
      />
    );

    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
  });

  it("renders rotation controls when configured", () => {
    const mockClose = vi.fn();
    const mockRotateLeft = vi.fn();
    const mockRotateRight = vi.fn();

    render(
      <ViewerControls
        filename="test.jpg"
        config={{ rotation: true }}
        onClose={mockClose}
        rotation={{
          onRotateLeft: mockRotateLeft,
          onRotateRight: mockRotateRight,
        }}
      />
    );

    expect(screen.getByLabelText("Rotate left")).toBeInTheDocument();
    expect(screen.getByLabelText("Rotate right")).toBeInTheDocument();
  });

  it("renders page navigation for PDFs when configured", () => {
    const mockClose = vi.fn();
    const mockPageChange = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ pageNavigation: true }}
        onClose={mockClose}
        pageNavigation={{
          currentPage: 1,
          totalPages: 10,
          onPageChange: mockPageChange,
        }}
      />
    );

    expect(screen.getByText("/ 10")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
  });

  it("renders search controls when configured", () => {
    const mockClose = vi.fn();
    const mockSearchChange = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ search: true }}
        onClose={mockClose}
        search={{
          searchText: "",
          onSearchChange: mockSearchChange,
        }}
      />
    );

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
  });

  it("renders download button when configured", () => {
    const mockClose = vi.fn();
    const mockDownload = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ download: true }}
        onClose={mockClose}
        onDownload={mockDownload}
      />
    );

    expect(screen.getByLabelText("Download")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const mockClose = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{}} onClose={mockClose} />);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("calls zoom handlers when zoom buttons clicked", () => {
    const mockClose = vi.fn();
    const mockZoomIn = vi.fn();
    const mockZoomOut = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ zoom: true }}
        onClose={mockClose}
        zoom={{
          onZoomIn: mockZoomIn,
          onZoomOut: mockZoomOut,
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(mockZoomIn).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(mockZoomOut).toHaveBeenCalledOnce();
  });

  it("calls rotation handlers when rotation buttons clicked", () => {
    const mockClose = vi.fn();
    const mockRotateLeft = vi.fn();
    const mockRotateRight = vi.fn();

    render(
      <ViewerControls
        filename="test.jpg"
        config={{ rotation: true }}
        onClose={mockClose}
        rotation={{
          onRotateLeft: mockRotateLeft,
          onRotateRight: mockRotateRight,
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Rotate left"));
    expect(mockRotateLeft).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Rotate right"));
    expect(mockRotateRight).toHaveBeenCalledOnce();
  });

  it("toggles search panel when search button clicked", () => {
    const mockClose = vi.fn();
    const mockSearchChange = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ search: true }}
        onClose={mockClose}
        search={{
          searchText: "",
          onSearchChange: mockSearchChange,
        }}
      />
    );

    // Search panel should not be visible initially
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();

    // Click search button to show panel
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();

    // Click again to hide
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });
});
