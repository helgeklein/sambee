import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n";
import { type LeftoverInfo, RecoveryDialog } from "../RecoveryDialog";

const LEFTOVERS: LeftoverInfo[] = [
  {
    operation_dir: "operation-1",
    filename: "Quarterly Budget.xlsx",
    server_url: "https://sambee.example.test",
    remote_path: "/Finance/Quarterly Budget.xlsx",
    connection_id: "connection-1",
    local_modified: "today at 12:16",
  },
];

describe("RecoveryDialog", () => {
  it("shows an explicit retry state after recovery upload refreshes authentication", async () => {
    render(
      <RecoveryDialog
        leftovers={LEFTOVERS}
        onDone={() => {}}
        onUploadAction={async () => {
          return { status: "auth_retry", reason: "upload" };
        }}
      />
    );

    fireEvent.click(screen.getByText(translate("recovery.actions.upload")));

    await waitFor(() => {
      expect(screen.getByText(translate("recovery.authRefreshedRetryUpload"))).toBeInTheDocument();
    });

    expect(screen.getByText(translate("recovery.actions.retryUpload"))).toBeInTheDocument();
  });

  it("reopens Sambee from a blocked lifecycle recovery state", async () => {
    const onBlockedLifecycleAction = vi.fn(async () => {});

    render(
      <RecoveryDialog
        leftovers={LEFTOVERS}
        onDone={() => {}}
        onUploadAction={async () => {
          return { status: "recovery_required", message: "Recovery session expired during upload." };
        }}
        onBlockedLifecycleAction={onBlockedLifecycleAction}
      />
    );

    fireEvent.click(screen.getByText(translate("recovery.actions.upload")));

    await waitFor(() => {
      expect(screen.getByText(translate("doneEditing.buttons.recoveryRequired"))).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(translate("doneEditing.buttons.recoveryRequired")));

    await waitFor(() => {
      expect(onBlockedLifecycleAction).toHaveBeenCalledWith("recovery_required", "https://sambee.example.test");
    });
  });
});
