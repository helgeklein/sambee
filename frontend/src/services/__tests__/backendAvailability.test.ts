import { beforeEach, describe, expect, it } from "vitest";
import {
  getBackendAvailabilitySnapshot,
  isBackendConnectivityError,
  markBackendAvailable,
  markBackendReconnecting,
  markBackendUnavailable,
  resetBackendAvailabilityForTests,
} from "../backendAvailability";

describe("backendAvailability", () => {
  beforeEach(() => {
    resetBackendAvailabilityForTests();
  });

  it("tracks availability transitions", () => {
    expect(getBackendAvailabilitySnapshot().status).toBe("available");

    markBackendReconnecting("socket closed");
    expect(getBackendAvailabilitySnapshot()).toMatchObject({
      status: "reconnecting",
      lastErrorMessage: "socket closed",
    });

    markBackendUnavailable("Network Error");
    expect(getBackendAvailabilitySnapshot()).toMatchObject({
      status: "unavailable",
      lastErrorMessage: "Network Error",
    });

    markBackendAvailable();
    expect(getBackendAvailabilitySnapshot()).toMatchObject({
      status: "available",
      lastErrorMessage: null,
    });
  });

  it("classifies connectivity failures without HTTP responses", () => {
    expect(isBackendConnectivityError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
    expect(isBackendConnectivityError(new Error("Failed to fetch"))).toBe(true);
  });

  it("does not treat local request aborts or client timeouts as backend loss by default", () => {
    expect(isBackendConnectivityError({ code: "ECONNABORTED", message: "timeout of 8000ms exceeded" })).toBe(false);
  });

  it("does not classify HTTP responses as connectivity failures", () => {
    expect(
      isBackendConnectivityError({
        response: { status: 500, data: { detail: "Internal error" } },
        message: "Request failed with status code 500",
      })
    ).toBe(false);
  });
});
