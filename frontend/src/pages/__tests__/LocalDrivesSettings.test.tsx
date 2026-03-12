import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DRIVES_PAGE_COPY } from "../../components/Settings/localDrivesCopy";
import { SambeeThemeProvider } from "../../theme";
import { LocalDrivesSettings } from "../LocalDrivesSettings";

const { mockCheckHealth, mockGetPairStatus, mockHasStoredSecret, mockUnpairOrigin } = vi.hoisted(() => ({
  mockCheckHealth: vi.fn(),
  mockGetPairStatus: vi.fn(),
  mockHasStoredSecret: vi.fn(),
  mockUnpairOrigin: vi.fn(),
}));

vi.mock("../../components/FileBrowser/CompanionPairingDialog", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("../../services/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("../../services/companion", () => ({
  __esModule: true,
  default: {
    checkHealth: mockCheckHealth,
    getPairStatus: mockGetPairStatus,
    confirmPairing: vi.fn(),
    testPairing: vi.fn(),
    unpairOrigin: mockUnpairOrigin,
    initiatePairing: vi.fn(),
  },
  clearStoredSecret: vi.fn(),
  hasStoredSecret: mockHasStoredSecret,
}));

describe("LocalDrivesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckHealth.mockResolvedValue({ status: "ok", paired: true });
    mockUnpairOrigin.mockResolvedValue(undefined);
  });

  const renderSettings = () => {
    return render(
      <SambeeThemeProvider>
        <LocalDrivesSettings />
      </SambeeThemeProvider>
    );
  };

  it("shows Unpair This Browser instead of Pair This Browser when this browser is fully paired", async () => {
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: true,
    });
    mockHasStoredSecret.mockReturnValue(true);

    renderSettings();

    await waitFor(() => {
      expect(mockGetPairStatus).toHaveBeenCalled();
    });

    expect(screen.queryByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.pairThisBrowserButton })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.unpairThisBrowserButton })).toBeEnabled();
    expect(screen.getByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.testCurrentPairingButton })).toBeEnabled();
    expect(screen.getByText(LOCAL_DRIVES_PAGE_COPY.statusPaired)).toBeInTheDocument();
  });

  it("shows Pair This Browser and hides browser-only actions when re-pair is required", async () => {
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: true,
    });
    mockHasStoredSecret.mockReturnValue(false);

    renderSettings();

    await waitFor(() => {
      expect(mockGetPairStatus).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.pairThisBrowserButton })).toBeEnabled();
    expect(screen.queryByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.unpairThisBrowserButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.testCurrentPairingButton })).not.toBeInTheDocument();
    expect(screen.getByText(LOCAL_DRIVES_PAGE_COPY.statusRecoverable)).toBeInTheDocument();
  });

  it("unpairs the current browser from the top-level action", async () => {
    const user = userEvent.setup();

    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: true,
    });
    mockHasStoredSecret.mockReturnValue(true);

    renderSettings();

    const unpairButton = await screen.findByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.unpairThisBrowserButton });
    await user.click(unpairButton);

    await waitFor(() => {
      expect(mockUnpairOrigin).toHaveBeenCalledWith(window.location.origin);
    });
  });
});
