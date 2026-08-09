import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedAsyncData,
  clearCachedAsyncDataByPrefix,
  getCachedAsyncData,
  primeCachedAsyncData,
} from "../../hooks/useCachedAsyncData";
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
  isControlledReauthenticationInProgress: vi.fn(),
}));

import api, { isControlledReauthenticationInProgress } from "../../services/api";

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

async function openUserActions(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(await screen.findByRole("button", { name: `User actions for ${username}` }));
}

describe("UserManagementSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    window.history.replaceState(null, "", window.location.pathname);
    vi.mocked(isControlledReauthenticationInProgress).mockReturnValue(false);
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

  it("invalidates every cached directory query after a user mutation", async () => {
    const directoryCachePrefix = "settings-data/admin-users:";
    const firstDirectoryKey = `${directoryCachePrefix}{"page":1}`;
    const secondDirectoryKey = `${directoryCachePrefix}{"page":2}`;
    const unrelatedKey = "settings-data/current-user";
    await Promise.all([
      primeCachedAsyncData(firstDirectoryKey, async () => "first"),
      primeCachedAsyncData(secondDirectoryKey, async () => "second"),
      primeCachedAsyncData(unrelatedKey, async () => "unrelated"),
    ]);

    clearCachedAsyncDataByPrefix(directoryCachePrefix);

    expect(getCachedAsyncData(firstDirectoryKey)).toBeNull();
    expect(getCachedAsyncData(secondDirectoryKey)).toBeNull();
    expect(getCachedAsyncData(unrelatedKey)).toBe("unrelated");
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

  it("marks the current account in the user title instead of metadata", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const userRow = await screen.findByTestId("user-row");
    expect(userRow).toHaveTextContent("admin (you)");
    expect(within(screen.getByTestId("user-metadata")).queryByText("You", { exact: true })).not.toBeInTheDocument();
  });

  it("shows the username beneath a local account without a full name", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const username = await screen.findByText("admin", { exact: true });
    expect(username).toHaveClass("MuiTypography-body2");
  });

  it("uses the inline bold username confirmation when deleting another user", async () => {
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
      {
        id: "user-2",
        username: "other-user",
        role: "viewer",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: null,
        oidc: null,
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

    await openUserActions(user, "other-user");
    await user.click(await screen.findByRole("menuitem", { name: "Delete user" }));

    const deleteDialog = screen.getByRole("dialog", { name: "Delete User" });
    expect(within(deleteDialog).getByText("other-user", { exact: true }).tagName).toBe("STRONG");
    expect(within(deleteDialog).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["oidc_only", "none"] as const)("hides local-user and password controls in %s mode", async (authMode) => {
    vi.mocked(api.getOidcConfiguration).mockResolvedValue({
      configuration: null,
      health: { status: "healthy", public_url_configured: false, public_url: null, redirect_uri: null, reasons: [] },
      active_passwordless_user_count: 0,
      auth_mode: authMode,
      auth_enforcement_disabled: false,
    });

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await screen.findByText("admin (you)", { exact: true });

    expect(screen.queryByRole("button", { name: /add user/i })).not.toBeInTheDocument();
    await openUserActions(userEvent.setup(), "admin");
    expect(screen.queryByRole("menuitem", { name: /reset password/i })).not.toBeInTheDocument();
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

  it("uses the role selector and read-only identity fields for linked OIDC users", async () => {
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "admin",
        name: "OIDC Admin",
        email: "admin@example.test",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: { identity_id: "identity-1", provider_display_name: "Corporate login", last_login_at: null, inherited_role: "editor" },
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

    expect(screen.getByRole("combobox", { name: /^role$/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("combobox", { name: /oidc role assignment/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^full name$/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^email$/i)).toHaveAttribute("readonly");
    expect(screen.getAllByText("Managed by the linked OIDC provider")).toHaveLength(2);
    expect(screen.queryByLabelText(/initial password/i)).not.toBeInTheDocument();
  });

  it("shows the inherited OIDC role and clears an individual override", async () => {
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
      {
        id: "user-2",
        username: "oidc-user",
        name: "OIDC User",
        email: "oidc-user@example.test",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: "admin",
        oidc: { identity_id: "identity-2", provider_display_name: "Corporate login", last_login_at: null, inherited_role: "viewer" },
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

    await user.click(await screen.findByRole("button", { name: "Edit oidc-user" }));

    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    expect(roleSelect).toHaveTextContent("Admin");
    await user.click(roleSelect);
    expect(await screen.findByRole("option", { name: /inherited \(viewer\)/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^viewer browse content$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /inherited \(viewer\)/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.updateUser).toHaveBeenCalledWith("user-2", {
        username: "oidc-user",
        role: "viewer",
        oidc_role_assignment: null,
        is_active: true,
        expires_at: null,
      });
    });
  });

  it("does not offer an inherited role for a pending OIDC mapping", async () => {
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
      {
        id: "user-2",
        username: "pending-user",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: "admin",
        oidc: null,
        pending_oidc: {
          expected_username: "provider-user",
          created_by_username: "admin",
          created_at: "2026-03-01T10:00:00Z",
        },
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

    await user.click(await screen.findByRole("button", { name: "Edit pending-user" }));
    await user.click(screen.getByRole("combobox", { name: /^role$/i }));

    expect(screen.queryByRole("option", { name: /inherited/i })).not.toBeInTheDocument();
    expect(
      screen.getByText("Choose an individual override. The provider-derived role will be available after the user's next OIDC sign-in")
    ).toBeInTheDocument();
  });

  it("does not offer an inherited role until a linked OIDC account has a verified role", async () => {
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
      {
        id: "user-2",
        username: "unresolved-oidc-user",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: "admin",
        oidc: { identity_id: "identity-2", provider_display_name: "Corporate login", last_login_at: null, inherited_role: null },
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

    await user.click(await screen.findByRole("button", { name: "Edit unresolved-oidc-user" }));
    await user.click(screen.getByRole("combobox", { name: /^role$/i }));

    expect(screen.queryByRole("option", { name: /inherited/i })).not.toBeInTheDocument();
  });

  it("reports an existing username while editing", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: /add user/i }));
    await user.type(await screen.findByRole("textbox", { name: /^username$/i }), "admin");

    expect(screen.getByText("A user with that username already exists")).toBeInTheDocument();
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

    const userName = await screen.findByText("admin (you)", { exact: true });

    expect(screen.queryByRole("heading", { name: "admin (you)" })).not.toBeInTheDocument();
    expect(userName.tagName).toBe("DIV");
    expect(userName).toHaveClass("MuiTypography-body1");
    expect(window.getComputedStyle(userName).fontWeight).toBe("600");
  });

  it("uses sortable column headers instead of a sort dropdown", async () => {
    const restoreViewport = mockViewportWidth(1200);
    const user = userEvent.setup();

    try {
      render(
        <SambeeThemeProvider>
          <UserManagementSettings />
        </SambeeThemeProvider>
      );

      const header = await screen.findByTestId("user-directory-header");
      const roleSort = within(header).getByRole("button", { name: "Sort by Role" });

      expect(screen.queryByRole("combobox", { name: "Sort" })).not.toBeInTheDocument();
      await user.click(roleSort);
      await waitFor(() => {
        expect(
          within(screen.getByTestId("user-directory-header"))
            .getByRole("button", { name: "Sort by Role, ascending" })
            .closest('[role="columnheader"]')
        ).toHaveAttribute("aria-sort", "ascending");
      });

      await user.click(within(screen.getByTestId("user-directory-header")).getByRole("button", { name: "Sort by Role, ascending" }));
      await waitFor(() => {
        expect(
          within(screen.getByTestId("user-directory-header"))
            .getByRole("button", { name: "Sort by Role, descending" })
            .closest('[role="columnheader"]')
        ).toHaveAttribute("aria-sort", "descending");
      });
    } finally {
      restoreViewport();
    }
  });

  it("groups filters behind one control and exposes applied filters as removable chips", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: "Filters" }));
    expect(screen.getByText("Account", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Sign-in", { exact: true }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: /Admin/ }));

    expect(await screen.findByText("Role: Admin", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (1)", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters", hidden: true })).toBeInTheDocument();
  });

  it("uses wrapped compact exception-status chips", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const activeChip = await screen.findByText("Active", { exact: true });
    const chipRow = activeChip.closest(".MuiStack-root");

    expect(chipRow).toHaveStyle({ display: "flex" });
  });

  it("keeps compact metadata and actions within each directory row", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    const userRow = await screen.findByTestId("user-row");
    const metadata = screen.getByTestId("user-metadata");
    const actions = screen.getByTestId("user-row-actions");

    expect(userRow).toHaveStyle({ display: "grid" });
    expect(metadata).toHaveStyle({ flexWrap: "wrap" });
    expect(actions).toHaveStyle({ display: "flex" });
  });

  it("provides compact user actions through one overflow menu", async () => {
    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await openUserActions(userEvent.setup(), "admin");

    expect(screen.queryByRole("menuitem", { name: /^edit user$/i })).not.toBeInTheDocument();
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
      {
        id: "user-2",
        username: "second-oidc-user",
        role: "viewer",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: null,
        oidc: {
          identity_id: "identity-2",
          provider_display_name: "Corporate login",
          last_login_at: null,
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

    expect((await screen.findAllByText("OIDC", { exact: true })).length).toBeGreaterThan(0);
    const localTimestamp = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date("2026-03-01T10:00:00Z"));
    expect(screen.getByText(localTimestamp)).toBeInTheDocument();
    expect(screen.getAllByText("second-oidc-user", { exact: true })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /reset password/i })).not.toBeInTheDocument();
  });

  it.each([
    ["oidc_only", "uniform"],
    ["oidc_or_password", "group_based"],
  ] as const)("renders directory identities in %s mode", async (authMode, roleAssignmentMode) => {
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "local-user",
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
      {
        id: "user-2",
        username: "inherited-user",
        role: "editor",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: null,
        oidc: { identity_id: "identity-2", provider_display_name: "Corporate login", last_login_at: null, inherited_role: "editor" },
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
      {
        id: "user-3",
        username: "override-user",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: "admin",
        oidc: { identity_id: "identity-3", provider_display_name: "Corporate login", last_login_at: null, inherited_role: "editor" },
        pending_oidc: null,
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
      {
        id: "user-4",
        username: "pending-user",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: "admin",
        oidc: null,
        pending_oidc: {
          expected_username: "pending-user",
          created_by_username: "local-user",
          created_at: "2026-03-01T10:00:00Z",
        },
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-01T10:00:00Z",
      },
      {
        id: "user-5",
        username: "unresolved-user",
        role: "editor",
        is_active: true,
        must_change_password: false,
        has_local_password: false,
        oidc_role_assignment: null,
        oidc: { identity_id: "identity-5", provider_display_name: "Corporate login", last_login_at: null, inherited_role: null },
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
        sign_in_mode: authMode,
        interactive_reauthentication_max_age_days: 30,
        admission_mode: "all_idp_users",
        admission_groups: [],
        role_assignment_mode: roleAssignmentMode,
        uniform_role: "editor",
        role_mappings: { admin: ["admins"], editor: ["editors"], viewer: ["viewers"] },
        auto_link_by_username: true,
        configuration_revision: 2,
        identity_mapping_revision: 1,
      },
      active_passwordless_user_count: 0,
      auth_mode: authMode,
      auth_enforcement_disabled: false,
      health: {
        public_url_configured: true,
        public_url: "https://sambee.example.test",
        redirect_uri: "https://sambee.example.test/api/auth/oidc/callback",
        status: "healthy",
        reasons: [],
      },
    });
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "user-1", username: "local-user", role: "admin" });

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByText("local-user", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("inherited-user", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("override-user", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("pending-user", { exact: true }).length).toBeGreaterThan(0);
  });

  it("suppresses the user-load error when controlled OIDC reauthentication has started", async () => {
    vi.mocked(api.getUsers).mockRejectedValue(new Error("OIDC sign-in is required"));
    vi.mocked(isControlledReauthenticationInProgress).mockReturnValue(true);

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(isControlledReauthenticationInProgress).toHaveBeenCalled();
    });

    expect(screen.queryByText("Failed to load users")).not.toBeInTheDocument();
  });

  it("uses the centralized OIDC mapping dialog and closes change and move workflows with Escape", async () => {
    const restoreViewport = mockViewportWidth(1200);
    vi.mocked(api.getUsers).mockResolvedValue([
      {
        id: "user-1",
        username: "linked-admin",
        role: "admin",
        is_active: true,
        must_change_password: false,
        has_local_password: true,
        oidc_role_assignment: null,
        oidc: {
          identity_id: "identity-1",
          user_id: "user-1",
          provider_display_name: "Corporate login",
          issuer: "https://idp.example.test",
          subject: "provider-subject-1",
          last_seen_username: "linked-admin",
          last_groups: ["admins"],
          created_at: "2026-03-01T10:00:00Z",
          last_login_at: null,
        },
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
        auto_link_by_username: true,
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
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: "other-admin",
      username: "other-admin",
      role: "admin",
    });
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await openUserActions(user, "unmapped-user");
    expect(screen.getByRole("menuitem", { name: "Map OIDC account" })).toBeEnabled();
    await user.keyboard("{Escape}");
    vi.mocked(api.getUsers).mockResolvedValue({
      items: [
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
      ],
      total: 1,
      summary: { total: 1, active_admins: 0, disabled: 0, expiring_soon: 0, pending_oidc: 0, unavailable_sign_in: 0 },
    });

    await openUserActions(user, "linked-admin");
    await user.click(screen.getByRole("menuitem", { name: "View OIDC identity details" }));
    const identityDetailsDialog = await screen.findByRole("dialog", { name: "OIDC identity details for linked-admin" });
    expect(identityDetailsDialog).toBeInTheDocument();
    const providerSubject = screen.getByLabelText("IdP subject");
    expect(screen.getByTestId("oidc-details-form-surface")).toContainElement(providerSubject);
    expect(providerSubject).toHaveValue("provider-subject-1");
    expect(providerSubject).toHaveAttribute("aria-describedby", "oidc-details-subject-description");
    expect(screen.getByText("Linked in Sambee")).not.toHaveClass("MuiInputLabel-root");
    expect(screen.getByText("When Sambee first linked this IdP identity to the account")).not.toHaveClass("MuiFormHelperText-root");
    expect(screen.queryByText("Sambee OIDC identity record ID")).not.toBeInTheDocument();
    expect(screen.queryByText("Sambee local user ID")).not.toBeInTheDocument();
    expect(screen.queryByText("Stored identity properties for linked-admin.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "OIDC identity details" })).not.toBeInTheDocument());

    await openUserActions(user, "linked-admin");
    expect(screen.getByRole("menuitem", { name: "Change OIDC account" })).toBeEnabled();
    await user.click(screen.getByRole("menuitem", { name: "Change OIDC account" }));
    const expectedUsername = await screen.findByLabelText("Expected provider username");
    expect(expectedUsername).toHaveFocus();
    expect(screen.getByTestId("oidc-mapping-editor-form-surface")).toContainElement(expectedUsername);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openUserActions(user, "linked-admin");
    await user.click(screen.getByRole("menuitem", { name: "Move identity to another local user" }));
    const targetAccount = await screen.findByLabelText("Move identity to");
    expect(targetAccount).toHaveFocus();
    expect(screen.getByTestId("oidc-mapping-editor-form-surface")).toContainElement(targetAccount);
    expect(screen.getByText("Search eligible active, unlinked local accounts by username, name, or email")).toBeInTheDocument();
    await waitFor(() =>
      expect(api.getUsers).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 100,
        q: undefined,
        states: ["active"],
        oidcStates: ["unlinked"],
      })
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    const mappingError = await screen.findByRole("alert");
    expect(mappingError).toHaveTextContent("Select an available local account.");
    expect(
      screen.getByTestId("oidc-mapping-editor-form-surface").compareDocumentPosition(mappingError) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await user.click(targetAccount);
    expect(await screen.findByRole("option", { name: "unmapped-user" })).toBeInTheDocument();
    await user.type(targetAccount, "unmapped");
    await waitFor(() =>
      expect(api.getUsers).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 100,
        q: "unmapped",
        states: ["active"],
        oidcStates: ["unlinked"],
      })
    );

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    restoreViewport();
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

    await openUserActions(user, "admin");
    await user.click(screen.getByRole("menuitem", { name: /reset password/i }));

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

  it("uses the centralized reset-password dialog and closes it with Escape", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <UserManagementSettings />
      </SambeeThemeProvider>
    );

    await openUserActions(user, "admin");
    await user.click(screen.getByRole("menuitem", { name: /reset password/i }));

    const passwordInput = await screen.findByLabelText(/^new password$/i);
    expect(passwordInput).toHaveFocus();
    expect(screen.getByTestId("reset-password-editor-form-surface")).toContainElement(passwordInput);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set password/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

    await openUserActions(user, "admin");
    await user.click(screen.getByRole("menuitem", { name: /reset password/i }));
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
