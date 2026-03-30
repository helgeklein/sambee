import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import { UserManagementSettings } from "../UserManagementSettings";

vi.mock("../../services/api", () => ({
  default: {
    getUsers: vi.fn(),
    getCurrentUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

import api from "../../services/api";

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
        created_at: "2026-03-01T10:00:00Z",
      },
    ]);
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: "user-1",
      username: "admin",
      role: "admin",
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
    const passwordInput = screen.getByLabelText(/initial password/i);

    expect(usernameInput.closest(".MuiOutlinedInput-root")).not.toBeNull();
    expect(roleSelect.closest(".MuiOutlinedInput-root")).not.toBeNull();
    expect(passwordInput.closest(".MuiOutlinedInput-root")).not.toBeNull();

    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
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

    const passwordInput = await screen.findByLabelText(/new password/i);
    expect(passwordInput).toBeInTheDocument();

    await user.type(passwordInput, "BrandNewPass123!");
    await user.click(screen.getByRole("checkbox", { name: /require password change after next sign-in/i }));

    await user.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => {
      expect(api.resetUserPassword).toHaveBeenCalledWith("user-1", {
        new_password: "BrandNewPass123!",
        must_change_password: false,
      });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    });
  });

  it("disables reset-password editor actions while the request is pending", async () => {
    const user = userEvent.setup();
    let resolveReset: ((value: { message: string }) => void) | null = null;
    vi.mocked(api.resetUserPassword).mockReturnValue(
      new Promise((resolve) => {
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
    await user.type(await screen.findByLabelText(/new password/i), "BrandNewPass123!");
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

    resolveReset?.({
      message: "Password reset",
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    });
  });

  it("keeps the create-user label visible while the save request is pending", async () => {
    const user = userEvent.setup();
    let resolveCreateUser: ((value: { username: string; temporary_password?: string | null; message?: string }) => void) | null = null;
    vi.mocked(api.createUser).mockReturnValue(
      new Promise((resolve) => {
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

    resolveCreateUser?.({
      username: "new-admin",
      temporary_password: null,
    });
  });
});
