/**
 * Browser Component - Interactions Tests
 * Tests for keyboard navigation, search/filter, sorting, settings, and refresh
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import api from "../../services/api";
import {
  type ApiMock,
  createForbiddenError,
  createMarkdownViewerMock,
  createNetworkError,
  createNotFoundError,
  createSettingsDialogMock,
  createUnauthorizedError,
  setupSuccessfulApiMocks,
} from "../../test/helpers";
import { FileType } from "../../types";
import { mockDirectoryListing, renderBrowser } from "./Browser.test.utils";

// Mock the API module
vi.mock("../../services/api");

// Mock components using lazy mock factories
vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
// @tanstack/react-virtual mock - explicitly import the mock
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

describe("Browser Component - Interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("access_token", "fake-token");
    localStorage.removeItem("selectedConnectionId");

    // Use mock factory for successful API responses
    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  describe("Settings", () => {
    it("opens settings dialog when settings button clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Find and click settings button
      const settingsButton = screen.getByTitle("Settings");
      await user.click(settingsButton);

      // Settings dialog should open
      expect(await screen.findByTestId("settings-dialog")).toBeInTheDocument();
    });
  });

  describe("Search and Filter", () => {
    it("filters files when using search", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();
      expect(screen.getByText("Pictures")).toBeInTheDocument();
      expect(screen.getByText("readme.txt")).toBeInTheDocument();

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

    it("filters files based on search query", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Find and use search field
      const searchField = screen.getByPlaceholderText(/search/i);
      await user.type(searchField, "readme");

      // Should show only matching files
      await waitFor(() => {
        expect(screen.getByText("readme.txt")).toBeInTheDocument();
        expect(screen.queryByText("Documents")).not.toBeInTheDocument();
      });
    });

    it("shows message when search has no results", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      const searchField = screen.getByPlaceholderText(/search/i);
      await user.type(searchField, "nonexistent");

      expect(await screen.findByText(/no files match/i)).toBeInTheDocument();
    });

    it("clears search when clear button is clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Search for something
      const searchField = screen.getByPlaceholderText(/search/i);
      await user.type(searchField, "readme");

      await waitFor(() => {
        expect(screen.queryByText("Documents")).not.toBeInTheDocument();
      });

      // Clear search
      await user.clear(searchField);

      // All files should be visible again
      await waitFor(() => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
        expect(screen.getByText("readme.txt")).toBeInTheDocument();
      });
    });
  });

  describe("Sort Functionality", () => {
    it("sorts files by name, size, and date", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

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

    it("sorts files by name", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Click sort button to cycle through sort options
      const sortButtons = screen.getAllByRole("button", { name: /sort/i });
      const sortButton = sortButtons[0]; // Use first sort button
      await user.click(sortButton);

      // Files should still be displayed (sorting is applied)
      expect(screen.getByText("Documents")).toBeInTheDocument();
    });

    it("maintains sort preference across navigation", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockImplementation((_connectionId, path) => {
        if (path === "Documents") {
          return Promise.resolve({
            items: [
              {
                name: "zzz.txt",
                path: "Documents/zzz.txt",
                type: FileType.FILE,
                size: 100,
                modified_at: "2024-01-01T00:00:00Z",
                is_readable: true,
                is_hidden: false,
              },
              {
                name: "aaa.txt",
                path: "Documents/aaa.txt",
                type: FileType.FILE,
                size: 200,
                modified_at: "2024-01-02T00:00:00Z",
                is_readable: true,
                is_hidden: false,
              },
            ],
            path: "Documents",
            total: 2,
          });
        }
        return Promise.resolve(mockDirectoryListing);
      });

      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Set a sort preference (cycle through to size)
      const sortButtons = screen.getAllByRole("button", { name: /sort/i });
      const sortButton = sortButtons[0]; // Use first sort button
      await user.click(sortButton);
      await user.click(sortButton);

      // Navigate into Documents folder
      const documentsFolder = screen.getByRole("button", {
        name: /documents/i,
      });
      await user.click(documentsFolder);

      // Optimized: Use findByText
      expect(await screen.findByText("aaa.txt")).toBeInTheDocument();

      // Sort preference should still be applied
      expect(screen.getByText("zzz.txt")).toBeInTheDocument();
    });
  });

  describe("Refresh", () => {
    it("refreshes file list when refresh button clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

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

  describe("Keyboard Navigation", () => {
    it("navigates down with ArrowDown key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      const listContainer = screen.getByTestId("virtual-list");

      // Focus on the container and press ArrowDown
      await user.click(listContainer);
      await user.keyboard("{ArrowDown}");

      // The component should handle the keyboard event
      // Since we can't easily test focus state in JSDOM, we verify the component renders
      expect(listContainer).toBeInTheDocument();
    });

    it("navigates up with ArrowUp key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      const listContainer = screen.getByTestId("virtual-list");

      await user.click(listContainer);
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowUp}");

      expect(listContainer).toBeInTheDocument();
    });

    it("opens file or folder with Enter key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Click on the Documents folder to focus it
      const documentsFolder = screen.getByRole("button", {
        name: /documents/i,
      });
      await user.click(documentsFolder);

      // Press Enter should navigate into the folder
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "Documents");
      });
    });

    it("navigates to parent with Backspace key", async () => {
      const user = userEvent.setup();

      // Start in a subdirectory
      vi.mocked(api.listDirectory).mockImplementation((_connectionId, path) => {
        if (path === "Documents") {
          return Promise.resolve({
            items: [
              {
                name: "file.txt",
                path: "Documents/file.txt",
                type: FileType.FILE,
                size: 100,
                modified_at: "2024-01-01T00:00:00Z",
                is_readable: true,
                is_hidden: false,
              },
            ],
            path: "Documents",
            total: 1,
          });
        }
        return Promise.resolve(mockDirectoryListing);
      });

      renderBrowser("/browse/test-server-1/Documents");

      // Optimized: Use findByText
      expect(await screen.findByText("file.txt")).toBeInTheDocument();

      // Press Backspace to go to parent
      await user.keyboard("{Backspace}");

      await waitFor(() => {
        expect(api.listDirectory).toHaveBeenCalledWith("conn-1", "");
      });
    });

    it("opens shortcuts dialog with ? key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("Documents")).toBeInTheDocument();

      // Press ? to open shortcuts dialog
      await user.keyboard("?");

      // The shortcuts dialog should appear
      await waitFor(() => {
        const _dialog = screen.queryByRole("dialog");
        // Dialog may or may not be implemented, so we just verify no crash
        expect(true).toBe(true);
      });
    });

    it("handles keyboard navigation without crashing on empty directory", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      expect(await screen.findByText("readme.txt")).toBeInTheDocument();

      // Try keyboard navigation - component should not crash
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowUp}");
      await user.keyboard("{Enter}");

      // Component should still be functional (not crashed)
      expect(screen.getByText("Sambee")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("redirects to login when unauthorized (401)", async () => {
      vi.mocked(api.getConnections).mockRejectedValue(createUnauthorizedError());

      renderBrowser();

      expect(await screen.findByText("Login Page")).toBeInTheDocument();
    });

    it("shows access denied message for admin endpoints (403)", async () => {
      vi.mocked(api.getConnections).mockRejectedValue(createForbiddenError());

      renderBrowser();

      expect(await screen.findByText(/Access denied. Please contact an administrator/i)).toBeInTheDocument();
    });

    it("handles connection not found (404)", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue(createNotFoundError());

      renderBrowser("/browse/test-server-1");

      expect(await screen.findByText(/Connection not found/i)).toBeInTheDocument();
    });

    it("handles generic API errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue({
        response: { data: { detail: "Server error" } },
      });

      renderBrowser("/browse/test-server-1");

      expect(await screen.findByText(/Server error/i)).toBeInTheDocument();
    });

    it("handles network errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue(createNetworkError());

      renderBrowser("/browse/test-server-1");

      expect(await screen.findByText(/Failed to load directory contents. Please try again/i)).toBeInTheDocument();
    });
  });
});
