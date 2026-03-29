import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import { ConnectionSettings } from "../ConnectionSettings";

vi.mock("../../services/api", () => ({
  default: {
    getCurrentUser: vi.fn(),
    getConnections: vi.fn(),
    getConnectionVisibilityOptions: vi.fn(),
    deleteConnection: vi.fn(),
    testConnection: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    testConnectionConfig: vi.fn(),
  },
}));

import api from "../../services/api";

function mockMobileMode(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile ? !query.includes("min-width") : query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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

describe("ConnectionSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMobileMode(false);
    clearCachedAsyncData();
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: "admin-id",
      username: "admin",
      role: "admin",
      is_admin: true,
    });
    vi.mocked(api.getConnections).mockResolvedValue([]);
    vi.mocked(api.getConnectionVisibilityOptions).mockResolvedValue(mockVisibilityOptions);
  });

  const renderSettings = () =>
    render(
      <SambeeThemeProvider>
        <ConnectionSettings isAdmin={false} />
      </SambeeThemeProvider>
    );

  it("shows a loading state instead of flashing the empty state before connections load", () => {
    vi.mocked(api.getConnections).mockReturnValue(new Promise(() => undefined));

    renderSettings();

    expect(screen.queryByText(/no connections configured/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows backend-defined visibility options when the dialog opens", async () => {
    const user = userEvent.setup();

    renderSettings();

    await waitFor(() => {
      expect(api.getCurrentUser).toHaveBeenCalled();
      expect(api.getConnections).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /add connection/i }));

    const visibilitySelect = await screen.findByRole("combobox", { name: /visibility/i });
    expect(visibilitySelect).toBeInTheDocument();

    await user.click(visibilitySelect);

    expect(await screen.findByRole("option", { name: /private to me/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /shared with everyone/i })).toBeInTheDocument();
    expect(api.getConnectionVisibilityOptions).toHaveBeenCalled();
  });

  it("does not render an empty padded header block in headerless mobile mode", async () => {
    mockMobileMode(true);
    vi.mocked(api.getConnections).mockResolvedValue([
      {
        id: "shared-1",
        name: "Accounting",
        type: "smb",
        host: "fileserver.local",
        port: 445,
        share_name: "accounting",
        username: "sambee",
        path_prefix: "/",
        scope: "shared",
        can_manage: false,
      },
    ]);

    render(
      <SambeeThemeProvider>
        <ConnectionSettings isAdmin={false} showHeader={false} />
      </SambeeThemeProvider>
    );

    await screen.findByText("Shared connections");

    expect(screen.queryByTestId("connection-settings-inline-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-settings-shared-section")).toHaveStyle({ marginTop: "0px" });
    expect(screen.getByTestId("connection-settings-private-section")).toHaveStyle({ marginTop: "24px" });
  });

  it("does not add top margin before the first section in headerless desktop mode", async () => {
    vi.mocked(api.getConnections).mockResolvedValue([
      {
        id: "shared-1",
        name: "Accounting",
        type: "smb",
        host: "fileserver.local",
        port: 445,
        share_name: "accounting",
        username: "sambee",
        path_prefix: "/",
        scope: "shared",
        can_manage: true,
      },
    ]);

    render(
      <SambeeThemeProvider>
        <ConnectionSettings isAdmin={true} showHeader={false} />
      </SambeeThemeProvider>
    );

    await screen.findByText("Shared connections");

    expect(screen.getByTestId("connection-settings-inline-header")).toBeInTheDocument();
    expect(screen.getByTestId("connection-settings-shared-section")).toHaveStyle({ marginTop: "0px" });
    expect(screen.getByTestId("connection-settings-private-section")).toHaveStyle({ marginTop: "24px" });
  });
});
