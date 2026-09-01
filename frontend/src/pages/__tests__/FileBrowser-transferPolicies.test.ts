import { describe, expect, it } from "vitest";
import { getCopyMoveConflictActions, targetResolutionPolicyForConflictResolution } from "../FileBrowser";

describe("targetResolutionPolicyForConflictResolution", () => {
  it("phase_10_stabilization_transfer_policy_exposes_skip_and_rename", () => {
    expect(getCopyMoveConflictActions(null)).toEqual(["skip", "rename"]);
    expect(targetResolutionPolicyForConflictResolution("overwrite")).toBe("replace");
    expect(targetResolutionPolicyForConflictResolution("overwrite-older")).toBe("replace_older");
    expect(targetResolutionPolicyForConflictResolution("rename")).toBe("ask");
  });
});
