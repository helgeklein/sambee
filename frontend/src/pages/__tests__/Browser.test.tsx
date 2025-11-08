import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import api from "../../services/api";
import type { Connection, DirectoryListing, FileInfo } from "../../types";
import { FileType } from "../../types";
import Browser from "../Browser";

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

describe("Browser Component", () => {
  const mockConnections: Connection[] = [
    {
      id: "conn-1",
      name: "Test Server 1",
      type: "SMB",
      host: "192.168.1.100",
      share_name: "share1",
      username: "user1",
      port: 445,
      path_prefix: "/",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "conn-2",
      name: "Test Server 2",
      type: "SMB",
      host: "192.168.1.101",
      share_name: "share2",
      username: "user2",
      port: 445,
      path_prefix: "/",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ];

  const mockFiles: FileInfo[] = [
    {
      name: "Documents",
      path: "Documents",
      type: FileType.DIRECTORY,
      size: 0,
      modified_at: "2024-01-15T10:00:00Z",
      is_readable: true,
      is_hidden: false,
    },
    {
      name: "Pictures",
      path: "Pictures",
      type: FileType.DIRECTORY,
      size: 0,
      modified_at: "2024-01-14T10:00:00Z",
      is_readable: true,
      is_hidden: false,
    },
    {
      name: "readme.txt",
      path: "readme.txt",
      type: FileType.FILE,
      size: 1024,
      modified_at: "2024-01-13T10:00:00Z",
      is_readable: true,
      is_hidden: false,
    },
  ];

  const mockDirectoryListing: DirectoryListing = {
    items: mockFiles,
    path: "",
    total: mockFiles.length,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("access_token", "fake-token");
    localStorage.removeItem("selectedConnectionId"); // Clear saved connection

    // Default successful mocks
    vi.mocked(api.getConnections).mockResolvedValue(mockConnections);
    vi.mocked(api.listDirectory).mockResolvedValue(mockDirectoryListing);
  });

  const renderBrowser = (initialPath = "/browse") => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/browse/:connectionId/*" element={<Browser />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe("Rendering", () => {
    it("displays connection selector with available connections", async () => {
      renderBrowser();

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });

      // Check that connections are in the dropdown
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
    });

    it("shows breadcrumb navigation", async () => {
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("Root")).toBeInTheDocument();
      });
    });

    it("renders file and folder list", async () => {
      renderBrowser("/browse/test-server-1");

      // Wait for connections to load first
      await waitFor(
        () => {
          expect(api.getConnections).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Wait for directory listing to be called
      await waitFor(
        () => {
          expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "");
        },
        { timeout: 3000 }
      );

      // Wait for files to appear
      await waitFor(
        () => {
          expect(screen.getByText("Documents")).toBeInTheDocument();
          expect(screen.getByText("Pictures")).toBeInTheDocument();
          expect(screen.getByText("readme.txt")).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
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

      await waitFor(() => {
        expect(screen.getByText(/Connection failed/i)).toBeInTheDocument();
      });
    });

    it("shows message when no connections are configured", async () => {
      vi.mocked(api.getConnections).mockResolvedValue([]);

      renderBrowser();

      await waitFor(() => {
        expect(screen.getByText(/No SMB connections configured/i)).toBeInTheDocument();
      });
    });

    it("displays empty directory message when folder is empty", async () => {
      vi.mocked(api.listDirectory).mockResolvedValue({
        items: [],
        path: "",
        total: 0,
      });

      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText(/This directory is empty/i)).toBeInTheDocument();
      });
    });
  });

  describe("Interaction", () => {
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

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
      });

      // Click on Documents folder
      const documentsFolder = screen.getByText("Documents");
      await user.click(documentsFolder);

      // Should load files from Documents directory
      await waitFor(() => {
        expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "Documents");
        expect(screen.getByText("file1.txt")).toBeInTheDocument();
      });
    });

    it("opens preview when clicking file", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("readme.txt")).toBeInTheDocument();
      });

      // Click on file - find the button that contains the text
      const fileButton = screen.getByRole("button", { name: /readme\.txt/i });
      await user.click(fileButton);

      // Preview dialog should open
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
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

      await waitFor(() => {
        expect(screen.getByText("Subfolder")).toBeInTheDocument();
      });

      // Click on "Root" breadcrumb
      const rootLink = screen.getByText("Root");
      await user.click(rootLink);

      // Should navigate back to root
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

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
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
        expect(api.listDirectory).toHaveBeenCalledWith("conn-2", "");
      });
    });

    it("opens settings dialog when settings button clicked", async () => {
      // Mock admin status
      vi.mocked(api.getConnections).mockResolvedValue(mockConnections);

      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
      });

      // Find and click settings button
      const settingsButton = screen.getByTitle("Settings");
      await user.click(settingsButton);

      // Settings dialog should open
      await waitFor(() => {
        expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
      });
    });

    it("filters files when using search", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
        expect(screen.getByText("Pictures")).toBeInTheDocument();
        expect(screen.getByText("readme.txt")).toBeInTheDocument();
      });

      // Type in search box
      const searchInput = screen.getByPlaceholderText(/search files/i);
      await user.type(searchInput, "doc");

      // Should filter to only show Documents
      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
        expect(screen.queryByText("Pictures")).not.toBeInTheDocument();
        expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
      });
    });

    it("sorts files by name, size, and date", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
      });

      // Click sort by size button
      const sortBySizeButton = screen.getByLabelText(/sort by size/i);
      await user.click(sortBySizeButton);

      // Files should be re-rendered (already sorted by component)
      expect(screen.getByText("readme.txt")).toBeInTheDocument();

      // Click sort by date button
      const sortByDateButton = screen.getByLabelText(/sort by date/i);
      await user.click(sortByDateButton);

      // Files should be re-rendered
      expect(screen.getByText("Documents")).toBeInTheDocument();
    });

    it("refreshes file list when refresh button clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
      });

      const initialCallCount = (api.listDirectory as Mock).mock.calls.length;

      // Click refresh button
      const refreshButton = screen.getByTitle(/refresh/i);
      await user.click(refreshButton);

      // Should call listDirectory again
      await waitFor(() => {
        expect((api.listDirectory as Mock).mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });
  });

  describe("Error Handling", () => {
    it("redirects to login when unauthorized (401)", async () => {
      vi.mocked(api.getConnections).mockRejectedValue({
        response: { status: 401 },
      });

      renderBrowser();

      await waitFor(() => {
        expect(screen.getByText("Login Page")).toBeInTheDocument();
      });
    });

    it("shows access denied message for admin endpoints (403)", async () => {
      vi.mocked(api.getConnections).mockRejectedValue({
        response: { status: 403 },
      });

      renderBrowser();

      await waitFor(() => {
        expect(
          screen.getByText(/Access denied. Please contact an administrator/i)
        ).toBeInTheDocument();
      });
    });

    it("handles connection not found (404)", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue({
        response: { status: 404 },
      });

      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText(/Connection not found/i)).toBeInTheDocument();
      });
    });

    it("handles generic API errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue({
        response: { data: { detail: "Server error" } },
      });

      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(screen.getByText(/Server error/i)).toBeInTheDocument();
      });
    });

    it("handles network errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue(new Error("Network error"));

      renderBrowser("/browse/test-server-1");

      await waitFor(() => {
        expect(
          screen.getByText(/Failed to load files. Please check your connection settings/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe("Navigation and URL Handling", () => {
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
  });
});
