import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import api from "../../services/api";
import { clearCurrentUserSettingsCache } from "../../services/userSettingsSync";
import { type ApiMock, setupSuccessfulApiMocks } from "../../test/helpers";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { useFileBrowserPane } from "../FileBrowser/useFileBrowserPane";
import { mockConnections, mockDirectoryListing } from "./FileBrowser.test.utils";

vi.mock("../../services/api");

describe("useFileBrowserPane", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <SambeeThemeProvider>{children}</SambeeThemeProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserSettingsCache();
    localStorage.setItem("access_token", "fake-token");
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
      result.current.setCurrentDirectoryFilter("read");
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
      expect(restoredResult.current.currentDirectoryFilter).toBe("read");
      expect(restoredResult.current.selectedFiles.size).toBe(mockDirectoryListing.items.length);
      expect(restoredResult.current.viewInfo?.path).toBe("readme.txt");
    });
  });
});
