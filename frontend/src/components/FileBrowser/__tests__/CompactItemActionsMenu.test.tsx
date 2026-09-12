import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactItemActionsMenu } from "../CompactItemActionsMenu";

describe("CompactItemActionsMenu", () => {
  it("preserves descriptor order and exposes unavailable reasons", () => {
    const onClose = vi.fn();
    render(
      <CompactItemActionsMenu
        actions={[
          { id: "rename", label: "Rename", onClick: vi.fn() },
          { id: "delete", label: "Delete", tooltip: "Delete (Del): This location is read-only.", enabled: false, onClick: vi.fn() },
          { id: "extract-archive", label: "Extract archive", onClick: vi.fn() },
        ]}
        anchorPosition={{ top: 32, left: 64 }}
        onClose={onClose}
      />
    );

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Delete", "Extract archive"]);
    const deleteAction = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteAction).toHaveAttribute("aria-disabled", "true");
    expect(deleteAction).toHaveAttribute("aria-description", "Delete (Del): This location is read-only.");
  });
});
