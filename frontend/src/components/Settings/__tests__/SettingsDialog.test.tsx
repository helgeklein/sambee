import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import SettingsDialog from "../SettingsDialog";

vi.mock("../settingsDataSources", () => ({
  prefetchSettingsDataForItems: vi.fn(),
}));

// Mock the API module
vi.mock("../../../services/api", () => ({
  default: {
    getCurrentUser: vi.fn(),
  },
}));

// Mock the consolidated settings pages since they're rendered by the dialog
vi.mock("../../../pages/PreferencesSettings", () => ({
  AppearanceSettings: () => <div>Appearance Settings Content</div>,
}));

vi.mock("../../../pages/ConnectionsSettings", () => ({
  ConnectionsSettings: () => <div>Connections Settings Content</div>,
}));

vi.mock("../../../pages/FileBrowserSettings", () => ({
  FileBrowserSettings: () => <div>File Browser Settings Content</div>,
}));

vi.mock("../../../pages/LocalDrivesSettings", () => ({
  LocalDrivesSettings: () => <div>Local Drives Settings Content</div>,
}));

vi.mock("../../../pages/UserManagementSettings", () => ({
  UserManagementSettings: () => <div>User Management Settings Content</div>,
}));

vi.mock("../../../pages/AdvancedSettings", () => ({
  AdvancedSettings: () => <div>System Settings Content</div>,
}));

import api from "../../../services/api";

describe("SettingsDialog Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getCurrentUser to return non-admin user by default
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "user-id", username: "testuser", role: "regular", is_admin: false });
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

  it("shows the consolidated settings categories for admin users", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "admin-id", username: "admin", role: "admin", is_admin: true });

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    // Should show all categories in sidebar
    expect(screen.getByText("Settings")).toBeInTheDocument();
    const appearanceOption = screen.getByRole("option", { name: /appearance/i });
    const fileBrowserOption = screen.getByRole("option", { name: /file browser/i });
    const connectionsOption = screen.getByRole("option", { name: /^connections$/i });
    const userManagementOption = screen.getByRole("option", { name: /user management/i });
    const systemOption = screen.getByRole("option", { name: /system/i });

    expect(appearanceOption).toBeInTheDocument();
    expect(fileBrowserOption).toBeInTheDocument();
    expect(connectionsOption).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local drives/i })).toBeInTheDocument();
    expect(userManagementOption).toBeInTheDocument();
    expect(systemOption).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
  });

  it("shows only personal consolidated categories for non-admin users", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "user-id", username: "user", role: "regular", is_admin: false });

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /appearance/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /file browser/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^connections$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local drives/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /user management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /system/i })).not.toBeInTheDocument();
  });

  it("switches to Connections when clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const connectionsOption = screen.getByRole("option", { name: /^connections$/i });
    await user.click(connectionsOption);

    expect(screen.getByText("Connections Settings Content")).toBeInTheDocument();
  });

  it("switches to File Browser when clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const fileBrowserOption = screen.getByRole("option", { name: /file browser/i });
    await user.click(fileBrowserOption);

    expect(screen.getByText("File Browser Settings Content")).toBeInTheDocument();
  });

  it("switches to Local Drives when its top-level settings item is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const localDrivesOption = screen.getByRole("option", { name: /local drives/i });
    await user.click(localDrivesOption);

    expect(screen.getByText("Local Drives Settings Content")).toBeInTheDocument();
  });

  it("opens the requested consolidated initial category", async () => {
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} initialCategory="connections" />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    expect(screen.getByText("Connections Settings Content")).toBeInTheDocument();
  });

  it("falls back to Appearance when an admin-only initial category is unavailable", async () => {
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} initialCategory="admin-users" />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();
  });

  it("switches to Connections when a regular user clicks it", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    // Wait for user status to load
    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();

    const connectionsOption = screen.getByRole("option", { name: /^connections$/i });
    await user.click(connectionsOption);

    expect(screen.getByText("Connections Settings Content")).toBeInTheDocument();
  });

  it("switches to User Management tab when admin clicks it", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "admin-id", username: "admin", role: "admin", is_admin: true });

    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const userManagementOption = screen.getByRole("option", { name: /user management/i });
    await user.click(userManagementOption);

    expect(screen.getByText("User Management Settings Content")).toBeInTheDocument();
  });

  it("switches to System when admin clicks it", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "admin-id", username: "admin", role: "admin", is_admin: true });

    const user = userEvent.setup();
    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const systemOption = screen.getByRole("option", { name: /system/i });
    await user.click(systemOption);

    expect(screen.getByText("System Settings Content")).toBeInTheDocument();
  });

  it("supports Home and End keyboard navigation in the category list", async () => {
    const user = userEvent.setup();

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const connectionsOption = screen.getByRole("option", { name: /^connections$/i });
    connectionsOption.focus();

    await user.keyboard("{End}");

    expect(screen.getByText("Local Drives Settings Content")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local drives/i })).toHaveFocus();

    await user.keyboard("{Home}");

    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /appearance/i })).toHaveFocus();
  });

  it("supports PageUp and PageDown keyboard navigation in the category list", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "admin-id", username: "admin", role: "admin", is_admin: true });
    const user = userEvent.setup();

    renderWithTheme(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
    });

    const appearanceOption = screen.getByRole("option", { name: /appearance/i });
    appearanceOption.focus();

    await user.keyboard("{PageDown}");

    expect(screen.getByText("System Settings Content")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /system/i })).toHaveFocus();

    await user.keyboard("{PageUp}");

    expect(screen.getByText("Appearance Settings Content")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /appearance/i })).toHaveFocus();
  });
});
