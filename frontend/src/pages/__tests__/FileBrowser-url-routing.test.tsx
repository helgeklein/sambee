/**
 * FileBrowser — URL Routing Tests (Phase 3)
 * ==========================================
 *
 * Verifies:
 * - Single-pane typed URLs load correctly
 * - Dual-pane mode is restored when ?p2= is present in the URL
 * - Right pane connection and path are restored from ?p2=type/id/path
 * - Active pane is restored from ?active=2
 * - Invalid typed p2 targets are handled gracefully
 * - Local-drive routes participate in URL restoration
 * - URL query param constants are correct
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { authSession } from "../../services/authSession";
import { type ApiMock, createMarkdownViewerMock, createSettingsDialogMock, setupSuccessfulApiMocks } from "../../test/helpers";
import { FileType } from "../../types";
import { parseBrowseRoute, serializeBrowseRoute } from "../FileBrowser/routing";
import { ACTIVE_PANE_QUERY_KEY, RIGHT_PANE_QUERY_KEY } from "../FileBrowser/types";
import { renderBrowser } from "./FileBrowser.test.utils";

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
// @tanstack/react-virtual mock
vi.mock("@tanstack/react-virtual", () => import("../../__mocks__/@tanstack/react-virtual"));

describe("FileBrowser — URL Routing (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authSession.setAuthenticated({ access_token: "fake-token", token_type: "bearer" }, false);
    localStorage.removeItem("selectedConnectionId");
    localStorage.removeItem("dual-pane-mode");
    localStorage.removeItem("active-pane");

    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe("URL query param constants", () => {
    it("RIGHT_PANE_QUERY_KEY is 'p2'", () => {
      expect(RIGHT_PANE_QUERY_KEY).toBe("p2");
    });

    it("ACTIVE_PANE_QUERY_KEY is 'active'", () => {
      expect(ACTIVE_PANE_QUERY_KEY).toBe("active");
    });

    it("serializes independent virtual locations as slash-delimited pane paths", () => {
      const route = {
        left: {
          kind: "smb" as const,
          targetId: "test-server-1",
          path: "Archives",
          virtualLocation: { providerId: "zip", sourcePath: "Archives/left.zip", virtualPath: "docs" },
        },
        right: {
          kind: "smb" as const,
          targetId: "test-server-2",
          path: "Backups",
          virtualLocation: { providerId: "zip", sourcePath: "Backups/right.zip", virtualPath: "inside" },
        },
        activePaneId: "right" as const,
      };

      const url = serializeBrowseRoute(route);
      expect(url).toBe("/browse/smb/test-server-1/Archives/left.zip/docs?p2=smb%2Ftest-server-2%2FBackups%2Fright.zip%2Finside&active=2");

      const parsedUrl = new URL(url, "http://localhost");
      expect(
        parseBrowseRoute({
          targetType: "smb",
          targetId: "test-server-1",
          path: "Archives/left.zip/docs",
          searchParams: parsedUrl.searchParams,
        })
      ).toEqual({
        left: { kind: "smb", targetId: "test-server-1", path: "Archives/left.zip/docs" },
        right: { kind: "smb", targetId: "test-server-2", path: "Backups/right.zip/inside" },
        activePaneId: "right",
      });
    });
  });

  describe("settings dialog routing", () => {
    it("opens the requested settings category from the settings query parameter", async () => {
      renderBrowser("/browse/smb/test-server-1?settings=admin-authentication#flow=test-flow");

      const dialog = await screen.findByTestId("settings-dialog");

      expect(dialog).toHaveAttribute("data-category", "admin-authentication");
    });

    it("opens the File Search settings category from the settings query parameter", async () => {
      renderBrowser("/browse/smb/test-server-1?settings=admin-file-search");

      const dialog = await screen.findByTestId("settings-dialog");

      expect(dialog).toHaveAttribute("data-category", "admin-file-search");
    });
  });

  // --------------------------------------------------------------------------
  // Single-pane backward compatibility
  // --------------------------------------------------------------------------

  describe("single-pane typed routes", () => {
    it("loads single-pane mode from a clean URL without query params", async () => {
      renderBrowser("/browse/smb/test-server-1");

      // Should load and display files in single pane
      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
      });

      // Files should render
      await waitFor(() => {
        const docs = screen.getAllByText("Documents");
        expect(docs.length).toBeGreaterThan(0);
      });
    });

    it("loads single-pane mode with a subpath", async () => {
      renderBrowser("/browse/smb/test-server-1/Documents");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Documents");
      });
    });

    it("serializes archive navigation and restores a virtual archive deep link", async () => {
      vi.mocked(api.listDirectory).mockImplementation(async (_connectionId, path) => ({
        path,
        items:
          path === "Archives"
            ? [
                {
                  name: "backup.zip",
                  path: "Archives/backup.zip",
                  type: FileType.FILE,
                  is_readable: true,
                  is_hidden: false,
                },
              ]
            : [],
        total: path === "Archives" ? 1 : 0,
      }));
      vi.mocked(api.listArchiveDirectory).mockImplementation(async (_connectionId, archivePath, virtualPath) => ({
        archive: { path: archivePath, size: 1 },
        path: virtualPath,
        items:
          virtualPath === ""
            ? [{ name: "nested", path: "nested", type: FileType.DIRECTORY, state: "readable", is_hidden: false }]
            : [{ name: "member.txt", path: "nested/member.txt", type: FileType.FILE, state: "readable", is_hidden: false }],
        total: 1,
        page_size: 100,
      }));
      vi.mocked(api.getFileInfo).mockImplementation(
        async (_connectionId, path) =>
          ({
            type: path === "Archives/backup.zip" ? FileType.FILE : FileType.DIRECTORY,
          }) as never
      );

      const user = userEvent.setup();
      renderBrowser("/browse/smb/test-server-1/Archives");

      await user.click(await screen.findByRole("button", { name: /file: backup\.zip/i }));
      await waitFor(() => {
        expect(screen.getByTestId("router-location")).toHaveTextContent("/browse/smb/test-server-1/Archives/backup.zip");
      });

      await user.click(await screen.findByRole("button", { name: /folder: nested/i }));
      await waitFor(() => {
        expect(screen.getByTestId("router-location")).toHaveTextContent("/browse/smb/test-server-1/Archives/backup.zip/nested");
      });

      await user.keyboard("{Backspace}");
      await user.keyboard("{Backspace}");
      await waitFor(() => {
        expect(screen.getByTestId("router-location")).toHaveTextContent("/browse/smb/test-server-1/Archives");
      });
    });

    it("hydrates an archive deep link through its virtual provider", async () => {
      vi.mocked(api.listArchiveDirectory).mockImplementation(async (_connectionId, archivePath, virtualPath) => ({
        archive: { path: archivePath, size: 1 },
        path: virtualPath,
        items:
          virtualPath === ""
            ? [{ name: "nested", path: "nested", type: FileType.DIRECTORY, state: "readable", is_hidden: false }]
            : [{ name: "member.txt", path: "nested/member.txt", type: FileType.FILE, state: "readable", is_hidden: false }],
        total: 1,
        page_size: 100,
      }));
      vi.mocked(api.getFileInfo).mockImplementation(
        async (_connectionId, path) =>
          ({
            type: path === "Archives/backup.zip" ? FileType.FILE : FileType.DIRECTORY,
          }) as never
      );

      renderBrowser("/browse/smb/test-server-1/Archives/backup.zip/nested");
      await waitFor(() => {
        expect(api.listArchiveDirectory).toHaveBeenCalledWith("conn-1", "Archives/backup.zip", "nested", {
          pageSize: 100,
          signal: expect.any(AbortSignal),
        });
      });
      expect((await screen.findAllByText("member.txt")).length).toBeGreaterThan(0);
    });

    it("keeps physical directory semantics for a directory named with an archive extension", async () => {
      vi.mocked(api.getFileInfo).mockResolvedValue({ type: FileType.DIRECTORY } as never);

      renderBrowser("/browse/smb/test-server-1/folder.zip/child");

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "folder.zip/child");
      });
      expect(api.listArchiveDirectory).not.toHaveBeenCalled();
    });

    it("replaces a missing archive route with its deepest existing physical ancestor", async () => {
      vi.mocked(api.getFileInfo).mockImplementation(async (_connectionId, path) => {
        if (path === "Existing/missing.zip") {
          throw { isAxiosError: true, response: { status: 404 } };
        }
        return { type: FileType.DIRECTORY } as never;
      });

      renderBrowser("/browse/smb/test-server-1/Existing/missing.zip");

      await waitFor(() => {
        expect(screen.getByTestId("router-location")).toHaveTextContent("/browse/smb/test-server-1/Existing");
        expectDirectoryLoad("conn-1", "Existing");
      });
    });

    it("replaces an invalid archive route with the physical parent directory", async () => {
      vi.mocked(api.getFileInfo).mockImplementation(
        async (_connectionId, path) =>
          ({
            type: path === "Archives/broken.zip" ? FileType.FILE : FileType.DIRECTORY,
          }) as never
      );
      vi.mocked(api.listArchiveDirectory).mockRejectedValue({ isAxiosError: true, response: { status: 422 } });

      renderBrowser("/browse/smb/test-server-1/Archives/broken.zip/nested");

      await waitFor(() => {
        expect(screen.getByTestId("router-location")).toHaveTextContent("/browse/smb/test-server-1/Archives");
        expectDirectoryLoad("conn-1", "Archives");
      });
    });
  });

  // --------------------------------------------------------------------------
  // Dual-pane restoration from URL
  // --------------------------------------------------------------------------

  describe("dual-pane restoration from URL", () => {
    it("activates dual-pane mode when ?p2= is present", async () => {
      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Both panes should request directory listings
      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
      });

      await waitFor(() => {
        expectDirectoryLoad("conn-2", "");
      });
    });

    it("restores right pane path from ?p2=type/id/path/segments", async () => {
      renderBrowser("/browse/smb/test-server-1/Documents?p2=smb/test-server-2/Pictures");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Left pane should load Documents
      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Documents");
      });

      // Right pane should load Pictures
      await waitFor(() => {
        expectDirectoryLoad("conn-2", "Pictures");
      });
    });

    it("restores both panes to the same connection", async () => {
      renderBrowser("/browse/smb/test-server-1/Documents?p2=smb/test-server-1/Pictures");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Both calls should use conn-1 with different paths
      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Documents");
      });

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Pictures");
      });
    });

    it("persists dual-pane mode to localStorage when restored from URL", async () => {
      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(localStorage.getItem("dual-pane-mode")).toBe("dual");
      });
    });
  });

  // --------------------------------------------------------------------------
  // Active pane restoration
  // --------------------------------------------------------------------------

  describe("active pane restoration from URL", () => {
    it("defaults to left pane when ?active is absent", async () => {
      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Active pane should default to left
      await waitFor(() => {
        expect(localStorage.getItem("active-pane")).not.toBe("right");
      });
    });

    it("restores right pane as active when ?active=2", async () => {
      renderBrowser("/browse/smb/test-server-1?p2=smb/test-server-2&active=2");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(localStorage.getItem("active-pane")).toBe("right");
      });
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("ignores invalid SMB p2 targets gracefully", async () => {
      renderBrowser("/browse/smb/test-server-1?p2=smb/nonexistent-server/photos");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Left pane should still load normally
      await waitFor(() => {
        expectDirectoryLoad("conn-1", "");
      });

      // Right pane should NOT have loaded (invalid connection slug)
      // Only conn-1 calls should exist
      const listDirCalls = vi.mocked(api.listDirectory).mock.calls;
      const conn2Calls = listDirCalls.filter((call) => call[0] === "conn-2");
      expect(conn2Calls).toHaveLength(0);
    });

    it("handles p2 with no path (root of connection)", async () => {
      renderBrowser("/browse/smb/test-server-1/Documents?p2=smb/test-server-2");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      // Right pane should load root
      await waitFor(() => {
        expectDirectoryLoad("conn-2", "");
      });
    });

    it("loads local drives from typed left-pane URLs", async () => {
      renderBrowser("/browse/local/c/Users");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      await waitFor(() => {
        expectDirectoryLoad("local-drive:c", "Users");
      });
    });

    it("restores a local drive in the right pane from p2", async () => {
      renderBrowser("/browse/smb/test-server-1/Documents?p2=local/c/Users");

      await waitFor(() => {
        expect(api.getConnections).toHaveBeenCalled();
      });

      await waitFor(() => {
        expectDirectoryLoad("conn-1", "Documents");
      });

      await waitFor(() => {
        expectDirectoryLoad("local-drive:c", "Users");
      });
    });
  });
});
