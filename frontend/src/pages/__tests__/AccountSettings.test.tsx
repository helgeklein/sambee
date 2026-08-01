import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../theme";
import type { CurrentAccount } from "../../types";
import { AccountSettings } from "../AccountSettings";

vi.mock("../../services/api", () => ({
  default: {
    getCurrentAccount: vi.fn(),
    getOidcBrowserSessions: vi.fn(),
    revokeOidcBrowserSession: vi.fn(),
    revokeOtherOidcBrowserSessions: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock("../../services/accountSession", () => ({
  signOutCurrentBrowser: vi.fn(),
}));

import { signOutCurrentBrowser } from "../../services/accountSession";
import api from "../../services/api";

const PASSWORD_ACCOUNT: CurrentAccount = {
  id: "account-id",
  username: "alex",
  name: "Alex Example",
  email: "alex@example.test",
  role: "editor",
  is_active: true,
  must_change_password: false,
  expires_at: null,
  created_at: "2026-01-01T00:00:00Z",
  has_local_password: true,
  password_change_available: true,
  browser_session_management_available: false,
  oidc_provider_name: null,
};

function renderAccount() {
  return render(
    <SambeeThemeProvider>
      <MemoryRouter initialEntries={["/settings/account"]}>
        <Routes>
          <Route path="/settings/account" element={<AccountSettings />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </SambeeThemeProvider>
  );
}

describe("AccountSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCurrentAccount).mockResolvedValue(PASSWORD_ACCOUNT);
  });

  it("shows password controls without requesting OIDC sessions when they do not apply", async () => {
    renderAccount();

    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Account" })).toHaveLength(1);
    expect(screen.getByText("Manage your identity, password, browser sessions, and sign-out.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your identity" })).toBeInTheDocument();
    expect(screen.queryByText("Your signed-in identity and access level.")).not.toBeInTheDocument();
    expect(screen.getByText("Username").closest("li")).toHaveStyle({ paddingTop: "0px" });
    expect(screen.getByRole("heading", { name: "Password" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Browser sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.queryByText("End this browser's Sambee session.")).not.toBeInTheDocument();
    expect(api.getOidcBrowserSessions).not.toHaveBeenCalled();
  });

  it("loads OIDC sessions only when the account supports them without adding a duplicate section divider", async () => {
    vi.mocked(api.getCurrentAccount).mockResolvedValue({
      ...PASSWORD_ACCOUNT,
      password_change_available: false,
      browser_session_management_available: true,
      oidc_provider_name: "Company SSO",
    });
    vi.mocked(api.getOidcBrowserSessions).mockResolvedValue({
      sessions: [
        {
          id: "session-id",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          authenticated_at: "2026-01-01T00:00:00Z",
          last_seen_at: null,
          last_refreshed_at: null,
          current: true,
        },
      ],
    });

    const { container } = renderAccount();

    expect(await screen.findByRole("heading", { name: "Browser sessions" })).toBeInTheDocument();
    expect(await screen.findByText("This browser")).toBeInTheDocument();
    expect(container.querySelectorAll("hr")).toHaveLength(0);
    expect(api.getOidcBrowserSessions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Password" })).not.toBeInTheDocument();
  });

  it("shows a retry action instead of loading indefinitely when account loading fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCurrentAccount).mockRejectedValueOnce(new Error("Offline"));
    renderAccount();

    expect(await screen.findByText("Account information could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading account")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
  });

  it("does not report an empty session list when OIDC session loading fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getCurrentAccount).mockResolvedValue({
      ...PASSWORD_ACCOUNT,
      password_change_available: false,
      browser_session_management_available: true,
    });
    vi.mocked(api.getOidcBrowserSessions).mockRejectedValueOnce(new Error("Offline"));
    vi.mocked(api.getOidcBrowserSessions).mockResolvedValueOnce({
      sessions: [
        {
          id: "session-id",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          authenticated_at: "2026-01-01T00:00:00Z",
          last_seen_at: null,
          last_refreshed_at: null,
          current: true,
        },
      ],
    });
    renderAccount();

    expect(await screen.findAllByText("Browser sessions could not be loaded.")).toHaveLength(2);
    expect(screen.queryByText("No renewable OIDC sessions are active.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("This browser")).toBeInTheDocument();
  });

  it("validates a matching password confirmation before submitting", async () => {
    const user = userEvent.setup();
    renderAccount();

    await screen.findByRole("heading", { name: "Password" });
    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("The new password and confirmation do not match.")).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("changes the local password then signs out", async () => {
    const user = userEvent.setup();
    renderAccount();

    await screen.findByRole("heading", { name: "Password" });
    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith("old-password", "new-password"));
    await waitFor(() => expect(signOutCurrentBrowser).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("signs out from the account action", async () => {
    const user = userEvent.setup();
    renderAccount();

    await screen.findByText("Alex Example");
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutCurrentBrowser).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });
});
