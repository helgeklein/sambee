import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { translate } from "../../i18n";
import { type LargeFileInfo, LargeFileWarning } from "../LargeFileWarning";

const INFO: LargeFileInfo = {
  confirm_id: "confirm-1",
  filename: "Raw Drone Footage.mov",
  size_mb: 842,
  limit_mb: 250,
};

describe("LargeFileWarning", () => {
  it("renders the tauri error message when responding fails", async () => {
    render(
      <LargeFileWarning
        info={INFO}
        onResolved={() => {}}
        onRespondAction={async () => {
          throw new Error("Failed to send confirmation");
        }}
      />
    );

    fireEvent.click(screen.getByText(translate("largeFileWarning.actions.continue")));

    await waitFor(() => {
      expect(screen.getByText("Failed to send confirmation")).toBeInTheDocument();
    });
  });
});
