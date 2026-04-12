import { Edit } from "@mui/icons-material";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerControls } from "../ViewerControls";

function mockMobileMode(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ViewerControls", () => {
  beforeEach(() => {
    mockMobileMode(false);
  });

  it("renders filename", () => {
    const mockClose = vi.fn();
    render(<ViewerControls filename="test.pdf" config={{}} onClose={mockClose} />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
  });

  it("renders a filename adornment next to the filename", () => {
    const mockClose = vi.fn();

    render(<ViewerControls filename="test.pdf" filenameAdornment={<span>Unsaved</span>} config={{}} onClose={mockClose} />);

    expect(screen.getByText("test.pdf")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
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

  it("hides gallery arrows on mobile", () => {
    mockMobileMode(true);
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
    expect(screen.queryByLabelText("Next")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Previous")).not.toBeInTheDocument();
  });

  it("hides zoom controls on mobile", () => {
    mockMobileMode(true);
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

    expect(screen.queryByLabelText("Zoom in")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zoom out")).not.toBeInTheDocument();
  });

  it("renders only rotate-right control on mobile", () => {
    mockMobileMode(true);
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

    expect(screen.queryByLabelText("Rotate left")).not.toBeInTheDocument();
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

  it("hides download button on mobile", () => {
    mockMobileMode(true);
    const mockClose = vi.fn();
    const mockDownload = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{ download: true }} onClose={mockClose} onDownload={mockDownload} />);

    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const mockClose = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{}} onClose={mockClose} />);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("omits the default close button when showCloseButton is false", () => {
    const mockClose = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{}} onClose={mockClose} showCloseButton={false} />);

    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("does not render zoom buttons on mobile", () => {
    mockMobileMode(true);
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

    expect(screen.queryByLabelText("Zoom in")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zoom out")).not.toBeInTheDocument();
    expect(mockZoomIn).not.toHaveBeenCalled();
    expect(mockZoomOut).not.toHaveBeenCalled();
  });

  it("calls rotate-right handler on mobile", () => {
    mockMobileMode(true);
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

    fireEvent.click(screen.getByLabelText("Rotate right"));
    expect(mockRotateRight).toHaveBeenCalledOnce();
    expect(mockRotateLeft).not.toHaveBeenCalled();
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
    expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument();

    // Click search button to show inline search UI in its place
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("focuses the search input when the search panel opens", async () => {
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

    fireEvent.click(screen.getByLabelText("Search"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search")).toHaveFocus();
    });
  });

  it("allows typing multiple characters into the search input", async () => {
    const mockClose = vi.fn();

    const ControlledViewerControls = () => {
      const [searchText, setSearchText] = useState("");

      return (
        <ViewerControls
          filename="test.pdf"
          config={{ search: true }}
          onClose={mockClose}
          search={{
            searchText,
            onSearchChange: setSearchText,
          }}
        />
      );
    };

    render(<ControlledViewerControls />);

    fireEvent.click(screen.getByLabelText("Search"));

    const searchInput = await screen.findByPlaceholderText("Search");
    fireEvent.change(searchInput, { target: { value: "pdf" } });

    await waitFor(() => {
      expect(searchInput).toHaveValue("pdf");
      expect(searchInput).toHaveFocus();
    });
  });

  it("keeps search navigation visible and enables it only when matches are available", async () => {
    const mockClose = vi.fn();
    const mockPrevious = vi.fn();
    const mockNext = vi.fn();

    const ControlledViewerControls = () => {
      const [searchText, setSearchText] = useState("");
      const hasMatches = searchText.trim().length > 0;

      return (
        <ViewerControls
          filename="test.pdf"
          config={{ search: true }}
          onClose={mockClose}
          search={{
            searchText,
            onSearchChange: setSearchText,
            searchMatches: hasMatches ? 3 : 0,
            currentMatch: hasMatches ? 1 : 0,
            onSearchPrevious: mockPrevious,
            onSearchNext: mockNext,
          }}
        />
      );
    };

    render(<ControlledViewerControls />);

    fireEvent.click(screen.getByLabelText("Search"));

    const searchInput = await screen.findByPlaceholderText("Search");
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();

    fireEvent.change(searchInput, { target: { value: "pdf" } });

    await waitFor(() => {
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous match" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Next match" })).toBeEnabled();
    });
  });

  it("renders share button on mobile when configured", () => {
    mockMobileMode(true);
    const mockClose = vi.fn();
    const mockShare = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{ share: true }} onClose={mockClose} onShare={mockShare} />);

    expect(screen.getByLabelText("Share")).toBeInTheDocument();
    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument();
  });

  it("disables share button when shareDisabled is true", () => {
    mockMobileMode(true);
    const mockClose = vi.fn();
    const mockShare = vi.fn();

    render(<ViewerControls filename="test.pdf" config={{ share: true }} onClose={mockClose} onShare={mockShare} shareDisabled />);

    expect(screen.getByLabelText("Share")).toBeDisabled();
  });

  it("warms share payload on pointer intent before click", () => {
    mockMobileMode(true);
    const mockClose = vi.fn();
    const mockShare = vi.fn();
    const mockShareIntent = vi.fn();

    render(
      <ViewerControls
        filename="test.pdf"
        config={{ share: true }}
        onClose={mockClose}
        onShare={mockShare}
        onShareIntent={mockShareIntent}
      />
    );

    fireEvent.pointerDown(screen.getByLabelText("Share"));

    expect(mockShareIntent).toHaveBeenCalledOnce();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("renders and invokes generic toolbar actions", () => {
    const mockClose = vi.fn();
    const mockEdit = vi.fn();
    const mockSave = vi.fn();

    render(
      <ViewerControls
        filename="notes.md"
        config={{}}
        onClose={mockClose}
        actions={[
          { id: "edit", label: "Edit", onClick: mockEdit },
          { id: "save", label: "Save", onClick: mockSave, disabled: true },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(mockEdit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("renders icon toolbar actions when requested", () => {
    const mockClose = vi.fn();
    const mockEdit = vi.fn();

    render(
      <ViewerControls
        filename="notes.md"
        config={{}}
        onClose={mockClose}
        actions={[
          {
            id: "edit",
            kind: "icon",
            label: "Edit",
            ariaLabel: "Edit markdown",
            icon: <Edit />,
            onClick: mockEdit,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit markdown" }));

    expect(mockEdit).toHaveBeenCalledOnce();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("supports mixed text and icon toolbar actions", () => {
    const mockClose = vi.fn();
    const mockEdit = vi.fn();
    const mockSave = vi.fn();

    render(
      <ViewerControls
        filename="notes.md"
        config={{}}
        onClose={mockClose}
        actions={[
          {
            id: "edit",
            kind: "icon",
            label: "Edit",
            ariaLabel: "Edit markdown",
            icon: <Edit />,
            onClick: mockEdit,
          },
          {
            id: "save",
            label: "Save",
            onClick: mockSave,
            variant: "outlined",
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockEdit).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();
  });
});
