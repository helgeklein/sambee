import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OidcCallback from "../OidcCallback";

vi.mock("../../services/api", () => ({
  exchangeOidcGrant: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { initializeBackendTracing: vi.fn().mockResolvedValue(undefined) },
}));

import { exchangeOidcGrant } from "../../services/api";

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
  });
});
