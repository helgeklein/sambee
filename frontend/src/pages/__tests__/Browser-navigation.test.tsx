/**
 * Browser Component - Navigation Tests
 * Tests for directory navigation, breadcrumbs, URL handling, and connection switching
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import {
  type ApiMock,
  createMarkdownPreviewMock,
  createSettingsDialogMock,
  setupNavigationApiMocks,
} from "../../test/helpers";
import type { FileInfo } from "../../types";
import { FileType } from "../../types";
import { mockDirectoryListing, renderBrowser } from "./Browser.test.utils";

// Mock the API module
vi.mock("../../services/api");

// Mock components using lazy mock factories
vi.mock("../../components/Preview/MarkdownPreview", () => createMarkdownPreviewMock());
vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
// @tanstack/react-virtual mock - explicitly import the mock
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

describe("Browser Component - Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("access_token", "fake-token");
    localStorage.removeItem("selectedConnectionId");

    // Use navigation mock factory for directory navigation tests
    setupNavigationApiMocks(api as unknown as ApiMock);
  });

  it("navigates into folder when clicking directory", async () => {
    const subfolderFiles: FileInfo[] = [
      {
        name: "file1.txt",
        path: "Documents/file1.txt",
        type: FileType.FILE,
        size: 512,
        modified_at: "2024-01-12T10:00:00Z",
        is_readable: true,
        is_hidden: false,
      },
    ];

    // Setup mock to return different results for different paths
    vi.mocked(api.listDirectory).mockImplementation(async (_connectionId, path) => {
      if (path === "") {
        return mockDirectoryListing;
      }
      if (path === "Documents") {
        return {
          items: subfolderFiles,
          path: "Documents",
          total: subfolderFiles.length,
        };
      }
      return mockDirectoryListing; // fallback
    });

    const user = userEvent.setup();
    renderBrowser("/browse/test-server-1");

    // Optimized: Use findByText
    expect(await screen.findByText("Documents")).toBeInTheDocument();

    // Click on Documents folder
    const documentsFolder = screen.getByText("Documents");
    await user.click(documentsFolder);

    // Should load files from Documents directory
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "Documents");
    });
    expect(await screen.findByText("file1.txt")).toBeInTheDocument();
  });

  it("navigates using breadcrumb links", async () => {
    // Start in a nested path
    const nestedFiles: FileInfo[] = [
      {
        name: "nested.txt",
        path: "Documents/Subfolder/nested.txt",
        type: FileType.FILE,
        size: 256,
        modified_at: "2024-01-11T10:00:00Z",
        is_readable: true,
        is_hidden: false,
      },
    ];

    vi.mocked(api.listDirectory).mockImplementation(async (_connectionId, path) => {
      if (path === "Documents/Subfolder") {
        return {
          items: nestedFiles,
          path: "Documents/Subfolder",
          total: nestedFiles.length,
        };
      }
      return mockDirectoryListing; // root path
    });

    const user = userEvent.setup();
    renderBrowser("/browse/test-server-1/Documents/Subfolder");

    // Optimized: Use findByText
    expect(await screen.findByText("Subfolder")).toBeInTheDocument();

    // Click on "Root" breadcrumb
    const rootLink = screen.getByText("Root");
    await user.click(rootLink);

    // Should navigate back to root
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "");
    });
  });

  it("loads connection from URL parameter", async () => {
    renderBrowser("/browse/test-server-2");

    // Wait for connections to load and URL to be processed
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-2", "");
    });
  });

  it("loads nested path from URL", async () => {
    renderBrowser("/browse/test-server-1/Documents/Subfolder");

    // Wait for connections to load
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "Documents/Subfolder");
    });
  });

  it("uses localStorage for default connection when no URL param", async () => {
    localStorage.setItem("selectedConnectionId", "conn-2");

    renderBrowser("/browse");

    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-2", "");
    });
  });

  it("falls back to first connection when no saved preference", async () => {
    localStorage.removeItem("selectedConnectionId");

    renderBrowser("/browse");

    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "");
    });
  });

  it("switches connections using dropdown", async () => {
    const conn2Files: FileInfo[] = [
      {
        name: "Server2File.txt",
        path: "Server2File.txt",
        type: FileType.FILE,
        size: 2048,
        modified_at: "2024-01-10T10:00:00Z",
        is_readable: true,
        is_hidden: false,
      },
    ];

    vi.mocked(api.listDirectory).mockResolvedValueOnce(mockDirectoryListing);

    const user = userEvent.setup();
    renderBrowser("/browse/test-server-1");

    // Optimized: Use findByText
    expect(await screen.findByText("Documents")).toBeInTheDocument();

    // Change connection
    vi.mocked(api.listDirectory).mockResolvedValueOnce({
      items: conn2Files,
      path: "",
      total: conn2Files.length,
    });

    const select = screen.getByRole("combobox");
    await user.click(select);

    const option = await screen.findByText(/Test Server 2/);
    await user.click(option);

    // Should load files from new connection
    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalledWith("conn-2", "");
    });
  });
});
