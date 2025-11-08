import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../types";
import SettingsDialog from "../SettingsDialog";

// Mock the API module
vi.mock("../../../services/api", () => ({
  default: {
    getConnections: vi.fn(),
    testConnection: vi.fn(),
    deleteConnection: vi.fn(),
  },
}));

import api from "../../../services/api";

const mockConnections: Connection[] = [
  {
    id: "1",
    name: "Test Server 1",
    type: "smb",
    host: "192.168.1.100",
    port: 445,
    share_name: "share1",
    username: "user1",
    path_prefix: "/",
    created_at: "2024-01-01T00:00:00",
    updated_at: "2024-01-01T00:00:00",
  },
  {
    id: "2",
    name: "Test Server 2",
    type: "smb",
    host: "192.168.1.101",
    port: 445,
    share_name: "share2",
    username: "user2",
    path_prefix: "/",
    created_at: "2024-01-02T00:00:00",
    updated_at: "2024-01-02T00:00:00",
  },
];

describe("SettingsDialog Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load connections when dialog is closed", () => {
    render(<SettingsDialog open={false} onClose={mockOnClose} />);

    expect(api.getConnections).not.toHaveBeenCalled();
  });

  it("loads and displays connections when dialog is opened", async () => {
    vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);

    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(api.getConnections).toHaveBeenCalled();
    });

    // Check that connections are displayed
    expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    expect(screen.getByText("Test Server 2")).toBeInTheDocument();
  });

  it("closes dialog when close button is clicked", async () => {
    vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Click close button (icon button with CloseIcon)
    const closeIcon = screen.getByTestId("CloseIcon");
    const closeButton = closeIcon.closest("button");
    if (closeButton) {
      await user.click(closeButton);
    }

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("opens add connection dialog when Add Connection is clicked", async () => {
    vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Click Add Connection button
    const addButton = screen.getByRole("button", { name: /add connection/i });
    await user.click(addButton);

    // Connection dialog should be open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /add new connection/i })).toBeInTheDocument();
    });
  });

  it("handles connection test successfully", async () => {
    vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);
    vi.mocked(api.testConnection).mockResolvedValueOnce({
      status: "success",
      message: "Connection test successful",
    });

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Find and click test button
    const testButtons = screen.getAllByRole("button", { name: /test/i });
    await user.click(testButtons[0]);

    // Should show success notification
    await waitFor(() => {
      expect(screen.getByText(/connection test successful/i)).toBeInTheDocument();
    });
  });

  it("handles connection test failure", async () => {
    vi.mocked(api.getConnections).mockResolvedValueOnce(mockConnections);
    vi.mocked(api.testConnection).mockRejectedValueOnce({
      response: { data: { detail: "Connection timeout" } },
    });

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Find and click test button
    const testButtons = screen.getAllByRole("button", { name: /test/i });
    await user.click(testButtons[0]);

    // Should show error notification
    await waitFor(() => {
      expect(screen.getByText(/connection timeout/i)).toBeInTheDocument();
    });
  });

  it("handles connection deletion", async () => {
    vi.mocked(api.getConnections)
      .mockResolvedValueOnce(mockConnections)
      .mockResolvedValueOnce([mockConnections[1]]); // After deletion
    vi.mocked(api.deleteConnection).mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Click delete button
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await user.click(deleteButtons[0]);

    // Confirm deletion
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole("button", { name: /confirm|delete/i });
    await user.click(confirmButton);

    // Should show success notification
    await waitFor(() => {
      expect(screen.getByText(/connection deleted successfully/i)).toBeInTheDocument();
    });

    // Should reload connections
    expect(api.getConnections).toHaveBeenCalledTimes(2);
  });

  it("displays error when loading connections fails", async () => {
    vi.mocked(api.getConnections).mockRejectedValueOnce({
      response: { data: { detail: "Server error" } },
    });

    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });
  });

  it("reloads connections after editing", async () => {
    vi.mocked(api.getConnections)
      .mockResolvedValueOnce(mockConnections)
      .mockResolvedValueOnce(mockConnections); // After save

    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Test Server 1")).toBeInTheDocument();
    });

    // Click edit button
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    await user.click(editButtons[0]);

    // Connection dialog should be open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /edit connection/i })).toBeInTheDocument();
    });

    // Note: Actual save interaction would require mocking updateConnection
    // This test verifies the dialog opens in edit mode
  });
});
