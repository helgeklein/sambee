import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import type { AdminUserCreateResult, AdminUserPasswordResetResult } from "../../types";
import { UserManagementSettings } from "../UserManagementSettings";

vi.mock("../../services/api", () => ({
  default: {
    getUsers: vi.fn(),
    getCurrentUser: vi.fn(),
    getOidcConfiguration: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

import api from "../../services/api";

function mockViewportWidth(width: number) {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minWidth = Number(query.match(/min-width:\s*([\d.]+)px/)?.[1]);
    const maxWidth = Number(query.match(/max-width:\s*([\d.]+)px/)?.[1]);
    const matches = (Number.isNaN(minWidth) || width >= minWidth) && (Number.isNaN(maxWidth) || width <= maxWidth);

    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

describe("UserManagementSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "admin",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: null,
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
    ]);
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: "user-1",
      username: "admin",
      role: "admin",
    });
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      configuration: null,
      health: { status: "healthy", public_url_configured: false, public_url: null, redirect_uri: null, reasons: [] },
      active_passwordless_user_count: 0,
      auth_mode: "password_only",
      auth_enforcement_disabled: false,
    });
    vi.mocked(api.resetUserPassword).mockResolvedValue({
      message: "Password reset",
    });
  });

  it("opens the create-user dialog with outlined form controls", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getUsers).toHaveBeenCalled();
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /add user/i }));

    const usernameInput = await screen.findByLabelText(/username/i);
    const roleSelect = screen.getByRole("combobox", { name: /role/i });
    const passwordInput = screen.getByLabelText(/^initial password$/i);

    expect(usernameInput.closest(".MuiOutlinedInput-root")).not.toBeNull();
    expect(roleSelect.closest(".MuiOutlinedInput-root")).not.toBeNull();
    expect(roleSelect).toHaveTextContent("Editor");
    expect(passwordInput.closest(".MuiOutlinedInput-root")).not.toBeNull();

    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
  });

  it("uses external descriptions and grouped sections in the desktop add-user editor", async () => {
    const restoreViewport = mockViewportWidth(1200);
    const user = userEvent.setup();

    try {
      render(
        <SambeeThemeProvider>
          <UserManagementSettings />
        </SambeeThemeProvider>
      );

      await waitFor(() => {
        expect(api.getUsers).toHaveBeenCalled();
        expect(api.getCurrentUser).toHaveBeenCalled();
      });

      await user.click(screen.getByRole("button", { name: /add user/i }));

      expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^full name$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /^role$/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/expiration time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^initial password$/i)).toBeInTheDocument();

      const descriptions = [
        "Unique sign-in name",
        "Displayed account name",
        "Optional contact email",
        "Choose an access level",
        "Leave blank for no expiration",
        "If left blank, the server will generate a secure temporary password",
        "Prompt for a new password at next sign-in",
      ];

      for (const description of descriptions) {
        expect(screen.getByText(description)).not.toHaveClass("MuiFormHelperText-root");
      }

      const formSurface = screen.getByTestId("user-editor-form-surface");
      expect(formSurface).toContainElement(screen.getByTestId("user-editor-identity-fields"));
      expect(screen.getByRole("heading", { name: "Access", level: 2 })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Credentials", level: 2 })).toBeInTheDocument();
    } finally {
      restoreViewport();
    }
  });

  it("uses consistent field descriptions in the edit-user editor", async () => {
    const restoreViewport = mockViewportWidth(1200);
    const user = userEvent.setup();

    try {
      render(
        <SambeeThemeProvider>
          <UserManagementSettings />
        </SambeeThemeProvider>
      );

      await user.click(await screen.findByRole("button", { name: /edit admin/i }));

      expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /^role$/i })).toBeInTheDocument();
      expect(screen.getByText("Optional contact email")).not.toHaveClass("MuiFormHelperText-root");
      expect(screen.getByText("Choose an access level")).not.toHaveClass("MuiFormHelperText-root");
      expect(screen.getByText("Disabled accounts cannot sign in")).not.toHaveClass("MuiFormHelperText-root");
      expect(screen.getByText("On")).toBeInTheDocument();
      expect(screen.getByLabelText(/account is active: on/i)).toBeDisabled();
      expect(screen.queryByText("Update account details and access level. Password resets are handled separately")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Credentials", level: 2 })).not.toBeInTheDocument();
    } finally {
      restoreViewport();
    }
  });

  it("keeps floating labels and helper text in the narrow dialog layout", async () => {
    const restoreViewport = mockViewportWidth(800);

    try {
      const user = userEvent.setup();
      render(
        <SambeeThemeProvider>
          <UserManagementSettings />
        </SambeeThemeProvider>
      );

      await user.click(await screen.findByRole("button", { name: /add user/i }));

      const usernameLabel = screen.getByText("Username", { selector: "label" });
      const usernameInput = screen.getByLabelText(/username/i);

      expect(screen.queryByTestId("responsive-form-dialog-mobile-actions")).not.toBeInTheDocument();
      expect(document.querySelector(".MuiDialog-paperWidthSm")).not.toBeNull();
      expect(usernameLabel).toHaveClass("MuiInputLabel-root");
      expect(usernameInput.parentElement).not.toHaveClass("MuiInputBase-sizeSmall");
      expect(screen.getByText("Unique sign-in name")).toHaveClass("MuiFormHelperText-root");
    } finally {
      restoreViewport();
    }
  });

  it("uses compact desktop controls and focuses the first invalid user-editor field", async () => {
    const restoreViewport = mockViewportWidth(1200);

    try {
      const user = userEvent.setup();
      render(
        <SambeeThemeProvider>
          <UserManagementSettings />
        </SambeeThemeProvider>
      );

      await user.click(await screen.findByRole("button", { name: /add user/i }));

      const usernameInput = screen.getByLabelText(/username/i);
      expect(screen.getByText("Username", { selector: "label" })).toHaveAttribute("for", "user-editor-username");
      expect(usernameInput.parentElement).toHaveClass("MuiInputBase-sizeSmall");
      expect(screen.getByText("Unique sign-in name")).not.toHaveClass("MuiFormHelperText-root");

      await user.click(screen.getByRole("button", { name: /create user/i }));

      await waitFor(() => {
        expect(usernameInput).toHaveFocus();
        expect(usernameInput).toHaveAttribute("aria-describedby", "user-editor-username-description");
        expect(screen.getByText("Username is required")).not.toHaveClass("MuiFormHelperText-root");
      });
    } finally {
      restoreViewport();
    }
  });

  it("shows the OIDC role assignment only for linked users", async () => {
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "admin",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: { identity_id: "identity-1", provider_display_name: "Corporate login", last_login_at: null },
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
    ]);
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: /edit admin/i }));

    expect(screen.getByRole("combobox", { name: /oidc role assignment/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByLabelText(/initial password/i)).not.toBeInTheDocument();
  });

  it("shows role-specific descriptions and supports password visibility and password-change state", async () => {
    const user = userEvent.setup();
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: /add user/i }));

    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    await user.click(roleSelect);
    expect(await screen.findByText("Modify content")).toBeInTheDocument();
    expect(screen.getByText("Browse content")).toBeInTheDocument();
    expect(screen.getByText("Manage settings, users, and content")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const passwordInput = screen.getByLabelText(/^initial password$/i);
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /show initial password/i }));
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: /hide initial password/i })).toBeInTheDocument();

    const passwordChangeSwitch = screen.getByLabelText(/require password change after next sign-in/i);
    expect(screen.getByText("On")).toBeInTheDocument();
    await user.click(passwordChangeSwitch);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("renders user names as bold body text instead of headings", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const userName = await screen.findByText("admin", { exact: true });

    expect(screen.queryByRole("heading", { name: "admin" })).not.toBeInTheDocument();
    expect(userName.tagName).toBe("DIV");
    expect(userName).toHaveClass("MuiTypography-body1");
    expect(window.getComputedStyle(userName).fontWeight).toBe("600");
  });

  it("uses flex gaps when user-status chips wrap", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const localPasswordChip = await screen.findByText("Local password", { exact: true });
    const chipRow = localPasswordChip.closest(".MuiStack-root");

    expect(chipRow).toHaveStyle({ display: "flex", flexWrap: "wrap", gap: "8px", rowGap: "8px" });
  });

  it("keeps metadata and actions responsive within each user row", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const userRow = await screen.findByTestId("user-row");
    const metadata = screen.getByTestId("user-metadata");
    const actions = screen.getByTestId("user-row-actions");
    const compactActionMenu = screen.getByTestId("user-row-action-menu");

    expect(userRow).toHaveStyle({ containerType: "inline-size", display: "flex", flexWrap: "wrap" });
    expect(metadata).toHaveStyle({ flexWrap: "wrap" });
    expect(actions).toHaveStyle({ display: "flex" });
    expect(compactActionMenu).toHaveStyle({ display: "none" });
  });

  it("provides compact user actions through one overflow menu", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const compactActionMenu = await screen.findByTestId("user-row-action-menu");
    fireEvent.click(within(compactActionMenu).getByRole("button", { hidden: true, name: "User actions for admin" }));

    expect(screen.getByRole("menuitem", { name: /^edit user$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^reset password$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^delete user$/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows OIDC state and hides password reset for a passwordless account", async () => {
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "admin",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: null,
        oidc: {
          identity_id: "identity-1",
          provider_display_name: "Corporate login",
          last_login_at: "2026-03-01T10:00:00Z",
        },
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
    ]);

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByText(/OIDC linked: Corporate login/)).toBeInTheDocument();
    expect(screen.getByText(`OIDC last login: ${new Date("2026-03-01T10:00:00Z").toLocaleString()}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset password/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Local password")).not.toBeInTheDocument();
  });

  it("allows pending mapping actions without a claim acknowledgement", async () => {
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "linked-admin",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: { identity_id: "identity-1", provider_display_name: "Corporate login", last_login_at: null },
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
      {
        id: "user-2",
        username: "unmapped-user",
        role: "viewer",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: null,
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
    ]);
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      configuration: {
        display_name: "Corporate login",
        issuer_url: "https://idp.example.test",
        client_id: "sambee",
        client_secret_configured: true,
        scopes: ["openid", "groups"],
        username_claim: "preferred_username",
        name_claim: "name",
        email_claim: "email",
        groups_claim: "groups",
        sign_in_mode: "oidc_or_password",
        interactive_reauthentication_max_age_days: 30,
        admission_mode: "selected_groups",
        admission_groups: ["users"],
        role_assignment_mode: "uniform",
        uniform_role: "editor",
        role_mappings: { admin: ["admins"], editor: [], viewer: [] },
        configuration_revision: 2,
        identity_mapping_revision: 1,
      },
      active_passwordless_user_count: 0,
      auth_mode: "oidc_or_password",
      auth_enforcement_disabled: false,
      health: {
        public_url_configured: true,
        public_url: "https://sambee.example.test",
        redirect_uri: "https://sambee.example.test/api/auth/oidc/callback",
        status: "healthy",
        reasons: [],
      },
    });

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByRole("button", { name: "Change OIDC account for linked-admin" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Map OIDC account for unmapped-user" })).toBeEnabled();
  });

  it("lets the admin enter a new password for a reset", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getUsers).toHaveBeenCalled();
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /reset password for admin/i }));

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(screen.getByText("Choose the password the user should use at next sign-in")).toHaveClass("MuiFormHelperText-root");

    await user.click(screen.getByRole("button", { name: /show new password/i }));
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: /hide new password/i })).toBeInTheDocument();

    await user.type(passwordInput, "BrandNewPass123!");
    expect(screen.getByText("On")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/require password change after next sign-in/i));
    expect(screen.getByText("Off")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => {
      expect(api.resetUserPassword).toHaveBeenCalledWith("user-1", {
        new_password: "BrandNewPass123!",
        must_change_password: false,
      });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    });
  });

  it("disables reset-password editor actions while the request is pending", async () => {
    const user = userEvent.setup();
    let resolveReset!: (value: AdminUserPasswordResetResult) => void;
    vi.mocked(api.resetUserPassword).mockReturnValue(
      new Promise<AdminUserPasswordResetResult>((resolve) => {
        resolveReset = resolve;
      })
    );

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getUsers).toHaveBeenCalled();
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /reset password for admin/i }));
    await user.type(await screen.findByLabelText(/^new password$/i), "BrandNewPass123!");
    await user.click(await screen.findByRole("button", { name: /set password/i }));

    await waitFor(() => {
      expect(api.resetUserPassword).toHaveBeenCalledWith("user-1", {
        new_password: "BrandNewPass123!",
        must_change_password: true,
      });
    });

    expect(screen.getByRole("button", { name: /set password/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolveReset({
      message: "Password reset",
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    });
  });

  it("keeps the create-user label visible while the save request is pending", async () => {
    const user = userEvent.setup();
    let resolveCreateUser!: (value: AdminUserCreateResult) => void;
    vi.mocked(api.createUser).mockReturnValue(
      new Promise<AdminUserCreateResult>((resolve) => {
        resolveCreateUser = resolve;
      })
    );

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(api.getUsers).toHaveBeenCalled();
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /add user/i }));
    await user.type(await screen.findByLabelText(/username/i), "new-admin");

    await user.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith({
        username: "new-admin",
        name: undefined,
        email: undefined,
        role: "editor",
        must_change_password: true,
        password: undefined,
        expires_at: undefined,
      });
    });

    expect(screen.getByRole("button", { name: /create user/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /create user/i })).toHaveTextContent(/create user/i);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolveCreateUser({
      id: "user-2",
      username: "new-admin",
      role: "editor",
      is_active: true,
      must_change_password: true,
      has_local_password: true,
      oidc_role_assignment: null,
      oidc: null,
      pending_oidc: null,
      created_at: "2026-03-01T10:00:00Z",
      updated_at: "2026-03-01T10:00:00Z",
      temporary_password: null,
    });
  });
});
