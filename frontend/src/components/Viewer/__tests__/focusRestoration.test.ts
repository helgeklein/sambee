import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleRetriableFocusRestore } from "../focusRestoration";

describe("scheduleRetriableFocusRestore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops retrying after the first successful restore", async () => {
    vi.useFakeTimers();
    const attemptRestore = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(true);

    scheduleRetriableFocusRestore({
      delaysMs: [0, 20, 40, 80],
      attemptRestore,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(attemptRestore).toHaveBeenCalledTimes(3);
  });

  it("cancels pending retries when cleaned up", async () => {
    vi.useFakeTimers();
    const attemptRestore = vi.fn<() => boolean>().mockReturnValue(false);

    const cleanup = scheduleRetriableFocusRestore({
      delaysMs: [0, 20, 40],
      attemptRestore,
    });

    await vi.advanceTimersByTimeAsync(5);
    cleanup();
    await vi.advanceTimersByTimeAsync(100);

    expect(attemptRestore).toHaveBeenCalledTimes(1);
  });
});
