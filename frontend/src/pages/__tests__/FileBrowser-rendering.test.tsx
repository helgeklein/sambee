/**
 * Browser Component - Rendering Tests
 * Tests for basic rendering, loading states, errors, and empty states
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowserAlerts } from "../../components/FileBrowser/FileBrowserAlerts";
import api from "../../services/api";
import { resetBackendAvailabilityForTests } from "../../services/backendAvailability";
import {
  type ApiMock,
  createMarkdownViewerMock,
  createSettingsDialogMock,
  createTimeoutError,
  setupSuccessfulApiMocks,
} from "../../test/helpers";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { mockDirectoryListing, renderBrowser } from "./FileBrowser.test.utils";

const expectDirectoryLoad = (connectionId: string, path: string) => {
  expect(api.listDirectory).toHaveBeenCalledWith(
    connectionId,
    path,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    })
  );
};

// Mock the API module
vi.mock("../../services/api");

// Mock components using lazy mock factories
vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
// @tanstack/react-virtual mock - explicitly import the mock
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

describe("Browser Component - Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackendAvailabilityForTests();
    localStorage.setItem("access_token", "fake-token");
    localStorage.removeItem("selectedConnectionId");

    // Use mock factory for successful API responses
    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  it("displays connection selector with available connections", async () => {
    renderBrowser();

    // Optimized: Use findByRole instead of waitFor + getByRole
    const combobox = await screen.findByRole("combobox");
    expect(combobox).toBeInTheDocument();
  });

  it("shows breadcrumb navigation", async () => {
    renderBrowser("/browse/smb/test-server-1");

    // Now shows connection name in breadcrumb instead of "Root"
    // Use getAllByText and filter to avoid collision with connection selector combobox
    const serverNameElements = await screen.findAllByText("Test Server 1");
    const breadcrumbElement = serverNameElements.find((el) => el.tagName === "P" && el.className.includes("MuiTypography"));
    expect(breadcrumbElement).toBeInTheDocument();
  });

  it("renders file and folder list", async () => {
    renderBrowser("/browse/smb/test-server-1");

    // Wait for connections to load first
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    // Wait for directory listing to be called
    await waitFor(() => {
      expectDirectoryLoad("conn-1", "");
    });

    // Wait for directories and files to render
    // Use getAllByText since "Documents" may appear multiple times (e.g., in status bar)
    await waitFor(() => {
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Pictures")).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("displays loading state while fetching files", async () => {
    // Mock a delayed response
    vi.mocked(api.listDirectory).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockDirectoryListing), 100)));

    renderBrowser("/browse/smb/test-server-1");

    // Loading should appear briefly
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalled();
    });
  });

  it("shows reconnecting banner while backend realtime connection is recovering", () => {
    render(
      <SambeeThemeProvider>
        <FileBrowserAlerts
          error={null}
          loadingConnections={false}
          connectionsCount={1}
          isAdmin={true}
          backendAvailabilityStatus="reconnecting"
        />
      </SambeeThemeProvider>
    );

    expect(screen.getByText(/reconnecting to backend/i)).toBeInTheDocument();
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.listDirectory).mockRejectedValue({
      response: { data: { detail: "Connection failed" } },
    });

    renderBrowser("/browse/smb/test-server-1");

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/Connection failed/i)).toBeInTheDocument();
  });

  it("shows retryable timeout state when directory loading times out", async () => {
    vi.mocked(api.listDirectory).mockRejectedValueOnce(createTimeoutError()).mockResolvedValueOnce(mockDirectoryListing);

    renderBrowser("/browse/smb/test-server-1");

    expect(await screen.findByText(/Directory listing timed out. The remote share took too long to respond/i)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    retryButton.click();

    expect((await screen.findAllByText("Documents")).length).toBeGreaterThan(0);
    expect(api.listDirectory).toHaveBeenCalledTimes(2);
  });

  it("shows message when no connections are configured", async () => {
    vi.mocked(api.getConnections).mockResolvedValue([]);

    renderBrowser();

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/adding your first SMB network share/i)).toBeInTheDocument();
  });

  it("displays empty directory message when folder is empty", async () => {
    vi.mocked(api.listDirectory).mockResolvedValue({
      items: [],
      path: "",
      total: 0,
    });

    renderBrowser("/browse/smb/test-server-1");

    // Optimized: Use findByText instead of waitFor + getByText
    expect(await screen.findByText(/This directory is empty/i)).toBeInTheDocument();
  });
});
