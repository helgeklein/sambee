import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getIdentity, getUserId, purgeExpiredDraftsForCurrentUser, subscribeToIdentity } = vi.hoisted(() => ({
  getIdentity: vi.fn(() => ({ epoch: 0, userId: "test-user" })),
  getUserId: vi.fn(() => "test-user"),
  purgeExpiredDraftsForCurrentUser: vi.fn(),
  subscribeToIdentity: vi.fn(() => () => undefined),
}));

vi.mock("../../services/authSession", () => ({
  authSession: { getIdentity, getUserId, subscribeToIdentity },
}));

vi.mock("../../services/draftRecovery", () => ({ purgeExpiredDraftsForCurrentUser }));

import { useDraftRecoveryCleanup } from "../useDraftRecoveryCleanup";

describe("useDraftRecoveryCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getIdentity.mockReturnValue({ epoch: 0, userId: "test-user" });
    getUserId.mockReturnValue("test-user");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("purges after authentication and when the tab returns or the cleanup interval elapses", () => {
    const { unmount } = renderHook(() => useDraftRecoveryCleanup());

    expect(purgeExpiredDraftsForCurrentUser).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(15 * 60 * 1000);
    });

    expect(purgeExpiredDraftsForCurrentUser).toHaveBeenCalledTimes(3);

    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(purgeExpiredDraftsForCurrentUser).toHaveBeenCalledTimes(3);
  });
});
