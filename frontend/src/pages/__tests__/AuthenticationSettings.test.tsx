import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthenticationSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../../components/Settings/settingsDataSources";
import { clearCachedAsyncData, primeCachedAsyncData } from "../../hooks/useCachedAsyncData";
import api from "../../services/api";
import { authSession } from "../../services/authSession";
import type { OidcAdminConfigurationRead, OidcReviewedPolicy, OidcTestedIdentity, RedactedOidcConfiguration } from "../../types";
import { AuthenticationSettings } from "../AuthenticationSettings";

vi.mock("../../services/api", () => ({
  default: {
    getOidcConfiguration: vi.fn(),
    getOidcTestResult: vi.fn(),
    finalizeOidcConfiguration: vi.fn(),
    startOidcTest: vi.fn(),
    setPasswordOnlyAuthentication: vi.fn(),
    activateAuthenticationMode: vi.fn(),
    cancelOidcTestFlow: vi.fn(),
  },
}));

vi.mock("../../services/authConfig", () => ({ clearAuthConfigCache: vi.fn() }));

const configuration = (displayName: string): RedactedOidcConfiguration => ({
  display_name: displayName,
  issuer_url: `https://${displayName.toLowerCase().replace(/ /g, "-")}.example.test`,
  client_id: "sambee",
  client_secret_configured: true,
  scopes: ["openid", "profile", "groups"],
  username_claim: "preferred_username",
  name_claim: "name",
  email_claim: "email",
  groups_claim: "groups",
  sign_in_mode: "oidc_or_password",
  interactive_reauthentication_max_age_days: 30,
  admission_mode: "selected_groups",
  admission_groups: ["sambee-users"],
  role_assignment_mode: "group_based",
  uniform_role: "editor",
  role_mappings: { admin: ["sambee-admins"], editor: [], viewer: [] },
  configuration_revision: 2,
  identity_mapping_revision: 1,
});

const response = (value: RedactedOidcConfiguration): OidcAdminConfigurationRead => ({
  configuration: value,
  active_passwordless_user_count: 2,
  auth_mode: value.sign_in_mode,
  auth_mode_source: "ui",
  health: {
    public_url_configured: true,
    public_url: "https://sambee.example.test",
    redirect_uri: "https://sambee.example.test/api/auth/oidc/callback",
    status: "healthy",
    reasons: [],
  },
});

const reviewedPolicy = (value: RedactedOidcConfiguration): OidcReviewedPolicy => ({
  sign_in_mode: value.sign_in_mode,
  interactive_reauthentication_max_age_days: value.interactive_reauthentication_max_age_days,
  admission_mode: value.admission_mode,
  admission_groups: value.admission_groups,
  role_assignment_mode: value.role_assignment_mode,
  uniform_role: value.uniform_role,
  role_mappings: value.role_mappings,
});

const testedIdentity = (overrides: Partial<OidcTestedIdentity> = {}): OidcTestedIdentity => ({
  flow_id: "test-flow",
  candidate: configuration("Tested Provider"),
  replacement_mappings: [],
  expected_identity_mapping_revision: 1,
  admitted: true,
  matching_admission_group: "sambee-users",
  affected_account_count: 1,
  acting_administrator_affected: true,
  username: "admin",
  name: "Test Admin",
  email: "admin@example.test",
  groups: ["sambee-admins"],
  expires_at: "2099-01-01T00:00:00Z",
  ...overrides,
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
    clearCachedAsyncData();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/settings/admin/authentication#flow=test-flow");
  });

  it("uses prefetched Authentication settings without a second request", async () => {
    const active = configuration("Active Provider");
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(active));
    await primeCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication, loadAuthenticationSettingsData);
    vi.mocked(api.getOidcConfiguration).mockClear();
    window.history.replaceState(null, "", "/settings/admin/authentication");

    renderSettings();

    expect(await screen.findByDisplayValue("Active Provider")).toBeInTheDocument();
    expect(api.getOidcConfiguration).not.toHaveBeenCalled();
  });

  it("links to the OpenID Connect setup guide in the page description", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.history.replaceState(null, "", "/settings/admin/authentication");

    renderSettings();

    expect(await screen.findByText("Configure sign-in methods", { exact: false })).toBeInTheDocument();
    const guide = await screen.findByRole("link", { name: "OpenID Connect setup guide" });
    expect(guide).toHaveAttribute("href", "https://sambee.net/mr/help-oidc-setup");
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("rel", "noreferrer");
  });

  it("tabs directly from the setup guide to the Authentication mode control", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.history.replaceState(null, "", "/settings/admin/authentication");

    renderSettings();

    const guide = await screen.findByRole("link", { name: "OpenID Connect setup guide" });
    const authenticationMode = screen.getByRole("combobox", { name: "Authentication mode" });
    guide.focus();
    await user.tab();

    expect(authenticationMode).toHaveFocus();
    expect(authenticationMode.parentElement?.querySelector("input.MuiSelect-nativeInput")).toHaveAttribute("tabindex", "-1");
  });

  it("reviews the tested candidate and synchronizes the activated configuration", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const active = configuration("Old Provider");
    const tested = configuration("Tested Provider");
    const activated = configuration("Activated Provider");
    vi.mocked(api.getOidcConfiguration).mockResolvedValueOnce(response(active)).mockResolvedValueOnce(response(activated));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "test-flow",
      candidate: tested,
      replacement_mappings: [],
      expected_identity_mapping_revision: 1,
      admitted: true,
      matching_admission_group: "sambee-users",
      affected_account_count: 1,
      acting_administrator_affected: true,
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
    expect(api.getOidcTestResult).toHaveBeenCalledWith("test-flow", undefined);
    await user.click(screen.getByRole("button", { name: "Activate configuration" }));
    expect(await screen.findByDisplayValue("Activated Provider")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledWith("test-flow", reviewedPolicy(tested), [], 1, []);
  });

  it("shows the OIDC review after a test when the current mode is no authentication", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      ...response(configuration("Tested Provider")),
      configuration: null,
      auth_mode: "none",
    });
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    window.location.hash = "flow=test-flow";

    renderSettings();

    expect(await screen.findByText("Tested identity")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Authentication mode" })).toHaveTextContent("OIDC or password");
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeEnabled();
  });

  it("restores the current tab's OIDC setup flow from session storage", async () => {
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    window.location.hash = "";
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "stored-flow",
      candidate: configuration("Stored Provider"),
      replacement_mappings: [],
      expected_identity_mapping_revision: 1,
      admitted: true,
      matching_admission_group: "sambee-users",
      affected_account_count: 1,
      acting_administrator_affected: true,
      username: "admin",
      name: null,
      email: null,
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });

    renderSettings();

    expect(await screen.findByDisplayValue("Stored Provider")).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("stored-flow", undefined);
  });

  it("discards an invalid stored reviewed policy before restoring the server snapshot", async () => {
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem(
      "sambee.oidc.reviewedPolicy",
      JSON.stringify({ sign_in_mode: "retired_mode", admission_groups: "sambee-users" })
    );
    window.location.hash = "";
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity({ flow_id: "stored-flow" }));

    renderSettings();

    expect(await screen.findByDisplayValue("Tested Provider")).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("stored-flow", undefined);
    expect(JSON.parse(sessionStorage.getItem("sambee.oidc.reviewedPolicy") ?? "null")).toEqual(
      reviewedPolicy(configuration("Tested Provider"))
    );
  });

  it("clears an expired saved flow but retains retryable preview state", async () => {
    sessionStorage.setItem("sambee.oidc.setupFlowId", "expired-flow");
    window.location.hash = "";
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockRejectedValueOnce({ response: { status: 404 } });

    const expiredView = renderSettings();

    expect(await screen.findByText(/saved OIDC test has expired/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
    expiredView.unmount();

    sessionStorage.setItem("sambee.oidc.setupFlowId", "retryable-flow");
    vi.mocked(api.getOidcTestResult).mockRejectedValueOnce({ message: "Network unavailable" });
    renderSettings();

    expect(await screen.findByText(/OIDC test result could not be loaded/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("retryable-flow");
  });

  it("places all authentication modes before the provider setup", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("combobox", { name: "Authentication mode" }));

    expect(screen.getByRole("option", { name: "No authentication" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Password only" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OIDC or password" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OIDC only" })).toBeInTheDocument();
  });

  it("explains when the public URL is missing", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      ...response(configuration("Active Provider")),
      health: {
        public_url_configured: false,
        public_url: null,
        redirect_uri: null,
        status: "unhealthy",
        reasons: ["public_url_missing"],
      },
    });
    window.location.hash = "";
    renderSettings();

    expect(await screen.findByText("Set Sambee's externally reachable public URL in network settings.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Network settings" })).not.toBeInTheDocument();
    expect(screen.queryByText(/public_url_missing/i)).not.toBeInTheDocument();
  });

  it("shows OIDC prerequisites only while an OIDC mode is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      ...response(configuration("Active Provider")),
      health: {
        public_url_configured: false,
        public_url: null,
        redirect_uri: null,
        status: "unhealthy",
        reasons: ["public_url_missing"],
      },
    });
    window.location.hash = "";
    renderSettings();

    expect(await screen.findByText("Set Sambee's externally reachable public URL in network settings.")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Authentication mode" }));
    await user.click(screen.getByRole("option", { name: "Password only" }));
    expect(screen.queryByText("Set Sambee's externally reachable public URL in network settings.")).not.toBeInTheDocument();
  });

  it("activates No authentication without a checkbox or native confirmation gate", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.activateAuthenticationMode).mockResolvedValue({ auth_mode: "none", reauthentication_required: true });
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("combobox", { name: "Authentication mode" }));
    await user.click(screen.getByRole("option", { name: "No authentication" }));

    expect(await screen.findByText(/sambee will not authenticate users/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate No authentication" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Activate No authentication" }));

    expect(api.activateAuthenticationMode).toHaveBeenCalledWith("none", true);
    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
  });

  it("disables the non-OIDC activation button when the selected mode is already active", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      ...response(configuration("Active Provider")),
      configuration: null,
      auth_mode: "none",
    });
    window.location.hash = "";
    renderSettings();

    expect(await screen.findByText(/sambee will not authenticate users/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate No authentication" })).toBeDisabled();
  });

  it("allows a config-file-sourced active mode to be activated from the UI", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      ...response(configuration("Active Provider")),
      configuration: null,
      auth_mode: "none",
      auth_mode_source: "config_file",
    });
    window.location.hash = "";
    renderSettings();

    expect(await screen.findByText(/sambee will not authenticate users/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate No authentication" })).toBeEnabled();
  });

  it("activates an approved OIDC configuration without a native confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 1,
      reauthentication_required: false,
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    expect(await screen.findByText("Admission: Allowed")).toBeInTheDocument();
    expect(screen.getByText("Matching admission group: sambee-users")).toBeInTheDocument();
    expect(screen.getByText("Account mapping does not override the admission policy.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activate configuration" }));

    await waitFor(() => expect(api.finalizeOidcConfiguration).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
  });

  it("reevaluates reviewed policy without another interactive provider test", async () => {
    const user = userEvent.setup();
    const initialCandidate = configuration("Tested Provider");
    const reviewedCandidate = { ...initialCandidate, sign_in_mode: "oidc_only" as const };
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult)
      .mockResolvedValueOnce(testedIdentity({ candidate: initialCandidate }))
      .mockResolvedValueOnce(testedIdentity({ candidate: reviewedCandidate, affected_account_count: 3 }));
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("combobox", { name: "Authentication mode" }));
    await user.click(screen.getByRole("option", { name: "OIDC only" }));

    await waitFor(() => expect(api.getOidcTestResult).toHaveBeenNthCalledWith(2, "test-flow", reviewedPolicy(reviewedCandidate)));
    expect(api.startOidcTest).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("test-flow");
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeEnabled();
  });

  it("blocks activation when the tested identity does not pass admission", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity({ admitted: false }));
    window.location.hash = "flow=test-flow";
    renderSettings();

    expect(await screen.findByText("Admission: Denied")).toBeInTheDocument();
    expect(screen.getByText(/must pass the admission rule/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeDisabled();
  });

  it("refreshes a stale mapping review using the same tested flow", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult)
      .mockResolvedValueOnce(testedIdentity({ expected_identity_mapping_revision: 1 }))
      .mockResolvedValueOnce(testedIdentity({ expected_identity_mapping_revision: 2 }));
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: { status: 409, data: { detail: "oidc_mapping_review_stale" } },
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));

    expect(await screen.findByText(/review the refreshed mappings/i)).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenNthCalledWith(2, "test-flow", reviewedPolicy(configuration("Tested Provider")));
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("test-flow");
  });

  it("discards a tested flow when the configuration changed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: { status: 409, data: { detail: "oidc_configuration_changed" } },
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));

    expect(await screen.findByText(/configuration changed after this test/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
    expect(screen.queryByText("Tested identity")).not.toBeInTheDocument();
  });

  it("cancels the server flow and clears tab-scoped setup state", async () => {
    const user = userEvent.setup();
    window.location.hash = "flow=test-flow";
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "test-flow",
      candidate: configuration("Tested Provider"),
      replacement_mappings: [],
      expected_identity_mapping_revision: 1,
      admitted: true,
      matching_admission_group: "sambee-users",
      affected_account_count: 1,
      acting_administrator_affected: true,
      username: "admin",
      name: null,
      email: null,
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });
    vi.mocked(api.cancelOidcTestFlow).mockResolvedValue();
    renderSettings();

    expect(await screen.findByDisplayValue("Tested Provider")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.cancelOidcTestFlow).toHaveBeenCalledWith("test-flow");
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
    expect(await screen.findByText("OIDC setup canceled.")).toBeInTheDocument();
  });

  it("requires review of unique replacement usernames", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
      admitted: true,
      matching_admission_group: "sambee-users",
      affected_account_count: 2,
      acting_administrator_affected: true,
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
      reviewedPolicy(configuration("New Provider")),
      [
        { target_user_id: "user-1", expected_username: "reviewed-alice" },
        { target_user_id: "user-2", expected_username: "provider-alice" },
      ],
      4,
      []
    );
  });

  it("allows selected account mappings without a claim acknowledgement", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const candidate = configuration("New Provider");
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Old Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(
      testedIdentity({
        candidate,
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
        ],
      })
    );
    window.location.hash = "flow=test-flow";

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));
    expect(api.finalizeOidcConfiguration).toHaveBeenCalled();
  });

  it("retries the same finalization after a lost response and accepts its completion receipt", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValueOnce({ message: "Network unavailable" }).mockResolvedValueOnce({
      configuration_revision: 3,
      identity_mapping_revision: 2,
      reauthentication_required: true,
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));

    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.finalizeOidcConfiguration).mock.calls[1]).toEqual(vi.mocked(api.finalizeOidcConfiguration).mock.calls[0]);
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
  });

  it("retains the tested flow when repeated finalization responses are ambiguous", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({ message: "Network unavailable" });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));

    expect(await screen.findByText(/activation may have completed/i)).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("test-flow");
    expect(screen.getByText("Tested identity")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect and test" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remap all OIDC accounts" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Authentication mode" })).toHaveAttribute("aria-disabled", "true");
  });

  it("replays a persisted finalization before loading configuration after reload", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({ message: "Network unavailable" });
    window.location.hash = "flow=test-flow";
    const firstView = renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));
    expect(await screen.findByText(/activation may have completed/i)).toBeInTheDocument();
    const persistedRequest = sessionStorage.getItem("sambee.oidc.pendingFinalization");
    expect(persistedRequest).not.toBeNull();
    const originalFinalizationArguments = vi.mocked(api.finalizeOidcConfiguration).mock.calls[0];
    firstView.unmount();

    vi.clearAllMocks();
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 2,
      reauthentication_required: true,
    });
    renderSettings();

    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.finalizeOidcConfiguration).mock.calls[0]).toEqual(originalFinalizationArguments);
    expect(api.getOidcConfiguration).not.toHaveBeenCalled();
    expect(api.getOidcTestResult).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
  });

  it("discards malformed pending finalization state and restores the tested preview", async () => {
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem("sambee.oidc.pendingFinalization", JSON.stringify({ flow_id: "stored-flow", replacement_mappings: "invalid" }));
    window.location.hash = "";
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity({ flow_id: "stored-flow" }));

    renderSettings();

    expect(await screen.findByText("Tested identity")).toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).not.toHaveBeenCalled();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("stored-flow", undefined);
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
  });

  it("retains pending finalization state when receipt recovery requires reauthentication", async () => {
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem(
      "sambee.oidc.pendingFinalization",
      JSON.stringify({
        flow_id: "stored-flow",
        reviewed_policy: reviewedPolicy(configuration("Tested Provider")),
        replacement_mappings: [],
        expected_identity_mapping_revision: 1,
        omitted_account_acknowledgements: [],
      })
    );
    window.location.hash = "";
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({ response: { status: 401 } });

    renderSettings();

    await waitFor(() => expect(api.finalizeOidcConfiguration).toHaveBeenCalled());
    expect(api.getOidcConfiguration).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).not.toBeNull();
  });

  it("refreshes an authoritative mapping review after a stale persisted finalization", async () => {
    const pendingCandidate = configuration("Tested Provider");
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem("sambee.oidc.reviewedPolicy", JSON.stringify(reviewedPolicy(pendingCandidate)));
    sessionStorage.setItem(
      "sambee.oidc.pendingFinalization",
      JSON.stringify({
        flow_id: "stored-flow",
        reviewed_policy: reviewedPolicy(pendingCandidate),
        replacement_mappings: [],
        expected_identity_mapping_revision: 1,
        omitted_account_acknowledgements: [],
      })
    );
    window.location.hash = "";
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: { status: 409, data: { detail: "oidc_mapping_review_stale" } },
    });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity({ flow_id: "stored-flow", expected_identity_mapping_revision: 2 }));

    renderSettings();

    expect(await screen.findByText(/review the refreshed mappings/i)).toBeInTheDocument();
    expect(api.getOidcTestResult).toHaveBeenCalledWith("stored-flow", reviewedPolicy(pendingCandidate));
    expect(screen.getByRole("button", { name: "Activate configuration" })).toBeEnabled();
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("stored-flow");
  });

  it("discards obsolete setup state after a changed-configuration persisted finalization", async () => {
    const pendingCandidate = configuration("Tested Provider");
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem("sambee.oidc.reviewedPolicy", JSON.stringify(reviewedPolicy(pendingCandidate)));
    sessionStorage.setItem(
      "sambee.oidc.pendingFinalization",
      JSON.stringify({
        flow_id: "stored-flow",
        reviewed_policy: reviewedPolicy(pendingCandidate),
        replacement_mappings: [],
        expected_identity_mapping_revision: 1,
        omitted_account_acknowledgements: [],
      })
    );
    window.location.hash = "";
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: { status: 409, data: { detail: "oidc_configuration_changed" } },
    });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));

    renderSettings();

    expect(await screen.findByText(/configuration changed after this test/i)).toBeInTheDocument();
    expect(api.getOidcTestResult).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
    expect(sessionStorage.getItem("sambee.oidc.reviewedPolicy")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect and test" })).toBeEnabled();
  });

  it("restores row validation errors from a persisted finalization", async () => {
    const pendingCandidate = configuration("Tested Provider");
    sessionStorage.setItem("sambee.oidc.setupFlowId", "stored-flow");
    sessionStorage.setItem("sambee.oidc.reviewedPolicy", JSON.stringify(reviewedPolicy(pendingCandidate)));
    sessionStorage.setItem(
      "sambee.oidc.pendingFinalization",
      JSON.stringify({
        flow_id: "stored-flow",
        reviewed_policy: reviewedPolicy(pendingCandidate),
        replacement_mappings: [{ target_user_id: "user-1", expected_username: "provider-alice" }],
        expected_identity_mapping_revision: 1,
        omitted_account_acknowledgements: [],
      })
    );
    window.location.hash = "";
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            errors: [
              {
                target_user_id: "user-1",
                field: "expected_username",
                error_code: "oidc_mapping_username_conflict",
                message: "Provider username is already mapped",
              },
            ],
          },
        },
      },
    });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(
      testedIdentity({
        flow_id: "stored-flow",
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
        ],
      })
    );

    renderSettings();

    expect(await screen.findByText("Provider username is already mapped")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider username for alice" })).toHaveAccessibleDescription(
      "Provider username is already mapped"
    );
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
  });

  it("keeps activation successful when the post-activation settings refresh fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration)
      .mockResolvedValueOnce(response(configuration("Active Provider")))
      .mockRejectedValueOnce({ message: "Network unavailable" });
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    vi.mocked(api.finalizeOidcConfiguration).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 2,
      reauthentication_required: false,
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));

    expect(await screen.findByText("Authentication configuration activated.")).toBeInTheDocument();
    expect(screen.getByText(/current settings could not be reloaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/activation may have completed/i)).not.toBeInTheDocument();
    expect(api.finalizeOidcConfiguration).toHaveBeenCalledTimes(1);
    expect(api.getOidcConfiguration).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("sambee.oidc.pendingFinalization")).toBeNull();
  });

  it("clears a server mapping error when the row is deselected", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(
      testedIdentity({
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
        ],
      })
    );
    vi.mocked(api.finalizeOidcConfiguration).mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            errors: [
              {
                target_user_id: "user-1",
                field: "expected_username",
                error_code: "oidc_mapping_username_conflict",
                message: "Provider username is already mapped",
              },
            ],
          },
        },
      },
    });
    window.location.hash = "flow=test-flow";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Activate configuration" }));
    expect(await screen.findByText("Provider username is already mapped")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Map alice" }));
    expect(screen.queryByText("Provider username is already mapped")).not.toBeInTheDocument();
  });

  it("returns to login without a privileged refresh after Password-only recovery", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.setPasswordOnlyAuthentication).mockResolvedValue({
      configuration_revision: 3,
      identity_mapping_revision: 1,
      reauthentication_required: true,
    });
    authSession.setAuthenticated({ access_token: "revoked-token", token_type: "bearer" }, false);
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("combobox", { name: "Authentication mode" }));
    await user.click(screen.getByRole("option", { name: "Password only" }));
    await user.click(await screen.findByRole("button", { name: "Activate Password-only mode" }));

    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
    expect(authSession.getAccessToken()).toBeNull();
    expect(api.getOidcConfiguration).toHaveBeenCalledTimes(1);
    expect(api.setPasswordOnlyAuthentication).toHaveBeenCalledWith(2, 2, true);
  });

  it("refreshes Password-only impact when the reviewed count is stale", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration)
      .mockResolvedValueOnce(response(configuration("Active Provider")))
      .mockResolvedValueOnce({ ...response(configuration("Active Provider")), active_passwordless_user_count: 3 });
    vi.mocked(api.setPasswordOnlyAuthentication).mockRejectedValue({
      response: { data: { detail: "passwordless_account_count_changed" }, status: 409 },
    });
    renderSettings();

    await user.click(await screen.findByRole("combobox", { name: "Authentication mode" }));
    await user.click(screen.getByRole("option", { name: "Password only" }));
    await user.click(await screen.findByRole("button", { name: "Activate Password-only mode" }));

    expect(
      await screen.findByText("Authentication settings changed. Review the current Password-only impact and confirm again.")
    ).toBeInTheDocument();
    expect(api.getOidcConfiguration).toHaveBeenCalledTimes(2);
  });

  it("shows a copyable redirect URI and toggles only the unsent client secret", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    const redirectUri = await screen.findByRole("textbox", { name: "Redirect URI" });
    expect(redirectUri).toHaveValue("https://sambee.example.test/api/auth/oidc/callback");
    await user.click(screen.getByRole("button", { name: "Copy redirect URI" }));
    expect(writeText).toHaveBeenCalledWith("https://sambee.example.test/api/auth/oidc/callback");

    const secret = screen.getByLabelText("Client secret");
    await user.type(secret, "unsent-secret");
    expect(secret).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show client secret" }));
    expect(secret).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide client secret" }));
    expect(secret).toHaveAttribute("type", "password");
  });

  it("retains a comma while editing scopes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    const scopes = await screen.findByRole("textbox", { name: "Scopes" });
    await user.click(scopes);
    await user.keyboard("{End},email");

    expect(scopes).toHaveValue("openid, profile, groups,email");
  });

  it("requires the openid scope before testing", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    const scopes = await screen.findByRole("textbox", { name: "Scopes" });
    await user.clear(scopes);
    await user.type(scopes, "aa");
    await user.tab();

    expect(await screen.findByText("Scopes must include openid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect and test" })).toBeDisabled();
  });

  it("shows the OIDC test validation error returned by the API", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard unavailable"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.startOidcTest).mockRejectedValue({
      response: { status: 400, data: { detail: "OIDC discovery issuer does not exactly match configuration" } },
    });
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Copy redirect URI" }));
    expect(await screen.findByText("The redirect URI could not be copied.")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Connect and test" }));

    const testErrorTitle = await screen.findByText("Connection test failed");
    const testError = testErrorTitle.closest('[role="alert"]');
    if (!testError) throw new Error("OIDC connection test error alert was not rendered.");
    expect(testError).toHaveTextContent("Connection test failed");
    expect(testError).toHaveTextContent("OIDC discovery issuer does not exactly match configuration");
    await waitFor(() => expect(testError).toHaveFocus());
    expect(screen.queryByText("The redirect URI could not be copied.")).not.toBeInTheDocument();
  });

  it("blocks testing for normalized group collisions and empty selected-group admission", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    const connect = await screen.findByRole("button", { name: "Connect and test" });
    expect(connect).toBeEnabled();
    await user.type(screen.getByRole("textbox", { name: "Editor groups" }), "ＳＡＭＢＥＥ－ＡＤＭＩＮＳ");
    expect(screen.getAllByText("A group cannot grant more than one role.")).toHaveLength(3);
    expect(connect).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Role assignment" }));
    await user.click(screen.getByRole("option", { name: "All users are assigned to the same role" }));
    expect(screen.queryByRole("textbox", { name: "Editor groups" })).not.toBeInTheDocument();
    expect(connect).toBeEnabled();

    await user.clear(screen.getByRole("textbox", { name: "Admission groups" }));
    expect(
      screen.getByText("Members of these groups can sign in. Enter at least one group name. Separate multiple groups by commas.")
    ).toBeInTheDocument();
    expect(connect).toBeDisabled();
  });

  it("shows advanced claims and group mappings in role assignment", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    window.location.hash = "";
    renderSettings();

    expect(await screen.findByRole("heading", { name: "Advanced claims" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Username claim" })).toHaveValue("preferred_username");
    expect(
      screen.getByText("Only members of these identity-provider groups can sign in. Enter exact group names, separated by commas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Viewer groups" })).toBeInTheDocument();
  });

  it("discards the validated flow when a provider-bound claim changes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue(testedIdentity());
    window.location.hash = "flow=test-flow";
    renderSettings();

    await screen.findByText("Tested identity");
    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBe("test-flow");
    await user.clear(screen.getByRole("textbox", { name: "Username claim" }));
    await user.type(screen.getByRole("textbox", { name: "Username claim" }), "email");

    expect(sessionStorage.getItem("sambee.oidc.setupFlowId")).toBeNull();
    expect(sessionStorage.getItem("sambee.oidc.reviewedPolicy")).toBeNull();
    expect(screen.queryByText("Tested identity")).not.toBeInTheDocument();
  });

  it("warns when an active passwordless account is omitted in OIDC or password mode", async () => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.getOidcTestResult).mockResolvedValue({
      flow_id: "test-flow",
      candidate: configuration("Active Provider"),
      replacement_mappings: [
        {
          target_user_id: "user-1",
          local_username: "alice",
          local_role: "viewer",
          has_local_password: false,
          target_state: "active",
          mapping_state: "unmapped",
          suggested_username: "alice",
          prefill_source: "local",
          selected_by_default: false,
          selectable: true,
          omission_acknowledgement_required: false,
        },
      ],
      expected_identity_mapping_revision: 1,
      admitted: true,
      matching_admission_group: "sambee-users",
      affected_account_count: 1,
      acting_administrator_affected: true,
      username: "admin",
      name: null,
      email: null,
      groups: ["sambee-admins"],
      expires_at: "2099-01-01T00:00:00Z",
    });
    window.location.hash = "flow=test-flow";

    renderSettings();

    expect(await screen.findByText(/active passwordless account is omitted/i)).toBeInTheDocument();
    expect(screen.getByText(/may collide with an existing username or create a separate account/i)).toBeInTheDocument();
  });

  it("starts an explicit remap-all test flow", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue(response(configuration("Active Provider")));
    vi.mocked(api.startOidcTest).mockImplementation(() => new Promise(() => undefined));
    window.location.hash = "";
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Remap all OIDC accounts" }));

    expect(api.startOidcTest).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Active Provider" }), true);
  });
});
