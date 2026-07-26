import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      username: "admin",
      name: "Test Admin",
      email: "admin@example.test",
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({ configuration_revision: 3, identity_mapping_revision: 2 });
    window.location.hash = "flow=test-flow";

    render(<AuthenticationSettings />);

    expect(await screen.findByDisplayValue("Tested Provider")).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("test-flow");
    await user.click(screen.getByRole("button", { name: "Activate configuration" }));
    expect(await screen.findByDisplayValue("Activated Provider")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledWith("test-flow");
  });
});
