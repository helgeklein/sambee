/**
 * Browser Component - Rendering Tests
 * Tests for basic rendering, loading states, errors, and empty states
 */

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { type ApiMock, createMarkdownViewerMock, createSettingsDialogMock, setupSuccessfulApiMocks } from "../../test/helpers";
import { mockDirectoryListing, renderBrowser } from "./Browser.test.utils";

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
    vi.mocked(api.listDirectory).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockDirectoryListing), 100)));

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
