/**
 * Browser Component - Navigation Tests
 * Tests for directory navigation, breadcrumbs, URL handling, and connection switching
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { type ApiMock, createMarkdownViewerMock, createSettingsDialogMock, setupNavigationApiMocks } from "../../test/helpers";
import type { FileInfo } from "../../types";
import { FileType } from "../../types";
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
    renderBrowser("/browse/smb/test-server-1");

    // Wait for Documents to load (may appear multiple times in UI)
    await waitFor(() => {
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
    });

    // Click on Documents folder - get the button role to be more specific
    const documentsFolders = screen.getAllByRole("button", { name: /documents/i });
    await user.click(documentsFolders[0]);

    // Should load files from Documents directory
    await waitFor(() => {
      expectDirectoryLoad("conn-1", "Documents");
    });
    await waitFor(() => {
      const file1Elements = screen.getAllByText("file1.txt");
      expect(file1Elements.length).toBeGreaterThan(0);
    });
  });

  it("does not repaint the previous directory contents while loading a child directory", async () => {
    const user = userEvent.setup();
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

    let resolveSubfolder: ((value: { items: FileInfo[]; path: string; total: number }) => void) | null = null;

    vi.mocked(api.listDirectory).mockImplementation(async (_connectionId, path) => {
      if (path === "Documents") {
        return new Promise((resolve) => {
          resolveSubfolder = resolve as (value: { items: FileInfo[]; path: string; total: number }) => void;
        });
      }

      return mockDirectoryListing;
    });

    renderBrowser("/browse/smb/test-server-1");

    expect(await screen.findByText("readme.txt")).toBeInTheDocument();

    const documentsFolders = screen.getAllByRole("button", { name: /documents/i });
    await user.click(documentsFolders[0]);

    await waitFor(() => {
      expectDirectoryLoad("conn-1", "Documents");
    });

    expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolveSubfolder?.({
      items: subfolderFiles,
      path: "Documents",
      total: subfolderFiles.length,
    });

    const fileEntries = await screen.findAllByText("file1.txt");
    expect(fileEntries.length).toBeGreaterThan(0);
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
    renderBrowser("/browse/smb/test-server-1/Documents/Subfolder");

    // Optimized: Use findByText
    expect(await screen.findByText("Subfolder")).toBeInTheDocument();

    // Click on connection name breadcrumb (replaces "Root") - use getAllByText and filter to find the link, not the combobox
    const rootLinks = screen.getAllByText("Test Server 1");
    // The breadcrumb link should be in a button with component="button" (from MUI Link)
    const rootLink = rootLinks.find((el) => el.tagName === "BUTTON" && el.getAttribute("role") !== "combobox");
    expect(rootLink).toBeDefined();
    await user.click(rootLink!);

    // Should navigate back to root
    await waitFor(() => {
      expectDirectoryLoad("conn-1", "");
    });
  });

  it("loads connection from URL parameter", async () => {
    renderBrowser("/browse/smb/test-server-2");

    // Wait for connections to load and URL to be processed
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    await waitFor(() => {
      expectDirectoryLoad("conn-2", "");
    });
  });

  it("loads nested path from URL", async () => {
    renderBrowser("/browse/smb/test-server-1/Documents/Subfolder");

    // Wait for connections to load
    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    await waitFor(() => {
      expectDirectoryLoad("conn-1", "Documents/Subfolder");
    });
  });

  it("uses localStorage for default connection when no URL param", async () => {
    localStorage.setItem("selectedConnectionId", "conn-2");

    renderBrowser("/browse");

    await waitFor(() => {
      expectDirectoryLoad("conn-2", "");
    });
  });

  it("prefers the persisted user setting over local storage when no URL param", async () => {
    localStorage.setItem("selectedConnectionId", "conn-2");
    vi.mocked(api.getCurrentUserSettings).mockResolvedValue({
      appearance: { theme_id: "sambee-light", custom_themes: [] },
      localization: {
        language: "browser",
        regional_locale: "browser",
      },
      browser: {
        quick_nav_include_dot_directories: false,
        file_browser_view_mode: "list",
        pane_mode: "single",
        selected_connection_id: "conn-1",
      },
    });

    renderBrowser("/browse");

    await waitFor(() => {
      expectDirectoryLoad("conn-1", "");
    });

    expect(localStorage.getItem("selectedConnectionId")).toBe("conn-1");
  });

  it("falls back to first connection when no saved preference", async () => {
    localStorage.removeItem("selectedConnectionId");

    renderBrowser("/browse");

    await waitFor(() => {
      expectDirectoryLoad("conn-1", "");
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
    renderBrowser("/browse/smb/test-server-1");

    // Wait for Documents to load (may appear multiple times in UI)
    await waitFor(() => {
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
    });

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
      expectDirectoryLoad("conn-2", "");
    });
  });

  it("ignores stale directory responses after switching connections", async () => {
    const user = userEvent.setup();

    let resolveConn1: ((value: typeof mockDirectoryListing) => void) | null = null;
    let resolveConn2: ((value: { items: FileInfo[]; path: string; total: number }) => void) | null = null;

    const conn2Files: FileInfo[] = [
      {
        name: "conn2-only.txt",
        path: "conn2-only.txt",
        type: FileType.FILE,
        size: 2048,
        modified_at: "2024-01-10T10:00:00Z",
        is_readable: true,
        is_hidden: false,
      },
    ];

    vi.mocked(api.listDirectory).mockImplementation((connectionId) => {
      if (connectionId === "conn-1") {
        return new Promise((resolve) => {
          resolveConn1 = resolve as (value: typeof mockDirectoryListing) => void;
        });
      }

      if (connectionId === "conn-2") {
        return new Promise((resolve) => {
          resolveConn2 = resolve as (value: { items: FileInfo[]; path: string; total: number }) => void;
        });
      }

      return Promise.resolve(mockDirectoryListing);
    });

    renderBrowser("/browse/smb/test-server-1");

    const select = await screen.findByRole("combobox");
    await user.click(select);

    const option = await screen.findByText(/Test Server 2/);
    await user.click(option);

    resolveConn2?.({
      items: conn2Files,
      path: "",
      total: conn2Files.length,
    });

    const conn2OnlyElements = await screen.findAllByText("conn2-only.txt");
    expect(conn2OnlyElements.length).toBeGreaterThan(0);

    resolveConn1?.(mockDirectoryListing);

    await waitFor(() => {
      expect(screen.getAllByText("conn2-only.txt").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
  });
});
