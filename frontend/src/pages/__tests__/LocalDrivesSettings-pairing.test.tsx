import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANION_PAIRING_DIALOG_COPY, LOCAL_DRIVES_PAGE_COPY } from "../../components/Settings/localDrivesCopy";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import { LocalDrivesSettings } from "../LocalDrivesSettings";

const { mockCheckHealth, mockGetPairStatus, mockGetCompanionDownloads, mockHasStoredSecret, mockCancelPairing, mockInitiatePairing } =
  vi.hoisted(() => ({
    mockCheckHealth: vi.fn(),
    mockGetPairStatus: vi.fn(),
    mockGetCompanionDownloads: vi.fn(),
    mockHasStoredSecret: vi.fn(),
    mockCancelPairing: vi.fn(),
    mockInitiatePairing: vi.fn(),
  }));

vi.mock("../../services/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../services/api", () => ({
  __esModule: true,
  default: {
    getCompanionDownloads: mockGetCompanionDownloads,
  },
}));

vi.mock("../../services/companion", () => ({
  __esModule: true,
  default: {
    checkHealth: mockCheckHealth,
    getPairStatus: mockGetPairStatus,
    confirmPairing: vi.fn(),
    testPairing: vi.fn(),
    unpairCurrentOrigin: vi.fn(),
    cancelPairing: mockCancelPairing,
    initiatePairing: mockInitiatePairing,
  },
  clearStoredSecret: vi.fn(),
  hasStoredSecret: mockHasStoredSecret,
}));

function mockNavigatorDevice() {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "Linux x86_64",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
}

describe("LocalDrivesSettings pairing dialog integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    mockNavigatorDevice();
    mockCheckHealth.mockResolvedValue({ status: "ok", paired: false });
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: false,
      status: "unpaired",
    });
    mockGetCompanionDownloads.mockResolvedValue({
      source: "feed",
      version: "0.5.0",
      published_at: "2026-03-27T12:00:00Z",
      notes: "Release notes",
      assets: {
        "windows-x64": "https://downloads.example.test/Sambee-Companion.exe",
      },
    });
    mockHasStoredSecret.mockReturnValue(false);
    mockInitiatePairing.mockResolvedValue({ pairingId: "pair-1", pairingCode: "ABC123" });
    mockCancelPairing.mockResolvedValue(undefined);
  });

  it("cancels a pending pairing through the Local Drives page dialog wiring", async () => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <LocalDrivesSettings />
      </SambeeThemeProvider>
    );

    const openDialogButton = await screen.findByRole("button", { name: LOCAL_DRIVES_PAGE_COPY.pairThisBrowserButton });
    await user.click(openDialogButton);

    await user.click(await screen.findByRole("button", { name: COMPANION_PAIRING_DIALOG_COPY.startButton }));

    expect(await screen.findByText("ABC123")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: COMPANION_PAIRING_DIALOG_COPY.cancelButton }));

    await waitFor(() => {
      expect(mockCancelPairing).toHaveBeenCalledWith("pair-1");
    });
  });
});
