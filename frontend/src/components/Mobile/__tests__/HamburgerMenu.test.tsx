import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HamburgerMenu from "../../../components/Mobile/HamburgerMenu";
import type { Connection } from "../../../types";

// Mock data
const mockConnections: Connection[] = [
  {
    id: "1",
    name: "Test Share",
    type: "smb",
    host: "server.local",
    port: 445,
    share_name: "share1",
    username: "testuser",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "2",
    name: "Another Share",
    type: "smb",
    host: "server2.local",
    port: 445,
    share_name: "share2",
    username: "testuser",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

describe("HamburgerMenu", () => {
  const mockOnClose = vi.fn();
  const mockOnConnectionChange = vi.fn();
  const mockOnNavigateToRoot = vi.fn();
  const mockOnOpenSettings = vi.fn();
  const mockOnLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders menu when open", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    expect(screen.getByText("Sambee")).toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });

  test("does not render when closed", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={false}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    expect(screen.queryByText("Sambee")).not.toBeInTheDocument();
  });

  test("shows connection selector with connections", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    expect(screen.getByText("Connection")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  test("calls onNavigateToRoot when Root is clicked", async () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    const rootButton = screen.getByText("Root");
    fireEvent.click(rootButton);

    await waitFor(() => {
      expect(mockOnNavigateToRoot).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  test("calls onOpenSettings when Settings is clicked", async () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    const settingsButton = screen.getByText("Settings");
    fireEvent.click(settingsButton);

    await waitFor(() => {
      expect(mockOnOpenSettings).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  test("calls onLogout when Logout is clicked", async () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    const logoutButton = screen.getByText("Logout");
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(mockOnLogout).toHaveBeenCalledTimes(1);
    });
  });

  test("hides Settings when user is not admin", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={false}
        />
      </BrowserRouter>
    );

    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });

  test("connection selector is present with connections", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={mockConnections}
          selectedConnectionId="1"
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    // Connection label should be visible
    expect(screen.getByText("Connection")).toBeInTheDocument();

    // The current connection name should be displayed
    expect(screen.getByText(/Test Share/)).toBeInTheDocument();
  });

  test("handles empty connections list", () => {
    render(
      <BrowserRouter>
        <HamburgerMenu
          open={true}
          onClose={mockOnClose}
          connections={[]}
          selectedConnectionId=""
          onConnectionChange={mockOnConnectionChange}
          onNavigateToRoot={mockOnNavigateToRoot}
          onOpenSettings={mockOnOpenSettings}
          onLogout={mockOnLogout}
          isAdmin={true}
        />
      </BrowserRouter>
    );

    // Connection selector should not be visible
    expect(screen.queryByText("Connection")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    // But other menu items should still be there
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });
});
