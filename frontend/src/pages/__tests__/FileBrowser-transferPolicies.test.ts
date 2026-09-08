import { describe, expect, it } from "vitest";
import { getCopyMoveConflictActions, targetResolutionPolicyForConflictResolution } from "../FileBrowser";

describe("targetResolutionPolicyForConflictResolution", () => {
  it("exposes all regular-file transfer policies", () => {
    expect(getCopyMoveConflictActions(null)).toEqual(["skip", "rename"]);
    expect(
      getCopyMoveConflictActions({
        incoming_file: { name: "source.txt", path: "source.txt", type: "file" } as never,
        existing_file: { name: "target.txt", path: "target.txt", type: "file" } as never,
      })
    ).toEqual(["skip", "overwrite", "overwrite-older", "rename"]);
    expect(targetResolutionPolicyForConflictResolution("skip")).toBe("skip");
    expect(targetResolutionPolicyForConflictResolution("overwrite")).toBe("replace");
    expect(targetResolutionPolicyForConflictResolution("overwrite-older")).toBe("replace_older");
    expect(targetResolutionPolicyForConflictResolution("rename")).toBe("ask");
  });
});
