import { describe, expect, it, vi } from "vitest";
import { createBrowserContentServices } from "./browserContentServices";
import { CompanionSession } from "./companionSession";

describe("BrowserContentServices", () => {
  it("does not publish unchanged connection or companion snapshots", () => {
    const companion = new CompanionSession();
    const services = createBrowserContentServices([], companion);
    const listener = vi.fn();
    services.subscribe(listener);

    services.updateConnections([]);
    services.updateCompanionSnapshot(companion.getSnapshot());

    expect(listener).not.toHaveBeenCalled();

    companion.setState("unavailable");

    expect(listener).toHaveBeenCalledOnce();
    services.dispose();
  });
});
