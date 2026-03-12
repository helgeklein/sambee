import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { COMPANION_PAIRING_DIALOG_COPY } from "../../Settings/localDrivesCopy";
import CompanionPairingDialog from "../CompanionPairingDialog";

describe("CompanionPairingDialog", () => {
  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("starts pairing when %s is pressed on the focused start button", async (_label, key) => {
    const onInitiate = vi.fn().mockResolvedValue({ pairingId: "pair-1", pairingCode: "ABC123" });

    render(
      <CompanionPairingDialog open={true} onClose={vi.fn()} onInitiate={onInitiate} onConfirm={vi.fn().mockResolvedValue(undefined)} />
    );

    const startButton = screen.getByRole("button", { name: COMPANION_PAIRING_DIALOG_COPY.startButton });
    startButton.focus();

    fireEvent.keyDown(startButton, { key });

    await waitFor(() => {
      expect(onInitiate).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("confirms pairing when %s is pressed on the focused confirm button", async (_label, key) => {
    const user = userEvent.setup();
    const onInitiate = vi.fn().mockResolvedValue({ pairingId: "pair-1", pairingCode: "ABC123" });
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(<CompanionPairingDialog open={true} onClose={vi.fn()} onInitiate={onInitiate} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: COMPANION_PAIRING_DIALOG_COPY.startButton }));

    const confirmButton = await screen.findByRole("button", { name: COMPANION_PAIRING_DIALOG_COPY.confirmButton });
    confirmButton.focus();

    fireEvent.keyDown(confirmButton, { key });

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith("pair-1");
    });
  });
});
