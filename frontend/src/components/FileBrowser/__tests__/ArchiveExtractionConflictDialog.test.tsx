import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchiveExtractionConflictDialog } from "../ArchiveExtractionConflictDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("ArchiveExtractionConflictDialog", () => {
  it("lists conflicting members and dispatches the safe all-files choice", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ArchiveExtractionConflictDialog
        open={true}
        conflicts={[{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }]}
        allowedActions={["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"]}
        isSubmitting={false}
        error={null}
        onDecision={onDecision}
      />
    );

    expect(screen.getByText("docs/readme.txt")).toBeInTheDocument();
    expect(screen.getByText("output/docs/readme.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonSkipAll" }));

    expect(onDecision).toHaveBeenCalledWith("skip_all");
  });

  it("dispatches the replace-only-older-files policy", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ArchiveExtractionConflictDialog
        open={true}
        conflicts={[{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }]}
        allowedActions={["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"]}
        isSubmitting={false}
        error={null}
        onDecision={onDecision}
      />
    );

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonReplaceOlder" }));

    expect(onDecision).toHaveBeenCalledWith("replace_older");
  });

  it("suggests and dispatches a per-member rename target", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ArchiveExtractionConflictDialog
        open={true}
        conflicts={[{ member_path: "docs/readme.txt", target_path: "output/docs/readme.txt" }]}
        allowedActions={["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"]}
        isSubmitting={false}
        error={null}
        onDecision={onDecision}
      />
    );

    await user.click(screen.getByRole("button", { name: "fileBrowser.archive.buttonRename" }));
    expect(screen.getByLabelText("fileBrowser.archive.renameTargetLabel")).toHaveValue("docs/readme (copy).txt");
    await user.click(screen.getAllByRole("button", { name: "fileBrowser.archive.buttonRename" })[1]!);

    expect(onDecision).toHaveBeenCalledWith("rename", "docs/readme.txt", "docs/readme (copy).txt");
  });

  it("limits directory collisions to rename or cancel", () => {
    render(
      <ArchiveExtractionConflictDialog
        open={true}
        conflicts={[{ member_path: "docs", target_path: "output/docs", is_directory: true }]}
        allowedActions={["rename"]}
        isSubmitting={false}
        error={null}
        onDecision={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "fileBrowser.archive.buttonRename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "fileBrowser.archive.buttonSkipAll" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "fileBrowser.archive.buttonReplaceAll" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "fileBrowser.archive.buttonReplaceOlder" })).not.toBeInTheDocument();
  });
});
