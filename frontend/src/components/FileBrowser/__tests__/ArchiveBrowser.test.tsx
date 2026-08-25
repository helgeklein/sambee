import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import api from "../../../services/api";
import { type ArchiveOperation, FileType } from "../../../types";
import { ArchiveBrowser } from "../ArchiveBrowser";

const translate = (key: string) => key;

function createArchiveOperation(overrides: Partial<ArchiveOperation> = {}): ArchiveOperation {
  return {
    id: "operation-id",
    kind: "extract",
    phase: "completed",
    source_connection_id: "smb-connection",
    source_path: "archive.zip",
    destination_connection_id: "smb-connection",
    destination_path: "archive",
    manifest_hash: "",
    checkpoint_json: "{}",
    cancellation_requested: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    heartbeat_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

vi.mock("../../../services/api");
vi.mock("../../../pages/FileBrowser/formatters", () => ({
  formatFileSize: (bytes?: number) => (bytes === undefined ? "" : "1.0 KB"),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

describe("ArchiveBrowser", () => {
  it("navigates into synthetic directories that have no readable member payload", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArchiveDirectory).mockImplementation((_connectionId, _archivePath, virtualPath) =>
      Promise.resolve(
        virtualPath === "nested"
          ? {
              archive: { path: "archive.zip", size: 1024 },
              path: "nested",
              items: [],
              total: 0,
              next_cursor: null,
              page_size: 100,
            }
          : {
              archive: { path: "archive.zip", size: 1024 },
              path: "",
              items: [
                {
                  name: "nested",
                  path: "nested",
                  type: FileType.DIRECTORY,
                  state: "unavailable",
                  is_hidden: false,
                },
                {
                  name: "readme.txt",
                  path: "readme.txt",
                  type: FileType.FILE,
                  size: 1024,
                  state: "readable",
                  is_hidden: false,
                },
              ],
              total: 1,
              next_cursor: null,
              page_size: 100,
            }
      )
    );

    render(<ArchiveBrowser connectionId="local-drive:c" archivePath="archive.zip" onClose={vi.fn()} />);

    const directory = await screen.findByRole("button", { name: /nested/i });
    expect(directory).toBeEnabled();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    await user.click(directory);

    await waitFor(() => {
      expect(api.listArchiveDirectory).toHaveBeenLastCalledWith("local-drive:c", "archive.zip", "nested", {
        cursor: undefined,
        pageSize: 100,
        signal: expect.any(AbortSignal),
      });
    });

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.root" }));
    await waitFor(() => {
      expect(api.listArchiveDirectory).toHaveBeenLastCalledWith("local-drive:c", "archive.zip", "", {
        cursor: undefined,
        pageSize: 100,
        signal: expect.any(AbortSignal),
      });
    });

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.historyBack" }));
    await waitFor(() => {
      expect(api.listArchiveDirectory).toHaveBeenLastCalledWith("local-drive:c", "archive.zip", "nested", {
        cursor: undefined,
        pageSize: 100,
        signal: expect.any(AbortSignal),
      });
    });

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.historyForward" }));
    await waitFor(() => {
      expect(api.listArchiveDirectory).toHaveBeenLastCalledWith("local-drive:c", "archive.zip", "", {
        cursor: undefined,
        pageSize: 100,
        signal: expect.any(AbortSignal),
      });
    });
  });

  it("extracts local archives through Companion instead of the SMB operation API", async () => {
    const user = userEvent.setup();
    const onExtracted = vi.fn();
    vi.mocked(api.listArchiveDirectory).mockResolvedValue({
      archive: { path: "archive.zip", size: 1024 },
      path: "",
      items: [],
      total: 0,
      next_cursor: null,
      page_size: 100,
    });
    vi.mocked(api.extractLocalArchive).mockResolvedValue({
      files_extracted: 1,
      directories_created: 1,
      extracted_bytes: 10,
      files_skipped: 2,
    });

    render(<ArchiveBrowser connectionId="local-drive:c" archivePath="archive.zip" onClose={vi.fn()} onExtracted={onExtracted} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    expect(screen.getByLabelText("fileBrowser.archive.destinationLabel")).toHaveValue("archive");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    await waitFor(() => {
      expect(api.extractLocalArchive).toHaveBeenCalledWith("local-drive:c", "archive.zip", "archive");
    });
    expect(api.prepareArchiveOperation).not.toHaveBeenCalled();
    expect(onExtracted).toHaveBeenCalledWith("local-drive:c", "archive.zip");
    expect(screen.getByText("fileBrowser.archive.extractPartialSuccess")).toBeInTheDocument();
  });

  it("keeps the local extraction dialog open with an actionable error when the destination exists", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArchiveDirectory).mockResolvedValue({
      archive: { path: "archive.zip", size: 1024 },
      path: "",
      items: [],
      total: 0,
      next_cursor: null,
      page_size: 100,
    });
    vi.mocked(api.extractLocalArchive).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
    });

    render(<ArchiveBrowser connectionId="local-drive:c" archivePath="archive.zip" onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(await screen.findByText("fileBrowser.archive.validationDestinationExists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("warns that a local extraction may have left incomplete output", async () => {
    const user = userEvent.setup();
    const onExtracted = vi.fn();
    vi.mocked(api.listArchiveDirectory).mockResolvedValue({
      archive: { path: "archive.zip", size: 1024 },
      path: "",
      items: [],
      total: 0,
      next_cursor: null,
      page_size: 100,
    });
    vi.mocked(api.extractLocalArchive).mockRejectedValue({
      isAxiosError: true,
      response: { data: { code: "local_archive_extraction_partial" }, status: 500 },
    });

    render(<ArchiveBrowser connectionId="local-drive:c" archivePath="archive.zip" onClose={vi.fn()} onExtracted={onExtracted} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(await screen.findByText("fileBrowser.archive.extractPartialOutputError")).toBeInTheDocument();
    expect(onExtracted).toHaveBeenCalledWith("local-drive:c", "archive.zip");
  });

  it("reports skipped members after a completed SMB extraction", async () => {
    const user = userEvent.setup();
    const operation = createArchiveOperation({
      checkpoint_json: '{"files_skipped":2}',
    });
    vi.mocked(api.listArchiveDirectory).mockResolvedValue({
      archive: { path: "archive.zip", size: 1024 },
      path: "",
      items: [],
      total: 0,
      next_cursor: null,
      page_size: 100,
    });
    vi.mocked(api.prepareArchiveOperation).mockResolvedValue(operation);
    vi.mocked(api.executeArchiveExtraction).mockResolvedValue(operation);

    render(<ArchiveBrowser connectionId="smb-connection" archivePath="archive.zip" onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));

    expect(await screen.findByText("fileBrowser.archive.extractPartialSuccess")).toBeInTheDocument();
  });

  it("requests cancellation for an in-progress SMB extraction", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArchiveDirectory).mockResolvedValue({
      archive: { path: "archive.zip", size: 1024 },
      path: "",
      items: [],
      total: 0,
      next_cursor: null,
      page_size: 100,
    });
    vi.mocked(api.prepareArchiveOperation).mockResolvedValue(createArchiveOperation({ phase: "prepared" }));
    vi.mocked(api.executeArchiveExtraction).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(api.cancelArchiveOperation).mockResolvedValue(createArchiveOperation({ phase: "streaming", cancellation_requested: true }));

    render(<ArchiveBrowser connectionId="smb-connection" archivePath="archive.zip" onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "fileBrowser.archive.buttonExtract" }));
    const cancelButton = await screen.findByRole("button", { name: "fileBrowser.archive.buttonCancelExtraction" });
    await user.click(cancelButton);

    expect(api.cancelArchiveOperation).toHaveBeenCalledWith("operation-id");
    expect(cancelButton).toBeDisabled();
  });
});
