import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortForegroundLocalArchiveRequest,
  beginForegroundLocalArchiveRequest,
  clearForegroundArchiveOperation,
  clearForegroundLocalArchiveRequest,
  hasForegroundArchiveWork,
  loadForegroundArchiveOperation,
  requestForegroundArchiveCancellation,
  storeForegroundArchiveOperation,
} from "../foregroundArchiveOperation";

describe("foreground archive operation tracking", () => {
  afterEach(() => {
    clearForegroundArchiveOperation();
    vi.restoreAllMocks();
  });

  it("stores and clears only the requested foreground operation", () => {
    storeForegroundArchiveOperation("operation-a");

    expect(loadForegroundArchiveOperation()?.operationId).toBe("operation-a");
    clearForegroundArchiveOperation("operation-b");
    expect(loadForegroundArchiveOperation()?.operationId).toBe("operation-a");
    clearForegroundArchiveOperation("operation-a");
    expect(loadForegroundArchiveOperation()).toBeNull();
  });

  it("sends a credentialed keepalive cancellation request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    requestForegroundArchiveCancellation("operation-id");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/archive/operations/operation-id/cancel",
      expect.objectContaining({ credentials: "include", keepalive: true, method: "POST" })
    );
  });

  it("removes malformed markers without retrying storage parsing", () => {
    sessionStorage.setItem("sambee:foreground-archive-operation", "not-json");

    expect(loadForegroundArchiveOperation()).toBeNull();
    expect(sessionStorage.getItem("sambee:foreground-archive-operation")).toBeNull();
  });

  it("aborts and clears direct local archive requests", () => {
    const signal = beginForegroundLocalArchiveRequest();

    expect(hasForegroundArchiveWork()).toBe(true);
    abortForegroundLocalArchiveRequest();
    expect(signal.aborted).toBe(true);
    clearForegroundLocalArchiveRequest(signal);
    expect(hasForegroundArchiveWork()).toBe(false);
  });
});
