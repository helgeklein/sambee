import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../../services/api";
import type { OidcAdminConfigurationRead, RedactedOidcConfiguration } from "../../types";
import { AuthenticationSettings } from "../AuthenticationSettings";

vi.mock("../../services/api", () => ({
  default: {
    getOidcConfiguration: vi.fn(),
    getOidcTestResult: vi.fn(),
    finalizeOidcConfiguration: vi.fn(),
    startOidcTest: vi.fn(),
    setPasswordOnlyAuthentication: vi.fn(),
  },
}));

vi.mock("../../services/authConfig", () => ({ clearAuthConfigCache: vi.fn() }));

const configuration = (displayName: string): RedactedOidcConfiguration => ({
  display_name: displayName,
  issuer_url: `https://${displayName.toLowerCase().replaceAll(" ", "-")}.example.test`,
  client_id: "sambee",
  client_secret_configured: true,
  scopes: ["openid", "profile", "groups"],
  username_claim: "preferred_username",
  username_claim_uniqueness_confirmed: true,
  name_claim: "name",
  email_claim: "email",
  groups_claim: "groups",
  sign_in_mode: "oidc_or_password",
  admission_mode: "selected_groups",
  admission_groups: ["sambee-users"],
  role_mappings: { admin: ["sambee-admins"], editor: [] },
  configuration_revision: 2,
  identity_mapping_revision: 1,
});

const response = (value: RedactedOidcConfiguration): OidcAdminConfigurationRead => ({
  configuration: value,
  health: {
    oidc_secret_key_configured: true,
    public_url_configured: true,
    public_url: "https://sambee.example.test",
    redirect_uri: "https://sambee.example.test/api/auth/oidc/callback",
    status: "healthy",
    reasons: [],
  },
});

const renderSettings = () =>
  render(
    <MemoryRouter initialEntries={["/settings/admin/authentication"]}>
      <Routes>
        <Route path="/settings/admin/authentication" element={<AuthenticationSettings />} />
        <Route path="/login" element={<div>Sign in again</div>} />
      </Routes>
    </MemoryRouter>
  );

describe("Authentication settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/settings/admin/authentication#flow=test-flow");
  });

  it("reviews the tested candidate and synchronizes the activated configuration", async () => {
    const user = userEvent.setup();
    const active = configuration("Old Provider");
    const tested = configuration("Tested Provider");
    const activated = configuration("Activated Provider");
    vi.mocked(api.getOidcConfiguration).mockResolvedValueOnce(response(active)).mockResolvedValueOnce(response(activated));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "test-flow",
      candidate: tested,
      replacement_mappings: [],
      expected_identity_mapping_revision: 1,
      username: "admin",
      name: "Test Admin",
      email: "admin@example.test",
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 2,
      reauthentication_required: false,
    });
    window.location.hash = "flow=test-flow";

    renderSettings();

    expect(await screen.findByDisplayValue("Tested Provider")).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("test-flow");
    await user.click(screen.getByRole("button", { name: "Activate configuration" }));
    expect(await screen.findByDisplayValue("Activated Provider")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledWith("test-flow", [], 1, []);
  });

  it("requires review of unique replacement usernames", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Old Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "test-flow",
      candidate: configuration("New Provider"),
      replacement_mappings: [
        {
          target_user_id: "user-1",
          local_username: "alice",
          local_role: "editor",
          has_local_password: true,
          target_state: "active",
          mapping_state: "pending",
          suggested_username: "provider-alice",
          prefill_source: "pending",
          selected_by_default: true,
          selectable: true,
          omission_acknowledgement_required: false,
        },
        {
          target_user_id: "user-2",
          local_username: "bob",
          local_role: "viewer",
          has_local_password: true,
          target_state: "active",
          mapping_state: "pending",
          suggested_username: "provider-bob",
          prefill_source: "pending",
          selected_by_default: true,
          selectable: true,
          omission_acknowledgement_required: false,
        },
      ],
      expected_identity_mapping_revision: 4,
      username: "admin",
      name: "Test Admin",
      email: "admin@example.test",
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 2,
      reauthentication_required: true,
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    const alice = await screen.findByRole("textbox", { name: "Provider username for alice" });
    const bob = screen.getByRole("textbox", { name: "Provider username for bob" });
    await user.clear(bob);
    await user.type(bob, "provider-alice");
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeDisabled();
    await user.clear(alice);
    await user.type(alice, "reviewed-alice");
    await user.click(screen.getByRole("button", { name: "Activate configuration" }));

    expect(api.finalizeOidcConfiguration).toHaveBeenCalledWith(
      "test-flow",
      [
        { target_user_id: "user-1", expected_username: "reviewed-alice" },
        { target_user_id: "user-2", expected_username: "provider-alice" },
      ],
      4,
      []
    );
  });

  it("returns to login without a privileged refresh after Password-only recovery", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.setPasswordOnlyAuthentication).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 1,
      reauthentication_required: true,
    });
    localStorage.setItem("access_token", "revoked-token");
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Switch to Password only" }));

    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(api.getOidcConfiguration).toHaveBeenCalledTimes(1);
  });

  it("requires uniqueness to be reconfirmed when the username claim changes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    const confirmation = await screen.findByRole("checkbox", { name: "I confirmed this claim is stable and unique for every user" });
    expect(confirmation).toBeChecked();
    await user.clear(screen.getByRole("textbox", { name: "Username claim" }));
    await user.type(screen.getByRole("textbox", { name: "Username claim" }), "email");
    expect(confirmation).not.toBeChecked();
  });
});
