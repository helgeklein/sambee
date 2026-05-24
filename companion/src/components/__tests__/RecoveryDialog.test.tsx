import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

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
          throw new Error("retry-auth:upload");
        }}
      />
    );

    fireEvent.click(screen.getByText(translate("recovery.actions.upload")));

    await waitFor(() => {
      expect(screen.getByText(translate("recovery.authRefreshedRetryUpload"))).toBeInTheDocument();
    });

    expect(screen.getByText(translate("recovery.actions.retryUpload"))).toBeInTheDocument();
  });
});
