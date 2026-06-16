import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n";
import { ConflictDialog, type ConflictInfo } from "../ConflictDialog";

const CONFLICT: ConflictInfo = {
  operation_id: "conflict-operation-1",
  filename: "Quarterly Budget.xlsx",
  download_modified: "2026-04-24 12:14:03",
  server_modified: "2026-04-24 12:21:47",
  server_url: "https://sambee.example.test",
};

describe("ConflictDialog", () => {
  it("reopens Sambee from a blocked lifecycle conflict state", async () => {
    const onBlockedLifecycleAction = vi.fn(async () => {});

    render(
      <ConflictDialog
        conflict={CONFLICT}
        onResolved={() => {}}
        onOverwriteAction={async () => {
          return { status: "auth_failed", message: "Conflict session authorization failed." };
        }}
        onBlockedLifecycleAction={onBlockedLifecycleAction}
      />
    );

    fireEvent.click(screen.getByText(translate("conflictDialog.actions.overwrite")));

    await waitFor(() => {
      expect(screen.getByText(translate("doneEditing.buttons.authFailed"))).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(translate("doneEditing.buttons.authFailed")));

    await waitFor(() => {
      expect(onBlockedLifecycleAction).toHaveBeenCalledWith("auth_failed", "https://sambee.example.test");
    });
  });
});
