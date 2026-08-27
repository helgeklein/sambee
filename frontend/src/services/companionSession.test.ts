import { describe, expect, it, vi } from "vitest";
import { CompanionSession } from "./companionSession";

describe("CompanionSession", () => {
  it("publishes revised snapshots when pairing state or drives change", () => {
    const session = new CompanionSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.setState("paired", [{ driveId: "c", name: "System", path: "" }]);

    expect(listener).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({
      status: "paired",
      revision: 1,
      drives: [{ driveId: "c", name: "System" }],
    });

    unsubscribe();
    session.setState("unavailable");
    expect(listener).toHaveBeenCalledOnce();
  });
});
