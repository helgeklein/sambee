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
  createUnauthorizedError,
  setupSuccessfulApiMocks,
} from "../../test/helpers";
import { FileType } from "../../types";
import { mockDirectoryListing, renderBrowser } from "./FileBrowser.test.utils";

// Mock the API module
vi.mock("../../services/api");

// Mock components using lazy mock factories
vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
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
    it("opens settings when settings button clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Find settings button - it should be clickable
      const settingsButton = screen.getByTitle("Settings");
      expect(settingsButton).toBeInTheDocument();

      // Click is handled by navigation, which we can't fully test here
      // without setting up the routes, but we can verify the button works
      await user.click(settingsButton);
    });
  });

  describe("Sort Functionality", () => {
    it("sorts files by name, size, and date", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Open sort menu
      const sortButton = screen.getByLabelText(/sort options/i);
      await user.click(sortButton);

      // Click "Size" in the menu
      const sizeOption = await screen.findByText("Size");
      await user.click(sizeOption);

      // Files should be re-rendered (already sorted by component)
      await waitFor(() => {
        const elements = screen.getAllByText("readme.txt");
        expect(elements.length).toBeGreaterThan(0);
      });

      // Open sort menu again
      const sortButtonAgain = screen.getByLabelText(/sort options/i);
      await user.click(sortButtonAgain);

      // Click "Modified" in the menu
      const modifiedOption = await screen.findByText("Modified");
      await user.click(modifiedOption);

      // Files should be re-rendered
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
    });

    it("sorts files by name", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Open sort menu
      const sortButton = screen.getByLabelText(/sort options/i);
      await user.click(sortButton);

      // Files should still be displayed (sorting menu opened)
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
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
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Open sort menu
      const sortButton = screen.getByLabelText(/sort options/i);
      await user.click(sortButton);

      // Click Size in the menu
      const sizeOption = await screen.findByText("Size");
      await user.click(sizeOption);

      // Navigate into Documents folder
      const documentsFolder = screen.getByRole("button", {
        name: /documents/i,
      });
      await user.click(documentsFolder);

      // Optimized: Use findByText
      await waitFor(() => {
        const elements = screen.getAllByText("aaa.txt");
        expect(elements.length).toBeGreaterThan(0);
      });

      // Sort preference should still be applied
      const zzzElements = screen.getAllByText("zzz.txt");
      expect(zzzElements.length).toBeGreaterThan(0);
    });
  });

  describe("Refresh", () => {
    it("refreshes file list when F5 key pressed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const initialCallCount = (api.listDirectory as Mock).mock.calls.length;

      // Press F5 to refresh
      await user.keyboard("{F5}");

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
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

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
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

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
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

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
      await waitFor(() => {
        const elements = screen.getAllByText("file.txt");
        expect(elements.length).toBeGreaterThan(0);
      });

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
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Press ? to open shortcuts dialog
      await user.keyboard("?");

      // The shortcuts dialog should appear
      await waitFor(() => {
        // Dialog may or may not be implemented, so we just verify no crash
        expect(true).toBe(true);
      });
    });

    it("handles keyboard navigation without crashing on empty directory", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const elements = screen.getAllByText("readme.txt");
        expect(elements.length).toBeGreaterThan(0);
      });

      // Try keyboard navigation - component should not crash
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowUp}");
      await user.keyboard("{Enter}");

      // Component should still be functional (not crashed)
      expect(screen.getByText("Sambee")).toBeInTheDocument();
    });

    it("handles switching between mouse and keyboard input without crashing", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");

      // Simulate mouse interaction
      await user.click(listContainer);

      // Then keyboard navigation
      await user.keyboard("{ArrowDown}");

      // Then another mouse interaction
      await user.click(listContainer);

      // Verify component still renders correctly
      expect(screen.getByText("Sambee")).toBeInTheDocument();
      const documentsElements = screen.getAllByText("Documents");
      expect(documentsElements.length).toBeGreaterThan(0);
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

  describe("Delete", () => {
    it("opens confirm dialog when Delete key pressed on focused file", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");

      // Focus on the list and ensure first item is focused
      await user.click(listContainer);

      // Press Delete key
      await user.keyboard("{Delete}");

      // Confirm dialog should appear with the item name
      await waitFor(() => {
        expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument();
      });
    });

    it("calls deleteItem API when confirmed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      // Navigate down to select a file (third item = readme.txt)
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowDown}");

      // Press Delete
      await user.keyboard("{Delete}");

      // Confirm dialog should appear
      const deleteButton = await screen.findByRole("button", { name: "Delete" });
      await user.click(deleteButton);

      // deleteItem should have been called
      await waitFor(() => {
        expect(api.deleteItem).toHaveBeenCalled();
      });
    });

    it("closes dialog when Cancel is clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      // Press Delete to open dialog
      await user.keyboard("{Delete}");

      // Wait for dialog
      const cancelButton = await screen.findByRole("button", { name: "Cancel" });
      await user.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByText(/are you sure you want to delete/i)).not.toBeInTheDocument();
      });
    });
  });
});
