import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import api from "../../../../services/api";
import { SambeeThemeProvider } from "../../../../theme/ThemeContext";
import { type FileEntry, FileType } from "../../../../types";
import { useFileSearchProvider } from "../useFileSearchProvider";

vi.mock("../../../../services/api");

const files = [
  { name: "annual-report.txt", type: FileType.FILE },
  { name: "report.txt", type: FileType.FILE },
  { name: "summary.txt", type: FileType.FILE },
] as FileEntry[];

function wrapper({ children }: { children: React.ReactNode }) {
  return <SambeeThemeProvider>{children}</SambeeThemeProvider>;
}

describe("useFileSearchProvider", () => {
  it("keeps recent files first, omits duplicate current items, and preserves selection mode", async () => {
    const onOpenCurrentFile = vi.fn();
    const onOpenRecentFile = vi.fn();
    vi.mocked(api.searchRecentFiles).mockResolvedValue({
      result_limit: 1,
      results: [
        {
          id: "recent-report",
          connection_id: "connection-1",
          path: "Reports/report.txt",
          file_name: "report.txt",
          last_opened_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useFileSearchProvider({
          connectionId: "connection-1",
          currentPath: "Reports",
          files,
          connectionName: "Reports server",
          resultLimit: 10,
          getConnectionName: () => "Reports server",
          onOpenCurrentFile,
          onOpenRecentFile,
        }),
      { wrapper }
    );

    const results = await result.current.fetchResults("report", new AbortController().signal);

    expect(results.map((entry) => ({ kind: entry.kind, value: entry.value }))).toEqual([
      { kind: "group-header", value: "" },
      { kind: "result", value: "recent:recent-report" },
      { kind: "group-header", value: "" },
      { kind: "result", value: "current:annual-report.txt" },
    ]);

    expect(results).toMatchObject([
      { kind: "group-header" },
      {
        kind: "result",
        icon: "recent-file",
        primaryText: "report.txt",
        primaryHighlight: { start: 0, end: 6 },
        secondaryText: "Reports server:/Reports",
      },
      { kind: "group-header" },
      {
        kind: "result",
        icon: "file",
        primaryText: "annual-report.txt",
        primaryHighlight: { start: 7, end: 13 },
        secondaryText: "Reports server:/Reports",
      },
    ]);

    result.current.onSelect("recent:recent-report", "associated-native-app");
    expect(onOpenRecentFile).toHaveBeenCalledWith(expect.objectContaining({ id: "recent-report" }), "associated-native-app");

    result.current.onSelect("current:annual-report.txt", "force-native-picker");
    expect(onOpenCurrentFile).toHaveBeenCalledWith(expect.objectContaining({ name: "annual-report.txt" }), "force-native-picker");

    await expect(result.current.onRemoveSelected?.("recent:recent-report")).resolves.toBe(true);
    expect(api.removeRecentFile).toHaveBeenCalledWith("recent-report");
    await expect(result.current.onRemoveSelected?.("current:annual-report.txt")).resolves.toBe(false);

    render(
      result.current.getFooterHint?.({
        kind: "result",
        id: "recent-report",
        value: "recent:recent-report",
        icon: "recent-file",
        primaryText: "report.txt",
      })
    );

    expect(screen.getByText("Enter")).toBeInTheDocument();
    expect(screen.getByText("Shift+Enter")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+Enter")).toBeInTheDocument();
    expect(screen.getByText("Shift+Del")).toBeInTheDocument();
    expect(screen.queryByText("Shift+Delete")).not.toBeInTheDocument();
  });
});
