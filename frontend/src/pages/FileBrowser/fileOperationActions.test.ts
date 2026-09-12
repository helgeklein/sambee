import { describe, expect, it, vi } from "vitest";
import { createFileOperationActions, type FileOperationActionId } from "./fileOperationActions";

const actionIds: FileOperationActionId[] = [
  "new-directory",
  "new-file",
  "rename",
  "delete",
  "copy",
  "move",
  "create-archive",
  "extract-archive",
  "refresh",
];

function createContext(hasTwoPanes: boolean) {
  return {
    hasTwoPanes,
    availability: Object.fromEntries(actionIds.map((id) => [id, { available: id !== "delete", reason: "blocked" }])) as Record<
      FileOperationActionId,
      { available: boolean; reason: string }
    >,
    labels: Object.fromEntries(actionIds.map((id) => [id, id])) as Record<FileOperationActionId, string>,
    shortcuts: Object.fromEntries(actionIds.map((id) => [id, "F1"])) as Record<FileOperationActionId, string>,
    unavailableReasons: { delete: "Select an item to delete." },
    handlers: Object.fromEntries(actionIds.map((id) => [id, vi.fn()])) as Record<FileOperationActionId, () => void>,
  };
}

describe("createFileOperationActions", () => {
  it("keeps actions in priority order and omits transfers in single-pane mode", () => {
    const actions = createFileOperationActions(createContext(false));

    expect(actions.map((action) => action.id)).toEqual([
      "new-directory",
      "new-file",
      "rename",
      "delete",
      "create-archive",
      "extract-archive",
      "refresh",
    ]);
    expect(actions.map((action) => action.priority)).toEqual([1, 2, 3, 4, 7, 8, 9]);
    expect(actions[0]).toMatchObject({ shortcut: "F1" });
  });

  it("includes transfer commands in two-pane mode and appends a disabled reason to the tooltip", () => {
    const actions = createFileOperationActions(createContext(true));
    const deleteAction = actions.find((action) => action.id === "delete");

    expect(actions.map((action) => action.id)).toContain("copy");
    expect(actions.map((action) => action.id)).toContain("move");
    expect(deleteAction).toMatchObject({ enabled: false, tooltip: "delete (F1): Select an item to delete." });
  });
});
