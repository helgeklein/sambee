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
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import { type ApiMock, createMarkdownViewerMock, createSettingsDialogMock, setupSuccessfulApiMocks } from "../../test/helpers";
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
    localStorage.setItem("access_token", "fake-token");
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
