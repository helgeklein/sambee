import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import { type AuthSessionError, AuthSessionManager } from "../authSession";

const OIDC_REFRESH_URL = "http://localhost:3000/api/auth/oidc/refresh";

describe("AuthSessionManager", () => {
  let session: AuthSessionManager | null = null;

  afterEach(() => {
    session?.clear();
    session = null;
    vi.unstubAllGlobals();
  });

  it("preserves a usable session when the OIDC refresh result is uncertain", async () => {
    server.use(
      http.post(OIDC_REFRESH_URL, ({ request }) => {
        expect(request.headers.get("X-Sambee-OIDC-Refresh-Generation")).toBe("7");
        return HttpResponse.json({ detail: { code: "oidc_refresh_uncertain" } }, { status: 401 });
      })
    );
    session = new AuthSessionManager();
    session.setAuthenticated(
      {
        access_token: "still-usable-token",
        token_type: "bearer",
        access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        oidc_refresh_generation: 7,
      },
      true
    );

    await expect(session.requestRefresh()).rejects.toMatchObject<AuthSessionError>({ code: "refresh-uncertain" });

    expect(session.getState()).toBe("refresh-uncertain");
    expect(session.getAccessToken()).toBe("still-usable-token");
    expect(session.hasUsableAccessToken()).toBe(true);
  });

  it("publishes identity epochs for login and clear, but not same-user token refresh", () => {
    session = new AuthSessionManager();
    const identities: Array<{ epoch: number; userId: string | null }> = [];
    session.subscribeToIdentity((identity) => identities.push(identity));

    session.setAuthenticated({ access_token: "first-token", token_type: "bearer", user_id: "user-1" }, true);
    session.setAuthenticated({ access_token: "refreshed-token", token_type: "bearer", user_id: "user-1" }, true);
    session.clear();
    session.setAuthenticated({ access_token: "second-token", token_type: "bearer", user_id: "user-1" }, true);

    expect(identities).toEqual([
      { epoch: 1, userId: "user-1" },
      { epoch: 2, userId: null },
      { epoch: 3, userId: "user-1" },
    ]);
  });

  it.each(["success", "failure"])("keeps a new login when an older bootstrap refresh finishes with %s", async (outcome) => {
    let finishRefresh!: () => void;
    const refreshWait = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    server.use(
      http.post(OIDC_REFRESH_URL, async () => {
        await refreshWait;
        return outcome === "success"
          ? HttpResponse.json({ access_token: "old-session", token_type: "bearer", user_id: "same-user" })
          : HttpResponse.json({ detail: { code: "oidc_reauthentication_required" } }, { status: 401 });
      })
    );
    session = new AuthSessionManager();
    const identities: number[] = [];
    session.subscribeToIdentity(({ epoch }) => identities.push(epoch));
    const bootstrap = session.bootstrap();
    await vi.waitFor(() => expect(session?.getState()).toBe("refreshing"));
    session.setAuthenticated({ access_token: "new-session", token_type: "bearer", user_id: "same-user" }, true);
    session.completeLoginBootstrap();
    finishRefresh();
    await bootstrap;

    expect(session.getAccessToken()).toBe("new-session");
    expect(session.getState()).toBe("active");
    expect(session.isBootstrapComplete()).toBe(true);
    expect(identities).toEqual([1]);
  });

  it.each(["success", "failure"])("does not share an older %s refresh with a new login", async (outcome) => {
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldWait = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const newWait = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    let requests = 0;
    server.use(
      http.post(OIDC_REFRESH_URL, async () => {
        requests += 1;
        if (requests === 1) {
          await oldWait;
          return outcome === "success"
            ? HttpResponse.json({ access_token: "old-refresh", token_type: "bearer", user_id: "same-user" })
            : HttpResponse.json({ detail: { code: "oidc_reauthentication_required" } }, { status: 401 });
        }
        await newWait;
        return HttpResponse.json({ access_token: "new-refresh", token_type: "bearer", user_id: "same-user" });
      })
    );
    session = new AuthSessionManager();
    session.setAuthenticated({ access_token: "session-a", token_type: "bearer", user_id: "same-user" }, true);
    const oldRefresh = session.requestRefresh();
    const oldFailure = expect(oldRefresh).rejects.toThrow();
    await vi.waitFor(() => expect(requests).toBe(1));

    session.beginNewLogin();
    session.setAuthenticated({ access_token: "session-b", token_type: "bearer", user_id: "same-user" }, true);
    const newRefresh = session.requestRefresh();
    await vi.waitFor(() => expect(requests).toBe(2));
    releaseOld();
    await oldFailure;
    const joinedRefresh = session.requestRefresh();
    expect(requests).toBe(2);
    releaseNew();

    await expect(newRefresh).resolves.toMatchObject({ access_token: "new-refresh" });
    await expect(joinedRefresh).resolves.toMatchObject({ access_token: "new-refresh" });
    expect(requests).toBe(2);
    expect(session.getAccessToken()).toBe("new-refresh");
    expect(session.getState()).toBe("active");
  });

  it("does not dispatch a queued refresh after a new login", async () => {
    let releaseLock!: () => void;
    const lockWait = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
          await lockWait;
          return callback();
        },
      },
    });
    let requests = 0;
    server.use(
      http.post(OIDC_REFRESH_URL, () => {
        requests += 1;
        return HttpResponse.json({ access_token: "old-refresh", token_type: "bearer" });
      })
    );
    session = new AuthSessionManager();
    session.setAuthenticated({ access_token: "session-a", token_type: "bearer" }, true);
    const oldRefresh = session.requestRefresh();
    const oldFailure = expect(oldRefresh).rejects.toThrow();
    session.beginNewLogin();
    session.setAuthenticated({ access_token: "session-b", token_type: "bearer" }, true);
    releaseLock();

    await oldFailure;
    expect(requests).toBe(0);
    expect(session.getAccessToken()).toBe("session-b");
    expect(session.getState()).toBe("active");
  });
});
