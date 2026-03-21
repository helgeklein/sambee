import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DynamicViewer } from "../DynamicViewer";

const { mockGetViewerComponentLoadResult } = vi.hoisted(() => ({
  mockGetViewerComponentLoadResult: vi.fn(),
}));

vi.mock("../../../utils/FileTypeRegistry", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/FileTypeRegistry")>("../../../utils/FileTypeRegistry");
  return {
    ...actual,
    getViewerComponentLoadResult: mockGetViewerComponentLoadResult,
  };
});

describe("DynamicViewer", () => {
  const defaultProps = {
    connectionId: "conn-1",
    viewInfo: {
      path: "/docs/file.pdf",
      mimeType: "application/pdf",
      sessionId: "session-1",
    },
    onClose: vi.fn(),
    onIndexChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loaded viewer component", async () => {
    mockGetViewerComponentLoadResult.mockResolvedValue({
      status: "loaded",
      component: function LoadedViewer() {
        return <div data-testid="loaded-viewer">Loaded Viewer</div>;
      },
    });

    render(<DynamicViewer {...defaultProps} />);

    expect(await screen.findByTestId("loaded-viewer")).toBeInTheDocument();
  });

  it("shows a failure dialog when the viewer module cannot be loaded", async () => {
    mockGetViewerComponentLoadResult.mockResolvedValue({
      status: "failed",
      error: new Error("Loading chunk 42 failed"),
    });

    render(<DynamicViewer {...defaultProps} />);

    expect(await screen.findByRole("dialog", { name: /viewer unavailable/i })).toBeInTheDocument();
    expect(screen.getByText(/loading chunk 42 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/the file browser is still available/i)).toBeInTheDocument();
  });

  it("retries loading the viewer component from the failure dialog", async () => {
    mockGetViewerComponentLoadResult
      .mockResolvedValueOnce({
        status: "failed",
        error: new Error("Loading chunk 42 failed"),
      })
      .mockResolvedValueOnce({
        status: "loaded",
        component: function LoadedViewer() {
          return <div data-testid="loaded-viewer">Loaded Viewer</div>;
        },
      });

    render(<DynamicViewer {...defaultProps} />);

    const retryButton = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockGetViewerComponentLoadResult).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId("loaded-viewer")).toBeInTheDocument();
  });

  it("shows an unsupported dialog when no viewer exists", async () => {
    mockGetViewerComponentLoadResult.mockResolvedValue({ status: "unsupported" });

    render(<DynamicViewer {...defaultProps} />);

    expect(await screen.findByRole("dialog", { name: /viewer unsupported/i })).toBeInTheDocument();
    expect(screen.getByText(/does not have an available viewer/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
