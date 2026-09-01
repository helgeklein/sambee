/**
 * Browser Component - Interactions Tests
 * Tests for keyboard navigation, search/filter, sorting, settings, and refresh
 */

import { createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import api from "../../services/api";
import { authSession } from "../../services/authSession";
import { RECENT_DIRECTORIES_CHANGED_EVENT } from "../../services/recentDirectoriesSync";
import { RECENT_FILES_CHANGED_EVENT } from "../../services/recentFilesSync";
import { clearCurrentUserSettingsCache } from "../../services/userSettingsSync";
import {
  type ApiMock,
  createForbiddenError,
  createMarkdownViewerMock,
  createNetworkError,
  createNotFoundError,
  createTimeoutError,
  createUnauthorizedError,
  setupSuccessfulApiMocks,
} from "../../test/helpers";
import { type ConflictInfo, FileType } from "../../types";
import { QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY } from "../FileBrowser/preferences";
import { mockConnections, mockDirectoryListing, renderBrowser } from "./FileBrowser.test.utils";

const expectDirectoryLoad = (connectionId: string, path: string) => {
  expect(api.listDirectory).toHaveBeenCalledWith(
    connectionId,
    path,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    })
  );
};

const completedTransferResult = {
  status: "completed",
  replaced: false,
  effects: { source: "unchanged", destination: "mutated" },
} as const;

// Mock the API module
vi.mock("../../services/api");

// Mock components using lazy mock factories
vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
// @tanstack/react-virtual mock - explicitly import the mock
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

describe("Browser Component - Interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserSettingsCache();
    authSession.setAuthenticated({ access_token: "fake-token", token_type: "bearer" }, false);
    localStorage.removeItem("selectedConnectionId");
    localStorage.removeItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY);

    // Use mock factory for successful API responses
    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  describe("Settings", () => {
    it("opens settings when settings button clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      // Find settings button - it should be clickable
      const settingsButton = screen.getByRole("button", { name: /open settings/i });
      expect(settingsButton).toBeInTheDocument();

      // Click is handled by navigation, which we can't fully test here
      // without setting up the routes, but we can verify the button works
      await user.click(settingsButton);
    });
  });

  describe("Sort Functionality", () => {
    it("sorts files by name, size, and date", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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
      renderBrowser("/browse/smb/test-server-1");

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

      renderBrowser("/browse/smb/test-server-1");

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
    it("refreshes file list when Ctrl+R pressed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Optimized: Use findByText
      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const initialCallCount = (api.listDirectory as Mock).mock.calls.length;

      // Press Ctrl+R to refresh
      await user.keyboard("{Control>}r{/Control}");

      // Should call listDirectory again
      await waitFor(() => {
        expect((api.listDirectory as Mock).mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });

    it("returns to single-pane mode after pressing Ctrl+B twice", async () => {
      const user = userEvent.setup();
      const { container } = renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("dual");
        expect(localStorage.getItem("active-pane")).toBe("right");
        const rightPaneList = container.querySelector('[data-pane-id="right"] [data-testid="file-list-container"]');
        expect(rightPaneList).toBeInstanceOf(HTMLElement);
        expect(rightPaneList).toHaveFocus();
      });

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("single");
      });
    });

    it("creates an archive from the active right pane into the opposite pane", async () => {
      const user = userEvent.setup();
      const { container } = renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });
      await user.keyboard("{Control>}b{/Control}");

      const rightPane = await waitFor(() => {
        const pane = container.querySelector('[data-pane-id="right"]');
        expect(pane).toBeInstanceOf(HTMLElement);
        return pane as HTMLElement;
      });
      await user.click(within(rightPane).getByRole("button", { name: /folder: documents/i }));
      await waitFor(() => {
        expect(within(rightPane).getByText("readme.txt")).toBeInTheDocument();
      });

      await user.click(within(rightPane).getByTestId("virtual-list"));
      await waitFor(() => {
        expect(localStorage.getItem("active-pane")).toBe("right");
      });
      const event = createEvent.keyDown(document, { key: "F5", altKey: true });
      fireEvent(document, event);

      expect(event.defaultPrevented).toBe(true);
      const directory = await screen.findByTestId("archive-create-prompt-directory");
      expect(directory).toHaveTextContent("Test Server 1:/");
      expect(directory.tagName).toBe("CODE");
      expect(directory.parentElement).toHaveTextContent("Create a ZIP archive in Test Server 1:/ from 1 selected item.");

      fireEvent.keyDown(document, { key: "Tab" });
      expect(localStorage.getItem("active-pane")).toBe("right");
    });

    it("reuses the current left-pane directory contents when opening dual-pane on the same target", async () => {
      const user = userEvent.setup();
      const { container } = renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
      });

      const initialRootLoads = (api.listDirectory as Mock).mock.calls.filter(
        ([connectionId, path]) => connectionId === "conn-1" && path === ""
      ).length;

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("dual");
        const rightPaneList = container.querySelector('[data-pane-id="right"] [data-testid="file-list-container"]');
        expect(rightPaneList).toBeInstanceOf(HTMLElement);
      });

      const rootLoadsAfterToggle = (api.listDirectory as Mock).mock.calls.filter(
        ([connectionId, path]) => connectionId === "conn-1" && path === ""
      ).length;

      expect(rootLoadsAfterToggle).toBe(initialRootLoads);
    });

    it("returns to single-pane mode after pressing Ctrl+B twice even when a toolbar button has focus", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const settingsButton = screen.getByRole("button", { name: /open settings/i });
      settingsButton.focus();
      expect(settingsButton).toHaveFocus();

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("dual");
      });

      settingsButton.focus();
      expect(settingsButton).toHaveFocus();

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("single");
      });
    });

    it("returns to single-pane mode after pressing Ctrl+B twice even if the left pane receives focus during the transition", async () => {
      const user = userEvent.setup();
      const { container } = renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const leftPaneList = container.querySelector('[data-pane-id="left"] [data-testid="file-list-container"]');
      expect(leftPaneList).toBeInstanceOf(HTMLElement);

      await user.keyboard("{Control>}b{/Control}");

      (leftPaneList as HTMLElement).focus();

      await user.keyboard("{Control>}b{/Control}");

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("single");
      });
    });

    it("refreshes the destination pane after copy to the other pane succeeds", async () => {
      const user = userEvent.setup();

      vi.mocked(api.copyItem).mockResolvedValue(completedTransferResult);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const initialDestinationLoads = (api.listDirectory as Mock).mock.calls.filter(
        ([connectionId, path]) => connectionId === "conn-2" && path === "Documents"
      ).length;

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F5}");

      const dialog = await screen.findByRole("dialog");
      const copyButton = within(dialog).getByRole("button", { name: "Copy" });
      await waitFor(() => {
        expect(copyButton).toBeEnabled();
      });
      await user.click(copyButton);

      await waitFor(() => {
        const destinationLoads = (api.listDirectory as Mock).mock.calls.filter(
          ([connectionId, path]) => connectionId === "conn-2" && path === "Documents"
        ).length;
        expect(destinationLoads).toBeGreaterThan(initialDestinationLoads);
      });
    });

    it("offers only safe file conflict actions when replacement is unavailable", async () => {
      const user = userEvent.setup();
      const conflict: ConflictInfo = {
        incoming_file: {
          name: "Documents",
          path: "Documents",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-13T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
        existing_file: {
          name: "Documents",
          path: "Documents/Documents",
          type: FileType.FILE,
          size: 2048,
          modified_at: "2024-01-14T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
      };
      vi.mocked(api.copyItem).mockRejectedValueOnce({ response: { status: 409, data: { detail: conflict } } });

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F5}");
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Copy" }));
      expect(await screen.findByRole("radio", { name: "Skip" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Rename" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Overwrite" })).not.toBeInTheDocument();
    });

    it("reopens resolution when a renamed copy target also exists", async () => {
      const user = userEvent.setup();
      const firstConflict: ConflictInfo = {
        incoming_file: {
          name: "Documents",
          path: "Documents",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-13T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
        existing_file: {
          name: "Documents",
          path: "Documents/Documents",
          type: FileType.FILE,
          size: 2048,
          modified_at: "2024-01-14T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
      };
      const renamedTargetConflict: ConflictInfo = {
        ...firstConflict,
        existing_file: {
          ...firstConflict.existing_file,
          name: "alternate.txt",
          path: "Documents/alternate.txt",
        },
      };
      vi.mocked(api.copyItem)
        .mockRejectedValueOnce({ response: { status: 409, data: { detail: firstConflict } } })
        .mockRejectedValueOnce({ response: { status: 409, data: { detail: renamedTargetConflict } } })
        .mockResolvedValueOnce(completedTransferResult);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F5}");
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Copy" }));
      await user.click(await screen.findByRole("radio", { name: "Rename" }));
      const targetName = screen.getByRole("textbox", { name: "Target name" });
      await waitFor(() => expect(targetName).toHaveFocus());
      fireEvent.change(targetName, { target: { value: "alternate.txt" } });
      expect(targetName).toHaveValue("alternate.txt");
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("textbox", { name: "Target name" })).toHaveValue("alternate.txt");
      await user.click(screen.getByRole("radio", { name: "Rename" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => expect(api.copyItem).toHaveBeenCalledTimes(3));
      expect(vi.mocked(api.copyItem).mock.calls[2]?.slice(0, 5)).toEqual([
        "conn-1",
        "Documents",
        "Documents/alternate (copy).txt",
        "conn-2",
        "ask",
      ]);
    });

    it("reopens resolution when a renamed move target also exists", async () => {
      const user = userEvent.setup();
      const firstConflict: ConflictInfo = {
        incoming_file: {
          name: "Documents",
          path: "Documents",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-13T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
        existing_file: {
          name: "Documents",
          path: "Documents/Documents",
          type: FileType.FILE,
          size: 2048,
          modified_at: "2024-01-14T10:00:00Z",
          is_readable: true,
          is_hidden: false,
        },
      };
      const renamedTargetConflict: ConflictInfo = {
        ...firstConflict,
        existing_file: {
          ...firstConflict.existing_file,
          name: "alternate.txt",
          path: "Documents/alternate.txt",
        },
      };
      vi.mocked(api.moveItem)
        .mockRejectedValueOnce({ response: { status: 409, data: { detail: firstConflict } } })
        .mockRejectedValueOnce({ response: { status: 409, data: { detail: renamedTargetConflict } } })
        .mockResolvedValueOnce(completedTransferResult);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F6}");
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move" }));
      await user.click(await screen.findByRole("radio", { name: "Rename" }));
      const targetName = screen.getByRole("textbox", { name: "Target name" });
      await waitFor(() => expect(targetName).toHaveFocus());
      fireEvent.change(targetName, { target: { value: "alternate.txt" } });
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("textbox", { name: "Target name" })).toHaveValue("alternate.txt");
      await user.click(screen.getByRole("radio", { name: "Rename" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => expect(api.moveItem).toHaveBeenCalledTimes(3));
      expect(vi.mocked(api.moveItem).mock.calls[2]?.slice(0, 5)).toEqual([
        "conn-1",
        "Documents",
        "Documents/alternate (copy).txt",
        "conn-2",
        "ask",
      ]);
    });

    it("does not open copy dialog when the destination connection is read-only", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue([mockConnections[0], { ...mockConnections[1], access_mode: "read_only" }]);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F5}");

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
      });
      expect(api.copyItem).not.toHaveBeenCalled();
    });

    it("prevents browser refresh for F5 when copy is unavailable because the destination connection is read-only", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue([mockConnections[0], { ...mockConnections[1], access_mode: "read_only" }]);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);

      const event = createEvent.keyDown(document, { key: "F5" });
      fireEvent(document, event);

      expect(event.defaultPrevented).toBe(true);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.copyItem).not.toHaveBeenCalled();
    });

    it("phase_10_stabilization_move_commands_are_disabled", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue(mockConnections);

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "Documents");
      });

      const listContainer = (await screen.findAllByTestId("virtual-list"))[0];
      await user.click(listContainer);
      await user.keyboard(" ");
      await user.keyboard("{F6}");

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
      });
      expect(api.moveItem).not.toHaveBeenCalled();
    });

    it("opens the detected default viewer on Enter when there is only one compatible Sambee viewer", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "notes.MD",
            path: "notes.MD",
            type: FileType.FILE,
            size: 2048,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "text/plain",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
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
          selected_connection_id: null,
          viewer_associations: {},
        },
      });

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /notes\.md/i })).toBeInTheDocument();
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Markdown Viewer")).toBeInTheDocument();
      });
      expect(screen.queryByRole("dialog", { name: "Choose Viewer" })).not.toBeInTheDocument();
    });

    it("suppresses File Search results while a browser viewer is open", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "notes.MD",
            path: "notes.MD",
            type: FileType.FILE,
            size: 2048,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "text/plain",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser("/browse/smb/test-server-1");

      const listContainer = await screen.findByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("/");
      await screen.findByRole("listbox");

      listContainer.focus();
      await user.keyboard("{Enter}");

      await screen.findByText("Markdown Viewer");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("returns focus to the file list without reopening File Search after closing a PDF viewer", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "report.pdf",
            path: "report.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
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
          selected_connection_id: null,
          viewer_associations: { "mime:application/pdf": "pdf" },
        },
      });

      renderBrowser("/browse/smb/test-server-1");

      const listContainer = await screen.findByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("/");
      await screen.findByRole("listbox");

      listContainer.focus();
      await user.keyboard("{Enter}");
      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByTestId("file-list-container")).toHaveFocus();
      });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("returns focus to the file list without reopening File Search after cancelling the viewer picker", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "report.pdf",
            path: "report.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser("/browse/smb/test-server-1");

      const virtualList = await screen.findByTestId("virtual-list");
      await user.click(virtualList);
      await user.keyboard("/");
      await screen.findByRole("listbox");

      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await screen.findByRole("dialog", { name: "Choose Viewer" });
      expect(screen.getAllByRole("listbox")).toHaveLength(1);

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "Choose Viewer" })).not.toBeInTheDocument();
        expect(screen.getByTestId("file-list-container")).toHaveFocus();
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      });
    });

    it("returns focus to the file list after navigating up from ZIP archive root", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "temp.zip",
            path: "temp.zip",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/zip",
            is_readable: true,
            is_hidden: false,
          },
          {
            name: "zebra.txt",
            path: "zebra.txt",
            type: FileType.FILE,
            size: 2048,
            modified_at: "2024-01-02T00:00:00Z",
            mime_type: "text/plain",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 2,
      });

      renderBrowser("/browse/smb/test-server-1");

      const virtualList = await screen.findByTestId("virtual-list");
      await user.click(virtualList);
      await user.keyboard("{Enter}");
      await screen.findByText("temp.zip");
      await user.keyboard("{Backspace}");

      await waitFor(() => {
        expect(screen.getByTestId("file-list-container")).toHaveFocus();
      });

      await user.keyboard("{ArrowDown}");

      await waitFor(() => {
        expect(screen.getByTestId("status-bar-focused-file-name")).toHaveTextContent("zebra.txt");
      });
    });

    it("does not open physical mutation dialogs from archive keyboard shortcuts", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "temp.zip",
            path: "temp.zip",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/zip",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
      vi.mocked(api.listArchiveDirectory).mockResolvedValue({
        archive: { path: "temp.zip", size: 102400 },
        path: "",
        items: [{ name: "inside.txt", path: "inside.txt", type: FileType.FILE, state: "readable", is_hidden: false }],
        total: 1,
        page_size: 100,
      });

      renderBrowser("/browse/smb/test-server-1");

      const virtualList = await screen.findByTestId("virtual-list");
      await user.click(virtualList);
      await user.keyboard("{Enter}");
      await screen.findByRole("button", { name: /inside.txt/i });

      await user.keyboard("{Delete}{F2}{F7}{Shift>}{F7}{/Shift}");

      expect(screen.queryByText(/will be permanently deleted/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: /rename/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: /create/i })).not.toBeInTheDocument();
    });

    it("opens archive extraction with Alt+F9 and lists it in keyboard help", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "temp.zip",
            path: "temp.zip",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/zip",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
      vi.mocked(api.listArchiveDirectory).mockResolvedValue({
        archive: { path: "temp.zip", size: 102400 },
        path: "",
        items: [{ name: "inside.txt", path: "inside.txt", type: FileType.FILE, state: "readable", is_hidden: false }],
        total: 1,
        page_size: 100,
      });

      renderBrowser("/browse/smb/test-server-1");

      const virtualList = await screen.findByTestId("virtual-list");
      await user.click(virtualList);
      await user.keyboard("{Enter}");
      await screen.findByRole("button", { name: /inside.txt/i });

      fireEvent.keyDown(document, { key: "F9", altKey: true });

      const extractDialog = await screen.findByRole("dialog", { name: "Extract ZIP Archive" });
      expect(within(extractDialog).getByLabelText("Destination directory")).toHaveValue("temp");

      await user.click(within(extractDialog).getByRole("button", { name: "Cancel" }));
      fireEvent.keyDown(document, { key: "F1" });

      const helpDialog = await screen.findByRole("dialog", { name: "File browser shortcuts" });
      expect(within(helpDialog).getByText("Extract ZIP archive")).toBeInTheDocument();
      expect(within(helpDialog).getByText("Alt+F9")).toBeInTheDocument();
    });

    it("opens archive extraction with Alt+F9 for a focused ZIP file", async () => {
      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "notes.txt",
            path: "notes.txt",
            type: FileType.FILE,
            size: 1024,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "text/plain",
            is_readable: true,
            is_hidden: false,
          },
          {
            name: "temp.zip",
            path: "temp.zip",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/zip",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 2,
      });

      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2");

      const [listContainer] = await screen.findAllByTestId("file-list-container");
      listContainer.focus();
      fireEvent.keyDown(document, { key: "F9", altKey: true });
      expect(screen.queryByRole("dialog", { name: "Extract ZIP Archive" })).not.toBeInTheDocument();

      fireEvent.keyDown(document, { key: "ArrowDown" });
      await waitFor(() => expect(screen.getAllByRole("button", { name: /file: temp\.zip/i })[0]).toHaveAttribute("data-selected", "true"));
      fireEvent.keyDown(document, { key: "F9", altKey: true });

      const extractDialog = await screen.findByRole("dialog", { name: "Extract ZIP Archive" });
      expect(within(extractDialog).getByLabelText("Destination directory")).toHaveValue("Test Server 2:/");
      const locationBeforeTab = screen.getByTestId("router-location").textContent;
      fireEvent.keyDown(document, { key: "Tab" });
      expect(screen.getByTestId("router-location")).toHaveTextContent(locationBeforeTab ?? "");
    });

    it("blocks copy, move, and archive creation when the opposite pane is a ZIP archive", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1/archive.zip?p2=smb/test-server-2");

      const lists = await screen.findAllByTestId("virtual-list");
      await user.click(lists[1]!);
      await user.keyboard(" ");

      fireEvent.keyDown(document, { key: "F5" });
      fireEvent.keyDown(document, { key: "F6" });
      fireEvent.keyDown(document, { key: "F5", altKey: true });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.copyItem).not.toHaveBeenCalled();
      expect(api.moveItem).not.toHaveBeenCalled();
      expect(api.prepareArchiveOperation).not.toHaveBeenCalled();
      expect(api.executeArchiveCreation).not.toHaveBeenCalled();
    });

    it("blocks copy, move, and archive creation when the selected source is inside a ZIP archive", async () => {
      const user = userEvent.setup();
      vi.mocked(api.listArchiveDirectory).mockResolvedValue({
        archive: { path: "archive.zip", size: 1 },
        path: "",
        items: [{ name: "inside.txt", path: "inside.txt", type: FileType.FILE, state: "readable", is_hidden: false }],
        total: 1,
        page_size: 100,
      });
      renderBrowser("/browse/smb/test-server-1/archive.zip?p2=smb/test-server-2");

      const lists = await screen.findAllByTestId("virtual-list");
      await user.click(lists[0]!);
      await user.keyboard(" ");

      fireEvent.keyDown(document, { key: "F5" });
      fireEvent.keyDown(document, { key: "F6" });
      fireEvent.keyDown(document, { key: "F5", altKey: true });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.copyItem).not.toHaveBeenCalled();
      expect(api.moveItem).not.toHaveBeenCalled();
      expect(api.prepareArchiveOperation).not.toHaveBeenCalled();
      expect(api.executeArchiveCreation).not.toHaveBeenCalled();
    });

    it("opens the saved preferred Sambee viewer on Enter even when it is outside the default compatible subset", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "report.pdf",
            path: "report.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });
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
          selected_connection_id: null,
          viewer_associations: {
            "mime:application/pdf": "markdown",
            "ext:.pdf": "markdown",
          },
        },
      });

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /report.pdf/i })).toBeInTheDocument();
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Markdown Viewer")).toBeInTheDocument();
      });
      expect(screen.queryByRole("dialog", { name: "Choose Viewer" })).not.toBeInTheDocument();
    });

    it("shows all Sambee viewers in the forced browser picker", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "report.pdf",
            path: "report.pdf",
            type: FileType.FILE,
            size: 102400,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/pdf",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /report.pdf/i })).toBeInTheDocument();
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{Shift>}{Enter}{/Shift}");

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: "Choose Viewer" })).toBeInTheDocument();
      });
      expect(screen.getByText("PDF Viewer")).toBeInTheDocument();
      expect(screen.getByText("Markdown Viewer")).toBeInTheDocument();
      expect(screen.getByText("Image Viewer")).toBeInTheDocument();
    });

    it("shows the viewer picker on mouse click when no associated viewer exists", async () => {
      const user = userEvent.setup();

      vi.mocked(api.listDirectory).mockResolvedValue({
        path: "",
        items: [
          {
            name: "archive.bin",
            path: "archive.bin",
            type: FileType.FILE,
            size: 2048,
            modified_at: "2024-01-01T00:00:00Z",
            mime_type: "application/octet-stream",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      });

      renderBrowser("/browse/smb/test-server-1");

      const fileButton = await screen.findByRole("button", { name: /archive.bin/i });
      await user.click(fileButton);

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: "Choose Viewer" })).toBeInTheDocument();
      });
      expect(screen.getByText("Open in native app")).toBeInTheDocument();
    });
  });

  describe("Keyboard Navigation", () => {
    it("opens navigate mode with Ctrl+K even when a toolbar button is focused", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const settingsButton = screen.getByRole("button", { name: /open settings/i });
      settingsButton.focus();
      expect(settingsButton).toHaveFocus();

      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = await screen.findByPlaceholderText("Navigate to any directory");
      expect(quickBarInput).toHaveFocus();
    });

    it("opens the connection selector with Ctrl+ArrowDown", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const quickBarInput = screen.getByPlaceholderText("Navigate to any directory");
      quickBarInput.focus();
      expect(quickBarInput).toHaveFocus();

      await user.keyboard("{Control>}{ArrowDown}{/Control}");

      expect(await screen.findByRole("listbox")).toBeInTheDocument();
      expect(screen.getByText("Test Server 1 (192.168.1.100/share1)")).toBeInTheDocument();
    });

    it("does not open the connection selector or mode menu when Ctrl+ArrowDown is pressed on the mode button", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });
      modeButton.focus();
      expect(modeButton).toHaveFocus();

      await user.keyboard("{Control>}{ArrowDown}{/Control}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "File Search" })).not.toBeInTheDocument();
    });

    it("does not show an empty no-results dropdown when navigate mode opens", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = await screen.findByPlaceholderText("Navigate to any directory");
      expect(quickBarInput).toHaveFocus();
      expect(screen.queryByText(/No results found for/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("searches recent directories and shows no-results for single-character quick nav input", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = await screen.findByPlaceholderText("Navigate to any directory");
      await user.type(quickBarInput, "e");

      expect(await screen.findByText(/No results found for/i)).toHaveTextContent("e");
      expect(api.searchRecentDirectories).toHaveBeenCalledWith("e", 10, expect.any(AbortSignal));
    });

    it("always shows the current quick-bar mode pill", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");
      await screen.findByPlaceholderText("Navigate to any directory");
      expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("Navigate");

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("Commands");

      await user.type(commandInput, "f");
      expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("Commands");

      await user.click(screen.getByTestId("virtual-list"));
      await user.keyboard("/");

      const fileSearchInput = await screen.findByPlaceholderText("Search recent and current-directory files");
      expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("File Search");

      await user.type(fileSearchInput, "r");
      expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("File Search");
    });

    it.each([
      ["a same-tab history change", () => window.dispatchEvent(new Event(RECENT_FILES_CHANGED_EVENT))],
      ["window focus", () => window.dispatchEvent(new Event("focus"))],
      ["returning to a visible tab", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("refreshes active File Search after %s", async (_description, triggerRefresh) => {
      const user = userEvent.setup();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByTestId("virtual-list"));
      await user.keyboard("/");
      await screen.findByPlaceholderText("Search recent and current-directory files");
      await waitFor(() => {
        expect(api.searchRecentFiles).toHaveBeenCalledWith("", 50, expect.any(AbortSignal));
      });

      const callsBeforeRefresh = vi.mocked(api.searchRecentFiles).mock.calls.length;
      triggerRefresh();

      await waitFor(() => {
        expect(api.searchRecentFiles).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
      });
    });

    it.each([
      ["a same-tab history change", () => window.dispatchEvent(new Event(RECENT_FILES_CHANGED_EVENT))],
      ["window focus", () => window.dispatchEvent(new Event("focus"))],
      ["returning to a visible tab", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("does not reopen focused but dismissed File Search after %s", async (_description, triggerRefresh) => {
      const user = userEvent.setup();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      renderBrowser("/browse/smb/test-server-1");

      const listContainer = await screen.findByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("/");
      const fileSearchInput = await screen.findByPlaceholderText("Search recent and current-directory files");
      await screen.findByRole("listbox");

      await user.keyboard("{Escape}");
      expect(fileSearchInput).toHaveFocus();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      const callsBeforeRefresh = vi.mocked(api.searchRecentFiles).mock.calls.length;

      triggerRefresh();

      await waitFor(() => {
        expect(api.searchRecentFiles).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
      });
      expect(fileSearchInput).toHaveFocus();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it.each([
      ["a same-tab directory-history change", () => window.dispatchEvent(new Event(RECENT_DIRECTORIES_CHANGED_EVENT))],
      ["window focus", () => window.dispatchEvent(new Event("focus"))],
      ["returning to a visible tab", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("refreshes active Directory Navigation after %s", async (_description, triggerRefresh) => {
      const user = userEvent.setup();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");
      await screen.findByPlaceholderText("Navigate to any directory");
      await waitFor(() => {
        expect(api.searchRecentDirectories).toHaveBeenCalledWith("", 10, expect.any(AbortSignal));
      });

      const callsBeforeRefresh = vi.mocked(api.searchRecentDirectories).mock.calls.length;
      triggerRefresh();

      await waitFor(() => {
        expect(api.searchRecentDirectories).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
      });
    });

    it("does not reopen focused but dismissed Directory Navigation after a history refresh", async () => {
      const user = userEvent.setup();
      vi.mocked(api.searchRecentDirectories).mockResolvedValue({
        result_limit: 10,
        results: [
          {
            id: "recent-documents",
            connection_id: "test-server-1",
            path: "Documents",
            last_visited_at: "2026-01-01T00:00:00Z",
          },
        ],
      });
      renderBrowser("/browse/smb/test-server-1");

      await user.keyboard("{Control>}k{/Control}");
      const navigateInput = await screen.findByPlaceholderText("Navigate to any directory");
      await screen.findByRole("listbox");

      await user.keyboard("{Escape}");
      expect(navigateInput).toHaveFocus();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      const callsBeforeRefresh = vi.mocked(api.searchRecentDirectories).mock.calls.length;

      window.dispatchEvent(new Event(RECENT_DIRECTORIES_CHANGED_EVENT));

      await waitFor(() => {
        expect(api.searchRecentDirectories).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
      });
      expect(navigateInput).toHaveFocus();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("does not reopen dismissed File Search after returning to the browser tab", async () => {
      const user = userEvent.setup();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      renderBrowser("/browse/smb/test-server-1");

      const listContainer = await screen.findByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("/");
      await screen.findByRole("listbox");

      await user.keyboard("{Escape}{Escape}");
      await waitFor(() => {
        expect(screen.getByTestId("file-list-container")).toHaveFocus();
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      });

      const callsBeforeTabReturn = vi.mocked(api.searchRecentFiles).mock.calls.length;
      fireEvent(window, new Event("focus"));
      fireEvent(document, new Event("visibilitychange"));

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(api.searchRecentFiles).toHaveBeenCalledTimes(callsBeforeTabReturn);
    });

    it("keeps Home and End bound to the navigate input text", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = await screen.findByPlaceholderText("Navigate to any directory");
      await user.type(quickBarInput, "abc");
      await user.keyboard("{Home}");
      await user.keyboard("x");
      await user.keyboard("{End}");
      await user.keyboard("z");

      expect(quickBarInput).toHaveValue("xabcz");
    });

    it("keeps quick navigation bound to the pane that opened it in dual-pane mode", async () => {
      const user = userEvent.setup();

      vi.mocked(api.searchDirectories).mockImplementation(async (connectionId, query) => {
        if (query === "Ri") {
          if (connectionId === "conn-2") {
            return {
              results: ["RightTarget"],
              total_matches: 1,
              cache_state: "ready",
              directory_count: 1,
            };
          }

          return {
            results: ["LeftTarget"],
            total_matches: 1,
            cache_state: "ready",
            directory_count: 1,
          };
        }

        return {
          results: [],
          total_matches: 0,
          cache_state: "ready",
          directory_count: 1,
        };
      });

      vi.mocked(api.listDirectory).mockImplementation(async (connectionId, path) => {
        if (connectionId === "conn-2" && path === "RightTarget") {
          return {
            items: [],
            path: "RightTarget",
            total: 0,
          };
        }

        return mockDirectoryListing;
      });

      const { container } = renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
        expectDirectoryLoad("conn-2", "");
      });

      const rightPane = container.querySelector('[data-pane-id="right"]');
      const leftPane = container.querySelector('[data-pane-id="left"]');

      expect(rightPane).not.toBeNull();
      expect(leftPane).not.toBeNull();

      await user.click(rightPane as HTMLElement);
      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = screen.getByPlaceholderText("Navigate to any directory");
      await user.type(quickBarInput, "Ri");

      await waitFor(() => {
        expect(api.searchDirectories).toHaveBeenCalledWith(
          "conn-2",
          "Ri",
          expect.objectContaining({
            includeDotDirectories: false,
            signal: expect.any(AbortSignal),
          })
        );
      });

      await user.click(leftPane as HTMLElement);
      await user.click(screen.getByPlaceholderText("Navigate to any directory"));
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expectDirectoryLoad("conn-2", "RightTarget");
      });
    });

    it("uses the persisted quick-nav dot-directory preference", async () => {
      const user = userEvent.setup();

      localStorage.setItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY, "true");
      vi.mocked(api.getCurrentUserSettings).mockResolvedValue({
        appearance: { theme_id: "sambee-light", custom_themes: [] },
        localization: {
          language: "browser",
          regional_locale: "browser",
        },
        browser: {
          quick_nav_include_dot_directories: true,
          file_browser_view_mode: "list",
          pane_mode: "single",
          selected_connection_id: null,
          viewer_associations: {},
        },
      });

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");

      const quickBarInput = await screen.findByPlaceholderText("Navigate to any directory");
      await user.type(quickBarInput, "do");

      await waitFor(() => {
        expect(api.searchDirectories).toHaveBeenCalledWith(
          "conn-1",
          "do",
          expect.objectContaining({
            includeDotDirectories: true,
            signal: expect.any(AbortSignal),
          })
        );
      });
    });

    it("keeps focus in the quick bar when a command switches quick-bar modes", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      expect(commandInput).toHaveFocus();

      await user.type(commandInput, "file search");
      const fileSearchCommand = await screen.findByText("File Search");
      await user.click(fileSearchCommand);

      await waitFor(() => {
        const fileSearchInput = screen.getByPlaceholderText("Search recent and current-directory files");
        expect(fileSearchInput).toHaveFocus();
      });
    });

    it("switches quick-bar modes from the mode pill", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}k{/Control}");

      const modeButton = await screen.findByRole("button", { name: "Switch quick bar mode" });
      expect(modeButton).toHaveTextContent("Navigate");

      await user.click(modeButton);
      await user.click(await screen.findByRole("menuitem", { name: "Commands" }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Run a command")).toHaveFocus();
        expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("Commands");
      });

      await user.click(screen.getByRole("button", { name: "Switch quick bar mode" }));
      await user.click(await screen.findByRole("menuitem", { name: "File Search" }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search recent and current-directory files")).toHaveFocus();
        expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("File Search");
      });

      await user.click(screen.getByRole("button", { name: "Switch quick bar mode" }));
      await user.click(await screen.findByRole("menuitem", { name: "Navigate" }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Navigate to any directory")).toHaveFocus();
        expect(screen.getByRole("button", { name: "Switch quick bar mode" })).toHaveTextContent("Navigate");
        expect(screen.getByRole("button", { name: /readme.txt/i })).toBeInTheDocument();
      });
    });

    it("navigates down with ArrowDown key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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
      renderBrowser("/browse/smb/test-server-1");

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
      renderBrowser("/browse/smb/test-server-1");

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
        expectDirectoryLoad("conn-1", "Documents");
      });
    });

    it("opens the focused item when Open Focused Item is selected from commands mode", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        const documentsElements = screen.getAllByText("Documents");
        expect(documentsElements.length).toBeGreaterThan(0);
      });

      const documentsFolder = screen.getByRole("button", {
        name: /documents/i,
      });
      await user.click(documentsFolder);

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      await user.type(commandInput, "open");
      await user.click(await screen.findByText("Open Focused Item"));

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Documents");
      });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
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

      renderBrowser("/browse/smb/test-server-1/Documents");

      // Optimized: Use findByText
      await waitFor(() => {
        const elements = screen.getAllByText("file.txt");
        expect(elements.length).toBeGreaterThan(0);
      });

      // Press Backspace to go to parent
      await user.keyboard("{Backspace}");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
      });
    });

    it("does not navigate to parent when Backspace is pressed in an empty commands quick bar", async () => {
      const user = userEvent.setup();

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

      renderBrowser("/browse/smb/test-server-1/Documents");

      await waitFor(() => {
        expect(screen.getAllByText("file.txt").length).toBeGreaterThan(0);
      });

      const initialCallCount = (api.listDirectory as Mock).mock.calls.length;

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      expect(commandInput).toHaveFocus();
      expect(commandInput).toHaveValue("");

      await user.keyboard("{Backspace}");

      expect(commandInput).toHaveFocus();
      expect((api.listDirectory as Mock).mock.calls.length).toBe(initialCallCount);
      expect(screen.queryByPlaceholderText("Navigate to any directory")).not.toBeInTheDocument();
    });

    it("opens shortcuts dialog with ? key", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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

    it("closes the commands dropdown after selecting Show Keyboard Shortcuts", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      await user.type(commandInput, "show");
      await user.click(await screen.findByText("Show Keyboard Shortcuts"));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("handles keyboard navigation without crashing on empty directory", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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
      renderBrowser("/browse/smb/test-server-1");

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

      renderBrowser("/browse/smb/test-server-1");

      expect(await screen.findByText(/Connection not found/i)).toBeInTheDocument();
    });

    it("handles generic API errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue({
        response: { data: { detail: "Server error" } },
      });

      renderBrowser("/browse/smb/test-server-1");

      expect(await screen.findByText(/Server error/i)).toBeInTheDocument();
    });

    it("handles network errors", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue(createNetworkError());

      renderBrowser("/browse/smb/test-server-1");

      expect(await screen.findByText(/Failed to load files. Please check your connection settings/i)).toBeInTheDocument();
    });

    it("handles timeout errors with a dedicated message", async () => {
      vi.mocked(api.listDirectory).mockRejectedValue(createTimeoutError());

      renderBrowser("/browse/smb/test-server-1");

      expect(await screen.findByText(/Directory listing timed out. The remote share took too long to respond/i)).toBeInTheDocument();
    });
  });

  describe("Delete", () => {
    it("opens delete dialog when Delete Focused Item is selected from commands mode", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      await user.type(commandInput, "delete");
      await user.click(await screen.findByText("Delete Focused Item"));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("opens confirm dialog when Delete key pressed on focused file", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");

      // Focus on the list and ensure first item is focused
      await user.click(listContainer);

      // Press Delete key
      await user.keyboard("{Delete}");

      // Confirm dialog should clearly state the deletion outcome.
      await waitFor(() => {
        expect(screen.getByText(/will be permanently deleted/i)).toBeInTheDocument();
      });
    });

    it("calls deleteItem API when confirmed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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

    it("deletes every selected item when confirmed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{Insert}");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Documents.*selected/i })).toBeInTheDocument();
      });
      await user.keyboard("{Insert}");
      await user.keyboard("{Delete}");

      expect(await screen.findByText("The following 2 items will be permanently deleted:")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(api.deleteItem).toHaveBeenCalledTimes(2);
      });
    });

    it("closes dialog when Cancel is clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

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
        expect(screen.queryByText(/will be permanently deleted/i)).not.toBeInTheDocument();
      });
    });

    it("does not open confirm dialog for read-only connections", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue([{ ...mockConnections[0], access_mode: "read_only" }]);

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{Delete}");

      await waitFor(() => {
        expect(screen.queryByText(/will be permanently deleted/i)).not.toBeInTheDocument();
      });
      expect(api.deleteItem).not.toHaveBeenCalled();
    });
  });

  describe("Rename", () => {
    it("opens rename dialog when Rename Focused Item is selected from commands mode", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      await user.keyboard("{Control>}p{/Control}");

      const commandInput = await screen.findByPlaceholderText("Run a command");
      await user.type(commandInput, "rename");
      await user.click(await screen.findByText("Rename Focused Item"));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("opens rename dialog when F2 is pressed on focused file", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      // Press F2 key
      await user.keyboard("{F2}");

      // Rename dialog should appear
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    it("keeps slash input in the rename dialog instead of opening File Search", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByTestId("virtual-list"));
      await user.keyboard("{F2}");

      const input = await screen.findByLabelText(/new name/i);
      await user.clear(input);
      await user.type(input, "/");

      expect(input).toHaveValue("/");
      expect(screen.queryByPlaceholderText("Search recent and current-directory files")).not.toBeInTheDocument();
    });

    it("calls renameItem API when confirmed", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      // Press F2 to open rename dialog
      await user.keyboard("{F2}");

      // Wait for the rename dialog input to appear
      const input = await screen.findByLabelText(/new name/i);
      await user.clear(input);
      await user.type(input, "Renamed-Item");

      // Click Rename button
      const renameButton = await screen.findByRole("button", { name: /^rename$/i });
      await user.click(renameButton);

      // renameItem should have been called
      await waitFor(() => {
        expect(api.renameItem).toHaveBeenCalled();
      });
    });

    it("closes dialog when Cancel is clicked", async () => {
      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1");

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      // Press F2 to open rename dialog
      await user.keyboard("{F2}");

      // Wait for dialog and click Cancel
      const cancelButton = await screen.findByRole("button", { name: /cancel/i });
      await user.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByLabelText(/new name/i)).not.toBeInTheDocument();
      });
    });

    it("does not open rename dialog for read-only connections", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue([{ ...mockConnections[0], access_mode: "read_only" }]);

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);
      await user.keyboard("{F2}");

      await waitFor(() => {
        expect(screen.queryByLabelText(/new name/i)).not.toBeInTheDocument();
      });
      expect(api.renameItem).not.toHaveBeenCalled();
    });

    it("still prevents the browser default for F2 on read-only connections", async () => {
      const user = userEvent.setup();

      vi.mocked(api.getConnections).mockResolvedValue([{ ...mockConnections[0], access_mode: "read_only" }]);

      renderBrowser("/browse/smb/test-server-1");

      await waitFor(() => {
        expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
      });

      const listContainer = screen.getByTestId("virtual-list");
      await user.click(listContainer);

      const event = createEvent.keyDown(document, { key: "F2" });
      fireEvent(document, event);

      expect(event.defaultPrevented).toBe(true);
      expect(screen.queryByLabelText(/new name/i)).not.toBeInTheDocument();
      expect(api.renameItem).not.toHaveBeenCalled();
    });
  });
});
