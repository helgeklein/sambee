import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import SettingsDialog from "../SettingsDialog";

// Mock the API module
vi.mock("../../../services/api", () => ({
  default: {
    getCurrentUser: vi.fn(),
  },
}));

// Mock the settings pages since they're rendered by the dialog
vi.mock("../../../pages/AppearanceSettings", () => ({
  AppearanceSettings: () => <div>Appearance Settings Content</div>,
}));

vi.mock("../../../pages/ConnectionSettings", () => ({
  ConnectionSettings: () => <div>Connection Settings Content</div>,
}));

import api from "../../../services/api";

describe("SettingsDialog Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getCurrentUser to return non-admin user by default
    vi.mocked(api.getCurrentUser).mockResolvedValue({ username: "testuser", is_admin: false });
  });

  const renderWithTheme = (ui: React.ReactElement) => {
    return render(<SambeeThemeProvider>{ui}</SambeeThemeProvider>);
  };

  it("does not check user status when dialog is closed", () => {
    renderWithTheme(<SettingsDialog open={false} onClose={mockOnClose} />);

    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it("checks user status and displays appearance settings when opened", async () => {
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Dialog should check user status
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    // Should show Appearance by default
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();
  });

  it("closes dialog when close button is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });

    // Click close button (icon button with CloseIcon)
    const closeIcon = screen.getByTestId("CloseIcon");
    const closeButton = closeIcon.closest("button");
    if (closeButton) {
      await user.click(closeButton);
    }

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("shows Connections tab for admin users", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ username: "admin", is_admin: true });

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    // Should show both Appearance and Connections in sidebar
    expect(screen.getByText("Settings")).toBeInTheDocument();
    const appearanceButton = screen.getByRole("button", { name: /appearance/i });
    const connectionsButton = screen.getByRole("button", { name: /connections/i });

    expect(appearanceButton).toBeInTheDocument();
    expect(connectionsButton).toBeInTheDocument();
  });

  it("hides Connections tab for non-admin users", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ username: "user", is_admin: false });

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    // Should show only Appearance
    expect(screen.getByText("Appearance")).toBeInTheDocument();

    // Connections should not be in the sidebar
    expect(screen.queryByRole("button", { name: /connections/i })).not.toBeInTheDocument();
  });

  it("switches to connections tab when admin clicks it", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ username: "admin", is_admin: true });

    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    // Should start with Appearance
    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();

    // Click Connections button
    const connectionsButton = screen.getByRole("button", { name: /connections/i });
    await user.click(connectionsButton);

    // Should now show Connection Settings
    expect(screen.getByText("Connection Settings Content")).toBeInTheDocument();
  });
});
