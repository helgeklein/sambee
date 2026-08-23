import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../test/mocks/server";
import { type AuthSessionError, AuthSessionManager } from "../authSession";

const OIDC_REFRESH_URL = "http://localhost:3000/api/auth/oidc/refresh";

describe("AuthSessionManager", () => {
  let session: AuthSessionManager | null = null;

  afterEach(() => {
    session?.clear();
    session = null;
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
});
