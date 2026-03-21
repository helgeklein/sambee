import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../useApiRetry";

describe("useApiRetry", () => {
  it("returns successful result without retry", async () => {
    const { result } = renderHook(() => useApiRetry());
    const fetchFn = vi.fn().mockResolvedValue("success");

    const response = await result.current(fetchFn);

    expect(response).toBe("success");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors (no response)", async () => {
    const { result } = renderHook(() => useApiRetry());
    const error = { code: "ERR_NETWORK", message: "Network Error" };
    const fetchFn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success after retry");

    const response = await result.current(fetchFn, { retryDelay: 10 });

    expect(response).toBe("success after retry");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on API errors with response", async () => {
    const { result } = renderHook(() => useApiRetry());
    const error = {
      response: { data: { detail: "Not found" }, status: 404 },
      message: "Request failed",
    };
    const fetchFn = vi.fn().mockRejectedValue(error);

    await expect(result.current(fetchFn)).rejects.toEqual(error);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("respects abort signal", async () => {
    const { result } = renderHook(() => useApiRetry());
    const abortController = new AbortController();
    const error = { code: "ERR_NETWORK", message: "Network Error" };
    const fetchFn = vi.fn().mockRejectedValue(error);

    // Abort immediately
    abortController.abort();

    await expect(result.current(fetchFn, { signal: abortController.signal })).rejects.toEqual(error);
    expect(fetchFn).toHaveBeenCalledTimes(1); // No retry due to abort
  });

  it("respects maxRetries option", async () => {
    const { result } = renderHook(() => useApiRetry());
    const error = { code: "ERR_NETWORK", message: "Network Error" };
    const fetchFn = vi.fn().mockRejectedValue(error);

    await expect(result.current(fetchFn, { retryDelay: 10, maxRetries: 2 })).rejects.toEqual(error);
    expect(fetchFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it("provides correct error message for transient errors", () => {
    const message = getTransientErrorMessage();
    expect(message).toBe("Server is busy. Please wait a moment and try again.");
  });

  it("correctly identifies transient errors", () => {
    // Network errors (ERR_NETWORK code) are transient
    expect(checkIsTransientError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
    expect(checkIsTransientError({ code: "ECONNREFUSED", message: "Connection refused" })).toBe(true);

    // Errors with "Network Error" message are transient
    expect(checkIsTransientError({ message: "Network Error" })).toBe(true);

    // Client-side abort/timeout should not automatically flip the app into backend-unavailable mode
    expect(checkIsTransientError({ code: "ECONNABORTED", message: "timeout of 8000ms exceeded" })).toBe(false);

    // API errors with HTTP status codes are NOT transient
    expect(
      checkIsTransientError({
        response: { data: { detail: "Not found" }, status: 404 },
        message: "Request failed",
      })
    ).toBe(false);

    expect(
      checkIsTransientError({
        response: { data: { detail: "Forbidden" }, status: 403 },
        message: "Request failed",
      })
    ).toBe(false);

    // Errors with response object (even without status) are NOT transient - server responded
    expect(checkIsTransientError({ response: { data: {} }, message: "Error" })).toBe(false);

    // Generic errors with no response at all are transient (network issue)
    expect(checkIsTransientError({ message: "Some error" })).toBe(true);
  });
});
