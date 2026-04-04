import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBackendAvailabilitySnapshot, resetBackendAvailabilityForTests } from "../../services/backendAvailability";
import { useBackendRecoveryMonitor } from "../useBackendRecoveryMonitor";

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useBackendRecoveryMonitor", () => {
  beforeEach(() => {
    resetBackendAvailabilityForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps probing until the backend recovers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const onRecovered = vi.fn();
    const onReconnectNow = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(({ status }) => useBackendRecoveryMonitor({ status, onRecovered, onReconnectNow }), {
      initialProps: { status: "available" as const },
    });

    rerender({ status: "unavailable" });

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getBackendAvailabilitySnapshot().status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getBackendAvailabilitySnapshot().status).toBe("available");
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(onReconnectNow).toHaveBeenCalled();
  });

  it("triggers an immediate recovery probe on focus", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const onReconnectNow = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(({ status }) => useBackendRecoveryMonitor({ status, onReconnectNow }), {
      initialProps: { status: "available" as const },
    });

    rerender({ status: "unavailable" });

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onReconnectNow).toHaveBeenCalledWith("window-focus");
  });

  it("uses an authenticated recovery probe when an access token is present", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    localStorage.setItem("access_token", "token-123");
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(({ status }) => useBackendRecoveryMonitor({ status }), {
      initialProps: { status: "available" as const },
    });

    rerender({ status: "unavailable" });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/me",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      })
    );
  });

  it("escalates to unavailable after repeated failed probes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(({ status }) => useBackendRecoveryMonitor({ status }), {
      initialProps: { status: "available" as const },
    });

    rerender({ status: "reconnecting" });

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getBackendAvailabilitySnapshot().status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_250);
    });
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(getBackendAvailabilitySnapshot().status).toBe("unavailable");
  });
});
