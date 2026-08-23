import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import api from "../../services/api";
import { authSession } from "../../services/authSession";
import { clearCurrentUserSettingsCache } from "../../services/userSettingsSync";
import { type ApiMock, setupSuccessfulApiMocks } from "../../test/helpers";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { FileType } from "../../types";
import { useFileBrowserPane } from "../FileBrowser/useFileBrowserPane";
import { mockConnections, mockDirectoryListing, mockEmptyDirectory, mockNestedDirectory } from "./FileBrowser.test.utils";

vi.mock("../../services/api");

describe("useFileBrowserPane", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <SambeeThemeProvider>{children}</SambeeThemeProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserSettingsCache();
    authSession.setAuthenticated({ access_token: "fake-token", token_type: "bearer" }, false);
    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  it("ignores a stale route replay after starting a local directory navigation", async () => {
    const onNavigatePath = vi.fn();
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
          onNavigatePath,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("conn-1");
      expect(result.current.currentPath).toBe("");
    });

    act(() => {
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
    });

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    expect(result.current.currentPath).toBe("Documents");
    expect(onNavigatePath).toHaveBeenCalledWith("Documents");

    act(() => {
      result.current.applyLocation("conn-1", "Documents");
    });

    expect(result.current.currentPath).toBe("Documents");
  });

  it("ignores an out-of-order older route replay after a newer route has already been accepted", async () => {
    const onNavigatePath = vi.fn();
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
          onNavigatePath,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("conn-1", "", 1);
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("");
    });

    act(() => {
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
    });

    act(() => {
      result.current.applyLocation("conn-1", "Documents", 3);
    });

    expect(result.current.currentPath).toBe("Documents");

    act(() => {
      result.current.applyLocation("conn-1", "", 2);
    });

    expect(result.current.currentPath).toBe("Documents");
    expect(onNavigatePath).toHaveBeenCalledWith("Documents");
  });

  it("restores a captured recovery snapshot with pane UI state", async () => {
    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("conn-1");
      expect(result.current.files.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.setSortBy("modified");
      result.current.setSortDirection("desc");
      result.current.handleSelectAll();
      result.current.setViewInfo({
        path: "readme.txt",
        mimeType: "text/plain",
        sessionId: "session-1",
      });
    });

    const snapshot = result.current.captureRecoverySnapshot();

    expect(snapshot).not.toBeNull();

    const { result: restoredResult } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      restoredResult.current.restoreRecoverySnapshot(snapshot);
    });

    await waitFor(() => {
      expect(restoredResult.current.connectionId).toBe("conn-1");
      expect(restoredResult.current.currentPath).toBe("");
      expect(restoredResult.current.files).toEqual(mockDirectoryListing.items);
      expect(restoredResult.current.sortBy).toBe("modified");
      expect(restoredResult.current.sortDirection).toBe("desc");
      expect(restoredResult.current.selectedFiles.size).toBe(mockDirectoryListing.items.length);
      expect(restoredResult.current.viewInfo?.path).toBe("readme.txt");
    });
  });

  it("normalizes same-drive absolute Windows paths for local-drive panes", async () => {
    const localDriveConnection = {
      ...mockConnections[0],
      id: "local-drive:d",
      slug: "d",
      type: "local",
      name: "Drive D",
    };

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localDriveConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:d", "d:\\temp");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:d");
      expect(result.current.currentPath).toBe("temp");
    });
  });

  it("records a local directory only after Companion confirms its type", async () => {
    const localDriveConnection = {
      ...mockConnections[0],
      id: "local-drive:d",
      slug: "d",
      type: "local",
      name: "Drive D",
    };
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();
    vi.mocked(api.getFileInfo).mockResolvedValue({ type: FileType.DIRECTORY } as never);
    vi.mocked(api.resolveLocalActivation).mockImplementation(async (_connectionId, path) => ({
      drive_id: "d",
      path,
      item: { ...documentsDirectory!, path, type: FileType.DIRECTORY },
    }));

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localDriveConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:d", "");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:d");
    });

    act(() => {
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(api.getFileInfo).toHaveBeenCalledWith("local-drive:d", "Documents");
      expect(api.recordRecentDirectory).toHaveBeenCalledWith("local-drive:d", "Documents");
    });

    vi.mocked(api.getFileInfo).mockResolvedValue({ type: FileType.FILE } as never);

    act(() => {
      result.current.handleFileClick({ ...documentsDirectory!, name: "Other", path: "Other" });
    });

    await waitFor(() => {
      expect(api.getFileInfo).toHaveBeenCalledWith("local-drive:d", "Documents/Other");
    });
    expect(api.recordRecentDirectory).toHaveBeenCalledTimes(1);
  });

  it("navigates to a directory resolved from a local link on another drive", async () => {
    const sourceConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const targetConnection = { ...mockConnections[0], id: "local-drive:d", slug: "d", type: "local", name: "Drive D" };
    const link = {
      name: "Archive.lnk",
      path: "Archive.lnk",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    const onNavigateDirectory = vi.fn();
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "d",
      path: "Projects/Archive",
      item: {
        name: "Archive",
        path: "Projects/Archive",
        type: FileType.DIRECTORY,
        is_readable: true,
        is_hidden: false,
      },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [sourceConnection, targetConnection],
          onNavigateDirectory,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:c");
    });
    act(() => {
      result.current.handleOpenFileForFile(link, 0);
    });

    await waitFor(() => {
      expect(api.resolveLocalActivation).toHaveBeenCalledWith("local-drive:c", "Links/Archive.lnk");
      expect(onNavigateDirectory).toHaveBeenCalledWith("local-drive:d", "Projects/Archive");
    });
  });

  it("opens the resolved local file rather than its link source", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const link = {
      name: "Report.lnk",
      path: "Report.lnk",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "d",
      path: "Reports/quarterly.pdf",
      item: {
        name: "quarterly.pdf",
        path: "Reports/quarterly.pdf",
        type: FileType.FILE,
        mime_type: "application/pdf",
        is_readable: true,
        is_hidden: false,
      },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:c");
    });
    act(() => {
      result.current.handleOpenFileForFile(link, 0);
    });

    await waitFor(() => {
      expect(result.current.viewInfo).toMatchObject({
        connectionId: "local-drive:d",
        path: "Reports/quarterly.pdf",
        mimeType: "application/pdf",
      });
    });
  });

  it("opens a resolved local link target with the native app", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const link = {
      name: "Report.lnk",
      path: "Report.lnk",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "d",
      path: "Reports/quarterly.docx",
      item: {
        name: "quarterly.docx",
        path: "Reports/quarterly.docx",
        type: FileType.FILE,
        is_readable: true,
        is_hidden: false,
      },
    });
    vi.mocked(api.openLocalFile).mockResolvedValue();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:c");
    });
    await act(async () => {
      await result.current.handleOpenInAppForFile(link, 0);
    });

    expect(api.openLocalFile).toHaveBeenCalledWith("local-drive:d", "Reports/quarterly.docx", { forcePicker: false });
  });

  it("shows a link-resolution error without opening the source file", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const link = {
      name: "Missing.lnk",
      path: "Missing.lnk",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    vi.mocked(api.resolveLocalActivation).mockRejectedValue({
      response: { data: { detail: "The link target no longer exists", code: "local_link_target_missing" }, status: 404 },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.connectionId).toBe("local-drive:c");
    });
    act(() => {
      result.current.handleOpenFileForFile(link, 0);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("The link target no longer exists");
    });
    expect(result.current.viewInfo).toBeNull();
    expect(api.openLocalFile).not.toHaveBeenCalled();
  });

  it("ignores a local activation result after navigation supersedes it", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const link = {
      name: "Report.lnk",
      path: "Report.lnk",
      type: FileType.FILE,
      is_readable: true,
      is_hidden: false,
    };
    let resolveActivation!: (value: Awaited<ReturnType<typeof api.resolveLocalActivation>>) => void;
    vi.mocked(api.resolveLocalActivation).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveActivation = resolve;
        })
    );

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("Links");
    });

    act(() => {
      result.current.handleOpenFileForFile(link, 0);
    });
    await waitFor(() => {
      expect(api.resolveLocalActivation).toHaveBeenCalledWith("local-drive:c", "Links/Report.lnk");
    });

    act(() => {
      result.current.applyLocation("local-drive:c", "Elsewhere");
    });
    await act(async () => {
      resolveActivation({
        drive_id: "c",
        path: "Reports/quarterly.pdf",
        item: {
          name: "quarterly.pdf",
          path: "Reports/quarterly.pdf",
          type: FileType.FILE,
          mime_type: "application/pdf",
          is_readable: true,
          is_hidden: false,
        },
      });
    });

    expect(result.current.currentPath).toBe("Elsewhere");
    expect(result.current.viewInfo).toBeNull();
  });

  it("does not record a failed directory navigation after a later reload succeeds", async () => {
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.files).toEqual(mockDirectoryListing.items);
    });

    vi.mocked(api.listDirectory).mockRejectedValueOnce(new Error("Directory unavailable"));

    act(() => {
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    vi.mocked(api.listDirectory).mockResolvedValueOnce(mockNestedDirectory);

    await act(async () => {
      await result.current.loadFiles("Documents", true);
    });

    expect(api.recordRecentDirectory).not.toHaveBeenCalled();
  });

  it("resets the file list scroll position when navigating into a fresh child directory", async () => {
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    const scrollContainer = document.createElement("div");
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 120,
      writable: true,
      configurable: true,
    });

    act(() => {
      (result.current.parentRef as { current: HTMLDivElement | null }).current = scrollContainer as HTMLDivElement;
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("conn-1");
      expect(result.current.files.length).toBeGreaterThan(0);
    });

    act(() => {
      scrollContainer.scrollTop = 120;
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  it("falls back to the first item when saved directory history targets a missing file", async () => {
    const scrollContainer = document.createElement("div");
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 120,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      (result.current.parentRef as { current: HTMLDivElement | null }).current = scrollContainer as HTMLDivElement;
      result.current.restoreRecoverySnapshot({
        connectionId: "conn-1",
        path: "Documents",
        items: mockNestedDirectory.items,
        sortBy: "name",
        sortDirection: "asc",
        viewMode: "list",
        focusedIndex: 0,
        focusedFileName: "Missing Folder",
        selectedFileNames: [],
        viewInfo: null,
        scrollOffset: 120,
      });
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("conn-1");
      expect(result.current.currentPath).toBe("Documents");
      expect(result.current.focusedIndex).toBe(0);
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  it("opens a child directory fresh instead of restoring stale per-directory history from a previous visit", async () => {
    const documentsDirectory = mockDirectoryListing.items.find((item) => item.type === "directory" && item.name === "Documents");

    expect(documentsDirectory).toBeDefined();

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    const scrollContainer = document.createElement("div");
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });

    act(() => {
      (result.current.parentRef as { current: HTMLDivElement | null }).current = scrollContainer as HTMLDivElement;
      result.current.restoreRecoverySnapshot({
        connectionId: "conn-1",
        path: "Documents",
        items: mockNestedDirectory.items,
        sortBy: "name",
        sortDirection: "asc",
        viewMode: "list",
        focusedIndex: 2,
        focusedFileName: "report.pdf",
        selectedFileNames: [],
        viewInfo: null,
        scrollOffset: 120,
      });
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
      expect(result.current.focusedIndex).toBe(2);
      expect(scrollContainer.scrollTop).toBe(120);
    });

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("");
      expect(result.current.files.length).toBeGreaterThan(0);
    });

    act(() => {
      scrollContainer.scrollTop = 55;
      result.current.handleFileClick(documentsDirectory!);
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
      expect(result.current.focusedIndex).toBe(0);
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  it("falls back to the first parent item when navigating up and the previous child row no longer exists", async () => {
    const scrollContainer = document.createElement("div");
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 77,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      (result.current.parentRef as { current: HTMLDivElement | null }).current = scrollContainer as HTMLDivElement;
      result.current.restoreRecoverySnapshot({
        connectionId: "conn-1",
        path: "Documents/Ghost",
        items: mockEmptyDirectory.items,
        sortBy: "name",
        sortDirection: "asc",
        viewMode: "list",
        focusedIndex: 0,
        focusedFileName: null,
        selectedFileNames: [],
        viewInfo: null,
        scrollOffset: 77,
      });
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents/Ghost");
      expect(result.current.focusedIndex).toBe(0);
    });

    act(() => {
      scrollContainer.scrollTop = 77;
      result.current.handleNavigateUpDirectory();
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("Documents");
      expect(result.current.focusedIndex).toBe(0);
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  it("removes a local recent record only when Companion confirms its target is missing", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    vi.mocked(api.resolveLocalActivation).mockRejectedValue({
      response: { data: { code: "local_link_target_missing" }, status: 404 },
    });
    vi.mocked(api.removeRecentFile).mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleOpenFileAtPath("local-drive:c", "Documents/deleted.txt", "associated-viewer", "recent-1");
    });

    expect(api.removeRecentFile).toHaveBeenCalledWith("recent-1");
    expect(result.current.error).toBe("The recent file no longer exists.");
  });

  it("preserves a local recent record when Companion is unavailable", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    vi.mocked(api.resolveLocalActivation).mockRejectedValue({
      response: { data: { detail: "Unknown drive" }, status: 404 },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleOpenFileAtPath("local-drive:c", "Documents/report.txt", "associated-viewer", "recent-1");
    });

    expect(api.removeRecentFile).not.toHaveBeenCalled();
    expect(result.current.error).toBe("The recent file could not be opened.");
  });

  it.each([
    ["recent_file_native_launch_failed", "Failed to launch the native application."],
    ["recent_file_target_not_file", "Not a file: Documents/report.txt"],
  ])("removes a local recent record after a classified %s native-open failure", async (code, detail) => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "c",
      path: "Documents/report.txt",
      item: {
        name: "report.txt",
        path: "Documents/report.txt",
        type: FileType.FILE,
        mime_type: "text/plain",
        size: 100,
        is_readable: true,
        is_hidden: false,
      },
    });
    vi.mocked(api.openLocalFile).mockRejectedValue({ response: { data: { code, detail }, status: 500 } });
    vi.mocked(api.removeRecentFile).mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleOpenFileAtPath("local-drive:c", "Documents/report.txt", "associated-native-app", "recent-1");
    });

    await waitFor(() => {
      expect(api.removeRecentFile).toHaveBeenCalledWith("recent-1");
      expect(result.current.error).toBe(detail);
    });
  });

  it("opens a local recent shortcut at its resolved file target", async () => {
    const sourceConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "d",
      path: "Reports/quarterly.pdf",
      item: {
        name: "quarterly.pdf",
        path: "Reports/quarterly.pdf",
        type: FileType.FILE,
        mime_type: "application/pdf",
        is_readable: true,
        is_hidden: false,
      },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [sourceConnection],
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleOpenFileAtPath("local-drive:c", "Links/Report.lnk", "associated-viewer", "recent-1");
    });

    expect(api.resolveLocalActivation).toHaveBeenCalledWith("local-drive:c", "Links/Report.lnk");
    expect(result.current.viewInfo).toMatchObject({
      connectionId: "local-drive:d",
      path: "Reports/quarterly.pdf",
      mimeType: "application/pdf",
    });
  });

  it("navigates to a directory resolved from a local recent shortcut", async () => {
    const sourceConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    const onNavigateDirectory = vi.fn();
    vi.mocked(api.resolveLocalActivation).mockResolvedValue({
      drive_id: "d",
      path: "Projects/Archive",
      item: {
        name: "Archive",
        path: "Projects/Archive",
        type: FileType.DIRECTORY,
        is_readable: true,
        is_hidden: false,
      },
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [sourceConnection],
          onNavigateDirectory,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleOpenFileAtPath("local-drive:c", "Links/Archive.lnk", "associated-viewer", "recent-1");
    });

    expect(onNavigateDirectory).toHaveBeenCalledWith("local-drive:d", "Projects/Archive");
  });

  it("ignores a recent local activation result after navigation supersedes it", async () => {
    const localConnection = { ...mockConnections[0], id: "local-drive:c", slug: "c", type: "local" };
    let resolveActivation!: (value: Awaited<ReturnType<typeof api.resolveLocalActivation>>) => void;
    vi.mocked(api.resolveLocalActivation).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveActivation = resolve;
        })
    );

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: [localConnection],
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("local-drive:c", "Links");
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("Links");
    });

    let activation: Promise<void>;
    act(() => {
      activation = result.current.handleOpenFileAtPath("local-drive:c", "Links/Archive.lnk", "associated-viewer", "recent-1");
    });
    await waitFor(() => {
      expect(api.resolveLocalActivation).toHaveBeenCalledWith("local-drive:c", "Links/Archive.lnk");
    });

    act(() => {
      result.current.applyLocation("local-drive:c", "Elsewhere");
    });
    await act(async () => {
      resolveActivation({
        drive_id: "c",
        path: "Projects/Archive",
        item: {
          name: "Archive",
          path: "Projects/Archive",
          type: FileType.DIRECTORY,
          is_readable: true,
          is_hidden: false,
        },
      });
      await activation;
    });

    expect(result.current.currentPath).toBe("Elsewhere");
  });

  it("opens an image recent outside the active pane without reusing its gallery", async () => {
    const viewerConnections = [mockConnections[0], { ...mockConnections[0], id: "conn-2", name: "Archive", slug: "archive" }];
    vi.mocked(api.validateRecentFileTarget).mockResolvedValue({
      name: "outside.png",
      path: "outside.png",
      type: FileType.FILE,
      mime_type: "image/png",
      size: 100,
      is_readable: true,
      is_hidden: false,
    });

    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: viewerConnections,
        }),
      { wrapper }
    );

    act(() => {
      result.current.applyLocation("conn-1", "");
    });

    await waitFor(() => {
      expect(result.current.connectionId).toBe("conn-1");
    });

    await act(async () => {
      await result.current.handleOpenFileAtPath("conn-2", "outside.png", "associated-viewer", "recent-2");
    });

    expect(result.current.viewInfo).toMatchObject({ path: "outside.png", connectionId: "conn-2" });
    expect(result.current.viewInfo?.images).toBeUndefined();
  });

  it("records each newly displayed gallery image once", async () => {
    const { result } = renderHook(
      () =>
        useFileBrowserPane({
          rowHeight: 40,
          connections: mockConnections,
        }),
      { wrapper }
    );

    act(() => {
      result.current.setViewInfo({
        connectionId: "conn-1",
        path: "first.jpg",
        mimeType: "image/jpeg",
        viewerId: "image",
        images: ["first.jpg", "second.jpg"],
        currentIndex: 0,
        sessionId: "gallery-session",
      });
    });
    act(() => {
      result.current.handleViewIndexChange(0);
      result.current.handleViewIndexChange(1);
      result.current.handleViewIndexChange(1);
    });

    await waitFor(() => {
      expect(api.recordRecentFile).toHaveBeenCalledTimes(2);
      expect(api.recordRecentFile).toHaveBeenNthCalledWith(1, "conn-1", "first.jpg");
      expect(api.recordRecentFile).toHaveBeenNthCalledWith(2, "conn-1", "second.jpg");
    });
  });
});
