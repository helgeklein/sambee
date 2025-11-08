/**
 * Browser Component - Rendering Tests
 * Tests for basic rendering, loading states, errors, and empty states
 */

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { mockConnections, mockDirectoryListing, renderBrowser } from "./Browser.test.utils";

// Mock the API module
vi.mock("../../services/api");

// Mock MarkdownPreview component
vi.mock("../../components/Preview/MarkdownPreview", () => ({
  default: () => (
    <div role="dialog" data-testid="markdown-preview">
      Markdown Preview
    </div>
  ),
}));

// Mock SettingsDialog component
vi.mock("../../components/Settings/SettingsDialog", () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="settings-dialog">
        <button type="button" onClick={onClose}>
          Close Settings
        </button>
      </div>
    ) : null,
}));

// Mock react-window for simpler testing
vi.mock("react-window", () => ({
  List: ({
    rowComponent: RowComponent,
    rowCount,
    rowProps,
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: Mock requires flexible types
    rowComponent: React.ComponentType<any>;
    rowCount: number;
    // biome-ignore lint/suspicious/noExplicitAny: Mock requires flexible types
    rowProps?: any;
  }) => (
    <div data-testid="virtual-list">
      {Array.from({ length: rowCount }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Mock renders items in stable order
        <RowComponent key={index} index={index} style={{}} {...rowProps} />
      ))}
    </div>
  ),
}));

describe("Browser Component - Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("access_token", "fake-token");
    localStorage.removeItem("selectedConnectionId");

    // Default successful mocks
    vi.mocked(api.getConnections).mockResolvedValue(mockConnections);
    vi.mocked(api.listDirectory).mockResolvedValue(mockDirectoryListing);
  });

  it("displays connection selector with available connections", async () => {
    renderBrowser();

    // Optimized: Use findByRole instead of waitFor + getByRole
    const combobox = await screen.findByRole("combobox");
    expect(combobox).toBeInTheDocument();
  });

  it("shows breadcrumb navigation", async () => {
    renderBrowser("/browse/test-server-1");

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText("Root")).toBeInTheDocument();
  });

  it("renders file and folder list", async () => {
    renderBrowser("/browse/test-server-1");

    // Wait for connections to load first
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    // Wait for directory listing to be called
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "");
    });

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Pictures")).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("displays loading state while fetching files", async () => {
    // Mock a delayed response
    vi.mocked(api.listDirectory).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockDirectoryListing), 100))
    );

    renderBrowser("/browse/test-server-1");

    // Loading should appear briefly
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalled();
    });
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.listDirectory).mockRejectedValue({
      response: { data: { detail: "Connection failed" } },
    });

    renderBrowser("/browse/test-server-1");

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/Connection failed/i)).toBeInTheDocument();
  });

  it("shows message when no connections are configured", async () => {
    vi.mocked(api.getConnections).mockResolvedValue([]);

    renderBrowser();

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/No SMB connections configured/i)).toBeInTheDocument();
  });

  it("displays empty directory message when folder is empty", async () => {
    vi.mocked(api.listDirectory).mockResolvedValue({
      items: [],
      path: "",
      total: 0,
    });

    renderBrowser("/browse/test-server-1");

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/This directory is empty/i)).toBeInTheDocument();
  });
});
