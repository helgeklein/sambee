import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OidcCallback from "../OidcCallback";

vi.mock("../../services/api", () => ({
  exchangeOidcGrant: vi.fn(),
  setOidcExchangePending: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { initializeBackendTracing: vi.fn().mockResolvedValue(undefined) },
}));

import { exchangeOidcGrant, setOidcExchangePending } from "../../services/api";
import { authSession } from "../../services/authSession";
import { loginPath, loginReturnPath, sanitizeReturnPath } from "../../services/oidcAuth";

describe("OIDC callback", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(exchangeOidcGrant).mockReset();
    window.history.replaceState(null, "", "/login/oidc/callback");
    window.location.hash = "";
    window.location.hash = "grant=one-time-grant";
  });

  it("clears the fragment before exchanging the one-time grant", async () => {
    expect(window.location.hash).toContain("grant=one-time-grant");
    const replaceState = vi.spyOn(window.history, "replaceState");
    let fragmentScrubbedBeforeExchange = false;
    vi.mocked(exchangeOidcGrant).mockImplementation(async () => {
      fragmentScrubbedBeforeExchange = replaceState.mock.calls.some(
        ([state, , url]) => state === null && typeof url === "string" && !url.includes("grant")
      );
      return {
        access_token: "sambee-token",
        token_type: "bearer",
        username: "alice",
        return_path: "/browse",
      };
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/login/oidc/callback"]}>
          <Routes>
            <Route path="/login/oidc/callback" element={<OidcCallback />} />
            <Route path="/browse" element={<div>File browser</div>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );

    await waitFor(() => expect(exchangeOidcGrant).toHaveBeenCalledWith("one-time-grant"));
    expect(fragmentScrubbedBeforeExchange).toBe(true);
    expect(await screen.findByText("File browser")).toBeInTheDocument();
    expect(authSession.getAccessToken()).toBe("sambee-token");
    expect(authSession.isBootstrapComplete()).toBe(true);
    expect(exchangeOidcGrant).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Completing sign in")).not.toBeInTheDocument();
  });

  it("shows a generic retry action when the grant is missing", async () => {
    window.history.replaceState(null, "", "/login/oidc/callback");
    window.location.hash = "";

    render(
      <MemoryRouter initialEntries={["/login/oidc/callback"]}>
        <OidcCallback />
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(exchangeOidcGrant).not.toHaveBeenCalled();
    expect(setOidcExchangePending).toHaveBeenCalledWith(false);
  });

  it("keeps the callback error visible when exchange fails", async () => {
    let rejectExchange!: (reason: Error) => void;
    vi.mocked(exchangeOidcGrant).mockReturnValue(
      new Promise((_, reject) => {
        rejectExchange = reject;
      })
    );
    render(
      <MemoryRouter>
        <OidcCallback />
      </MemoryRouter>
    );
    await waitFor(() => expect(setOidcExchangePending).toHaveBeenCalledWith(true));
    rejectExchange(new Error("Grant expired"));
    expect(await screen.findByText("Sign in could not be completed.")).toBeInTheDocument();
    expect(setOidcExchangePending).toHaveBeenLastCalledWith(false);
  });

  it.each([
    "/login/oidc/callback",
    "/login/oidc/callback?grant=expired",
    "https://outside.example/path",
    "//outside.example/path",
    "/\\outside.example/path",
  ])("rejects an unsafe return path: %s", (path) => {
    expect(sanitizeReturnPath(path)).toBe("/browse");
    expect(loginReturnPath(`?return_path=${encodeURIComponent(path)}`)).toBe("/browse");
    expect(loginPath(path)).toBe("/login?return_path=%2Fbrowse");
  });

  it("preserves internal return paths and queries", () => {
    expect(sanitizeReturnPath("/browse/folder?view=grid")).toBe("/browse/folder?view=grid");
    expect(loginReturnPath("?return_path=%2Flogin%2Foidc%2Fcallback")).toBe("/browse");
  });
});
