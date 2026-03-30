import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../types";
import ConnectionDialog from "../ConnectionDialog";

// Mock the API module
vi.mock("../../../services/api", () => ({
  default: {
    getCurrentUser: vi.fn(),
    getConnectionVisibilityOptions: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    testConnection: vi.fn(),
    testConnectionConfig: vi.fn(),
    deleteConnection: vi.fn(),
  },
}));

import api from "../../../services/api";

const mockVisibilityOptions = [
  {
    value: "private" as const,
    label: "Private to me",
    description: "Visible only to your account. You can fully manage it.",
    available: true,
    unavailable_reason: null,
  },
  {
    value: "shared" as const,
    label: "Shared with everyone",
    description: "Visible to all users. Only admins can manage it.",
    available: true,
    unavailable_reason: null,
  },
];

const mockConnection: Connection = {
  id: "1",
  name: "Test Server",
  type: "smb",
  host: "192.168.1.100",
  port: 445,
  share_name: "share1",
  username: "testuser",
  path_prefix: "/",
  scope: "shared",
  access_mode: "read_write",
  can_manage: true,
  created_at: "2024-01-01T00:00:00",
  updated_at: "2024-01-01T00:00:00",
};

describe("ConnectionDialog Component", () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: "user-id",
      username: "testuser",
      role: "regular",
      is_admin: false,
    });
    vi.mocked(api.getConnectionVisibilityOptions).mockResolvedValue(mockVisibilityOptions);
  });

  it("renders form fields for new connection", () => {
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    expect(screen.getByRole("heading", { name: /add connection/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/connection name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/share name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/user name/i)).toBeInTheDocument();
    // Password field - use getAllByLabelText and filter to get the input
    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT");
    expect(passwordInput).toBeInTheDocument();
    expect(screen.getByLabelText(/path prefix/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /access mode/i })).toBeInTheDocument();
  });

  it("shows server-defined visibility options", async () => {
    const user = userEvent.setup();

    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    const visibilitySelect = await screen.findByRole("combobox", { name: /visibility/i });
    expect(visibilitySelect).toBeInTheDocument();

    await user.click(visibilitySelect);

    expect(await screen.findByRole("option", { name: /private to me/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /shared with everyone/i })).toBeInTheDocument();
    expect(api.getConnectionVisibilityOptions).toHaveBeenCalled();
  });

  it("renders form with existing connection data in edit mode", () => {
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} connection={mockConnection} />);

    expect(screen.getByRole("heading", { name: /edit connection/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/connection name/i)).toHaveValue("Test Server");
    expect(screen.getByLabelText(/host/i)).toHaveValue("192.168.1.100");
    expect(screen.getByLabelText(/share name/i)).toHaveValue("share1");
    expect(screen.getByLabelText(/user name/i)).toHaveValue("testuser");
    // Password should be empty for security - use getAllByLabelText and filter
    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT") as HTMLInputElement;
    expect(passwordInput).toHaveValue("");
    expect(screen.getByLabelText(/path prefix/i)).toHaveValue("/");
    expect(screen.getByRole("combobox", { name: /access mode/i })).toHaveTextContent(/read and write/i);
  });

  it("validates required fields", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    // Try to save without filling any fields
    const saveButton = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveButton);

    // Should show validation errors
    await waitFor(() => {
      expect(screen.getByText(/connection name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/host is required/i)).toBeInTheDocument();
      expect(screen.getByText(/share name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/username is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });

    // Should not call API
    expect(api.createConnection).not.toHaveBeenCalled();
  });

  it("creates new connection with valid data", async () => {
    vi.mocked(api.createConnection).mockResolvedValueOnce(mockConnection);

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    // Fill in form - using paste() is faster than type() for known values
    await user.click(screen.getByLabelText(/connection name/i));
    await user.paste("New Server");

    await user.click(screen.getByLabelText(/host/i));
    await user.paste("192.168.1.200");

    await user.click(screen.getByLabelText(/share name/i));
    await user.paste("newshare");

    await user.click(screen.getByLabelText(/user name/i));
    await user.paste("newuser");

    // Get password input using getAllByLabelText
    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT") as HTMLElement;
    await user.click(passwordInput);
    await user.paste("newpass");

    // Save
    const saveButton = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(api.createConnection).toHaveBeenCalledWith({
        name: "New Server",
        type: "smb",
        host: "192.168.1.200",
        port: 445,
        share_name: "newshare",
        username: "newuser",
        password: "newpass",
        path_prefix: "/",
        scope: "private",
        access_mode: "read_write",
      });
    });

    expect(mockOnSave).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("updates existing connection", async () => {
    vi.mocked(api.updateConnection).mockResolvedValueOnce(mockConnection);

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} connection={mockConnection} />);

    // Change the name - using paste() is faster than type()
    const nameField = screen.getByLabelText(/connection name/i);
    await user.clear(nameField);
    await user.paste("Updated Server");

    // Save
    const saveButton = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(api.updateConnection).toHaveBeenCalledWith("1", {
        name: "Updated Server",
      });
    });

    expect(mockOnSave).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("updates access mode when changed", async () => {
    vi.mocked(api.updateConnection).mockResolvedValueOnce({
      ...mockConnection,
      access_mode: "read_only",
    });

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} connection={mockConnection} />);

    await user.click(screen.getByRole("combobox", { name: /access mode/i }));
    await user.click(await screen.findByRole("option", { name: /read only/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(api.updateConnection).toHaveBeenCalledWith("1", {
        access_mode: "read_only",
      });
    });
  });

  it("updates visibility when changed", async () => {
    vi.mocked(api.updateConnection).mockResolvedValueOnce({
      ...mockConnection,
      scope: "private",
    });

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} connection={mockConnection} />);

    await user.click(screen.getByRole("combobox", { name: /visibility/i }));
    await user.click(await screen.findByRole("option", { name: /private to me/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(api.updateConnection).toHaveBeenCalledWith("1", {
        scope: "private",
      });
    });
  });

  it("shows error message on save failure", async () => {
    vi.mocked(api.createConnection).mockRejectedValueOnce({
      response: { data: { detail: "Connection failed: Invalid credentials" } },
    });

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    // Fill in form - using paste() is faster than type()
    await user.click(screen.getByLabelText(/connection name/i));
    await user.paste("New Server");

    await user.click(screen.getByLabelText(/host/i));
    await user.paste("192.168.1.200");

    await user.click(screen.getByLabelText(/share name/i));
    await user.paste("share");

    await user.click(screen.getByLabelText(/user name/i));
    await user.paste("user");

    // Get password input using getAllByLabelText
    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT") as HTMLElement;
    await user.click(passwordInput);
    await user.paste("wrongpass");

    // Save
    const saveButton = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveButton);

    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/connection failed: invalid credentials/i)).toBeInTheDocument();
    });

    // Should not call onSave or onClose
    expect(mockOnSave).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("keeps the save label visible while the save request is pending", async () => {
    let resolveCreate: ((value: Connection) => void) | null = null;
    vi.mocked(api.createConnection).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    await user.click(screen.getByLabelText(/connection name/i));
    await user.paste("New Server");

    await user.click(screen.getByLabelText(/host/i));
    await user.paste("192.168.1.200");

    await user.click(screen.getByLabelText(/share name/i));
    await user.paste("newshare");

    await user.click(screen.getByLabelText(/user name/i));
    await user.paste("newuser");

    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT") as HTMLElement;
    await user.click(passwordInput);
    await user.paste("newpass");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(api.createConnection).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^save$/i })).toHaveTextContent(/^save$/i);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolveCreate?.(mockConnection);
  });

  it("closes dialog on cancel", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("tests connection successfully", async () => {
    vi.mocked(api.testConnection).mockResolvedValueOnce({
      status: "success",
      message: "Connection test successful",
    });

    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} connection={mockConnection} />);

    // Click test connection button
    const testButton = screen.getByRole("button", { name: /test connection/i });
    await user.click(testButton);

    await waitFor(() => {
      expect(screen.getByText(/connection test successful/i)).toBeInTheDocument();
    });
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open={true} onClose={mockOnClose} onSave={mockOnSave} />);

    // Get password input using getAllByLabelText
    const passwordFields = screen.getAllByLabelText(/password/i);
    const passwordInput = passwordFields.find((el) => el.tagName === "INPUT") as HTMLInputElement;
    expect(passwordInput).toHaveAttribute("type", "password");

    // Click visibility toggle
    const toggleButton = screen.getByRole("button", {
      name: /toggle password visibility/i,
    });
    await user.click(toggleButton);

    // Password should now be visible
    expect(passwordInput).toHaveAttribute("type", "text");

    // Click again to hide
    await user.click(toggleButton);
    expect(passwordInput).toHaveAttribute("type", "password");
  });
});
