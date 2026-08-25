import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import api from "../../../services/api";
import type { ArchiveOperation } from "../../../types";
import { ArchiveOperationsDialog } from "../ArchiveOperationsDialog";

vi.mock("../../../services/api");
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

function createArchiveOperation(overrides: Partial<ArchiveOperation> = {}): ArchiveOperation {
  return {
    id: "operation-id",
    kind: "extract",
    phase: "streaming",
    source_connection_id: "connection-id",
    source_path: "archive.zip",
    destination_connection_id: "connection-id",
    destination_path: "output",
    manifest_hash: "",
    checkpoint_json: "{}",
    cancellation_requested: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    heartbeat_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArchiveOperationsDialog", () => {
  it("loads and shows durable archive operations", async () => {
    vi.mocked(api.listArchiveOperations).mockResolvedValue([createArchiveOperation()]);

    render(<ArchiveOperationsDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("fileBrowser.archive.operationKinds.extract")).toBeInTheDocument();
    expect(screen.getByText("fileBrowser.archive.operationPhases.streaming")).toBeInTheDocument();
    expect(screen.getByText(/- output/)).toBeInTheDocument();
    expect(api.listArchiveOperations).toHaveBeenCalledOnce();
  });

  it("requests cancellation and reloads the operation list", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArchiveOperations).mockResolvedValue([createArchiveOperation()]);
    vi.mocked(api.cancelArchiveOperation).mockResolvedValue(createArchiveOperation({ cancellation_requested: true }));

    render(<ArchiveOperationsDialog open onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "fileBrowser.archive.operationCancel" }));

    await waitFor(() => expect(api.cancelArchiveOperation).toHaveBeenCalledWith("operation-id"));
    await waitFor(() => expect(api.listArchiveOperations.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
