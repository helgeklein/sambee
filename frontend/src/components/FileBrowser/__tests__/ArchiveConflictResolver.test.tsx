import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchiveConflictResolver } from "../ArchiveConflictResolver";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const conflict = { memberPath: "docs/readme.txt", targetPath: "output/docs/readme.txt" };
const allActions = ["skip", "skip_all", "replace", "replace_all", "replace_older", "rename"] as const;

describe("ArchiveConflictResolver", () => {
  it("defaults to the safe per-member skip action", async () => {
    const onResolutionChange = vi.fn();
    render(
      <ArchiveConflictResolver
        conflict={conflict}
        allowedActions={[...allActions]}
        isSubmitting={false}
        error={null}
        onResolutionChange={onResolutionChange}
      />
    );

    await waitFor(() => expect(onResolutionChange).toHaveBeenLastCalledWith({ action: "skip", memberPath: conflict.memberPath }));
    expect(screen.getByRole("radio", { name: "fileBrowser.archive.collisionChoiceSkip" })).toBeChecked();
  });

  it("maps an apply-to-remaining skip choice to skip_all", async () => {
    const user = userEvent.setup();
    const onResolutionChange = vi.fn();
    render(
      <ArchiveConflictResolver
        conflict={conflict}
        allowedActions={[...allActions]}
        isSubmitting={false}
        error={null}
        onResolutionChange={onResolutionChange}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "fileBrowser.archive.collisionApplyRemaining" }));

    await waitFor(() => expect(onResolutionChange).toHaveBeenLastCalledWith({ action: "skip_all", memberPath: conflict.memberPath }));
  });

  it("maps an apply-to-remaining replace choice to replace_all", async () => {
    const user = userEvent.setup();
    const onResolutionChange = vi.fn();
    render(
      <ArchiveConflictResolver
        conflict={conflict}
        allowedActions={[...allActions]}
        isSubmitting={false}
        error={null}
        onResolutionChange={onResolutionChange}
      />
    );

    await user.click(screen.getByRole("radio", { name: "fileBrowser.archive.collisionChoiceReplace" }));
    await user.click(screen.getByRole("checkbox", { name: "fileBrowser.archive.collisionApplyRemaining" }));

    await waitFor(() => expect(onResolutionChange).toHaveBeenLastCalledWith({ action: "replace_all", memberPath: conflict.memberPath }));
  });

  it("supports the replace-older action", async () => {
    const user = userEvent.setup();
    const onResolutionChange = vi.fn();
    render(
      <ArchiveConflictResolver
        conflict={conflict}
        allowedActions={[...allActions]}
        isSubmitting={false}
        error={null}
        onResolutionChange={onResolutionChange}
      />
    );

    await user.click(screen.getByRole("radio", { name: "fileBrowser.archive.collisionChoiceReplaceOlder" }));

    await waitFor(() => expect(onResolutionChange).toHaveBeenLastCalledWith({ action: "replace_older", memberPath: conflict.memberPath }));
  });

  it("limits directory collisions to a rename action", () => {
    render(
      <ArchiveConflictResolver
        conflict={{ memberPath: "docs", targetPath: "output/docs", isDirectory: true }}
        allowedActions={["rename"]}
        isSubmitting={false}
        error={null}
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByRole("radio", { name: "fileBrowser.archive.collisionChoiceRename" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "fileBrowser.archive.collisionChoiceSkip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "fileBrowser.archive.collisionChoiceReplace" })).not.toBeInTheDocument();
  });

  it("focuses the static conflict summary for a directory collision", async () => {
    render(
      <ArchiveConflictResolver
        conflict={{ memberPath: "docs", targetPath: "output/docs", isDirectory: true }}
        allowedActions={["rename"]}
        isSubmitting={false}
        error={null}
        onResolutionChange={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByTestId("archive-conflict-summary")).toHaveFocus());
  });

  it("does not emit an unsafe rename target", async () => {
    const user = userEvent.setup();
    const onResolutionChange = vi.fn();
    render(
      <ArchiveConflictResolver
        conflict={conflict}
        allowedActions={["rename"]}
        isSubmitting={false}
        error={null}
        onResolutionChange={onResolutionChange}
      />
    );

    await user.clear(screen.getByLabelText("fileBrowser.archive.renameTargetLabel"));
    await user.type(screen.getByLabelText("fileBrowser.archive.renameTargetLabel"), "../outside.txt");

    await waitFor(() => expect(onResolutionChange).toHaveBeenLastCalledWith(null));
    expect(screen.getByText("fileBrowser.archive.validationDestinationUnsafe")).toBeInTheDocument();
  });
});
