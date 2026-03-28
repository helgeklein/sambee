import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DRIVES_PAGE_COPY } from "../../components/Settings/localDrivesCopy";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import { LocalDrivesSettings } from "../LocalDrivesSettings";

const { mockCheckHealth, mockGetPairStatus, mockGetCompanionDownloads, mockHasStoredSecret, mockUnpairOrigin } = vi.hoisted(() => ({
  mockCheckHealth: vi.fn(),
  mockGetPairStatus: vi.fn(),
  mockGetCompanionDownloads: vi.fn(),
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
    unpairOrigin: mockUnpairOrigin,
    initiatePairing: vi.fn(),
  },
  clearStoredSecret: vi.fn(),
  hasStoredSecret: mockHasStoredSecret,
}));

describe("LocalDrivesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    mockCheckHealth.mockResolvedValue({ status: "ok", paired: true });
    mockGetCompanionDownloads.mockResolvedValue({
      source: "feed",
      version: "0.5.0",
      published_at: "2026-03-27T12:00:00Z",
      notes: "Release notes",
      assets: {
        "windows-x64": "https://downloads.example.test/Sambee-Companion.exe",
      },
    });
    mockUnpairOrigin.mockResolvedValue(undefined);
    vi.useRealTimers();
  });

  const renderSettings = () => {
    return render(
      <SambeeThemeProvider>
        <LocalDrivesSettings />
      </SambeeThemeProvider>
    );
  };

  it("does not flash the unavailable warning before the first load resolves", () => {
    mockCheckHealth.mockReturnValue(new Promise(() => undefined));
    mockHasStoredSecret.mockReturnValue(false);

    renderSettings();

    expect(screen.queryByText(LOCAL_DRIVES_PAGE_COPY.statusUnavailable)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

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
    expect(screen.getByText(LOCAL_DRIVES_PAGE_COPY.verificationSectionTitle)).toBeInTheDocument();
    expect(screen.queryByText(LOCAL_DRIVES_PAGE_COPY.downloadSectionTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(LOCAL_DRIVES_PAGE_COPY.pairingSectionTitle)).not.toBeInTheDocument();
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
    expect(screen.getByText(LOCAL_DRIVES_PAGE_COPY.pairingSectionTitle)).toBeInTheDocument();
    expect(screen.queryByText(LOCAL_DRIVES_PAGE_COPY.downloadSectionTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(LOCAL_DRIVES_PAGE_COPY.verificationSectionTitle)).not.toBeInTheDocument();
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

  it("shows backend-provided companion download links", async () => {
    mockCheckHealth.mockResolvedValue(null);
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: false,
    });
    mockHasStoredSecret.mockReturnValue(false);

    renderSettings();

    expect(await screen.findByText(LOCAL_DRIVES_PAGE_COPY.downloadSectionTitle)).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: /Download for this computer/i });
    expect(downloadLink).toHaveAttribute("href", "https://downloads.example.test/Sambee-Companion.exe");
  });

  it("shows an actionable metadata error when companion downloads cannot be resolved", async () => {
    mockCheckHealth.mockResolvedValue(null);
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: false,
    });
    mockHasStoredSecret.mockReturnValue(false);
    mockGetCompanionDownloads.mockRejectedValue({
      response: { data: { detail: "Companion download metadata feed request timed out." } },
      message: "Bad Gateway",
    });

    renderSettings();

    expect(await screen.findByText("Companion download metadata feed request timed out.")).toBeInTheDocument();
  });

  it("polls companion status every second while the page is visible", async () => {
    mockGetPairStatus.mockResolvedValue({
      current_origin: window.location.origin,
      current_origin_paired: true,
    });
    mockHasStoredSecret.mockReturnValue(true);

    renderSettings();

    await waitFor(() => {
      expect(mockCheckHealth).toHaveBeenCalled();
    });

    const initialCheckHealthCalls = mockCheckHealth.mock.calls.length;

    await waitFor(
      () => {
        expect(mockCheckHealth.mock.calls.length).toBeGreaterThanOrEqual(initialCheckHealthCalls + 2);
      },
      { timeout: 3_500 }
    );
  });
});
