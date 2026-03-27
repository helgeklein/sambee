import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import type { UserPreferences } from "../../stores/userPreferences";
import { Preferences } from "../Preferences";

const {
  invokeMock,
  listenMock,
  isAutostartEnabledMock,
  enableAutostartMock,
  disableAutostartMock,
  getUserPreferencesMock,
  saveUserPreferencesMock,
  fetchCompanionUpdateStatusMock,
  installCompanionUpdateMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  isAutostartEnabledMock: vi.fn(),
  enableAutostartMock: vi.fn(),
  disableAutostartMock: vi.fn(),
  getUserPreferencesMock: vi.fn(),
  saveUserPreferencesMock: vi.fn(),
  fetchCompanionUpdateStatusMock: vi.fn(),
  installCompanionUpdateMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: isAutostartEnabledMock,
  enable: enableAutostartMock,
  disable: disableAutostartMock,
}));

vi.mock("../../stores/userPreferences", () => ({
  getUserPreferences: getUserPreferencesMock,
  saveUserPreferences: saveUserPreferencesMock,
}));

vi.mock("../../lib/updateCheck", () => ({
  fetchCompanionUpdateStatus: fetchCompanionUpdateStatusMock,
  installCompanionUpdate: installCompanionUpdateMock,
}));

describe("Preferences", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    isAutostartEnabledMock.mockReset();
    enableAutostartMock.mockReset();
    disableAutostartMock.mockReset();
    getUserPreferencesMock.mockReset();
    saveUserPreferencesMock.mockReset();
    fetchCompanionUpdateStatusMock.mockReset();
    installCompanionUpdateMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
  });

  afterEach(async () => {
    cleanup();
    await setLocale("en");
  });

  it("renders translated preferences sections and unpair confirmation", async () => {
    await setLocale("en-XA");

    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "stable",
      tempFileRetentionDays: 7,
    };

    getUserPreferencesMock.mockResolvedValue(prefs);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve(["https://example.test"]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve({
          language: "en-XA",
          regional_locale: "en-GB",
          updated_at: "2026-03-22T12:00:00.000Z",
          source_origin: "https://example.test",
        });
      }

      return Promise.resolve(undefined);
    });
    isAutostartEnabledMock.mockResolvedValue(false);

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "[Ṕŕéƒéŕéńćéš]" })).toBeInTheDocument();
    });

    expect(screen.getByText("[Ṕåíŕéď Ɓŕóŵšéŕš]")).toBeInTheDocument();
    expect(screen.getByText(translate("preferences.sections.localization"))).toBeInTheDocument();
    expect(screen.getByText(translate("preferences.localizationStatus.syncedBadge"))).toBeInTheDocument();
    expect(screen.getByText("[Éďíťíńğ Ɓéħåṽíóŕ]")).toBeInTheDocument();
    expect(screen.getByText("[Šťåŕťúṕ]")).toBeInTheDocument();
    expect(screen.getByText(translate("preferences.sections.updates"))).toBeInTheDocument();
    expect(screen.getByText("[Ńóťíƒíćåťíóńš]")).toBeInTheDocument();
    expect(screen.getByText("en-XA")).toBeInTheDocument();
    expect(screen.getByText("en-GB")).toBeInTheDocument();
    expect(screen.getAllByText("https://example.test")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "[Úńṕåíŕ]" }));

    expect(await screen.findByRole("heading", { name: "[Úńṕåíŕ ƀŕóŵšéŕ?]" })).toBeInTheDocument();
    expect(screen.getByText(translate("preferences.confirmUnpair.body", { origin: "https://example.test" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "[Ćåńćéĺ]" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "[Úńṕåíŕ]" }).length).toBeGreaterThan(0);
  });

  it("shows translated pending text while unpairing", async () => {
    await setLocale("en-XA");

    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "stable",
      tempFileRetentionDays: 7,
    };

    let resolveUnpair: () => void = () => {};

    getUserPreferencesMock.mockResolvedValue(prefs);
    isAutostartEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve(["https://example.test"]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve(null);
      }

      if (command === "unpair_origin") {
        return new Promise<void>((resolve) => {
          resolveUnpair = resolve;
        });
      }

      return Promise.resolve(undefined);
    });

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "[Ṕŕéƒéŕéńćéš]" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "[Úńṕåíŕ]" }));

    const unpairButtons = await screen.findAllByRole("button", { name: "[Úńṕåíŕ]" });
    fireEvent.click(unpairButtons[unpairButtons.length - 1]!);

    expect(await screen.findAllByText(translate("preferences.confirmUnpair.unpairing"))).toHaveLength(2);

    resolveUnpair();
  });

  it("shows an empty localization state when no browser sync has happened yet", async () => {
    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "stable",
      tempFileRetentionDays: 7,
    };

    getUserPreferencesMock.mockResolvedValue(prefs);
    isAutostartEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve([]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve(null);
      }

      return Promise.resolve(undefined);
    });

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    });

    expect(screen.getByText("No browser localization has been synchronized yet.")).toBeInTheDocument();
  });

  it("requires confirmation before switching away from stable update channel", async () => {
    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "stable",
      tempFileRetentionDays: 7,
    };

    getUserPreferencesMock.mockResolvedValue(prefs);
    isAutostartEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve([]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve(null);
      }

      return Promise.resolve(undefined);
    });

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Update channel"), {
      target: { value: "beta" },
    });

    expect(await screen.findByRole("heading", { name: "Switch update channel?" })).toBeInTheDocument();
    expect(saveUserPreferencesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch channel" }));

    await waitFor(() => {
      expect(saveUserPreferencesMock).toHaveBeenCalledWith({
        ...prefs,
        companionUpdateChannel: "beta",
      });
    });
  });

  it("shows manual update status when the companion is already up to date", async () => {
    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "stable",
      tempFileRetentionDays: 7,
    };

    getUserPreferencesMock.mockResolvedValue(prefs);
    isAutostartEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve([]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve(null);
      }

      return Promise.resolve(undefined);
    });
    fetchCompanionUpdateStatusMock.mockResolvedValue({
      available: false,
      currentVersion: "0.5.0",
      version: null,
      notes: null,
      publishedAt: null,
    });

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("You are up to date on the Stable channel.")).toBeInTheDocument();
    expect(screen.getByText(/^Last checked:/)).toBeInTheDocument();
    expect(screen.getByText("0.5.0")).toBeInTheDocument();
  });

  it("shows available update details and installs on demand", async () => {
    const prefs: UserPreferences = {
      allowedServers: [],
      uploadConflictAction: "ask",
      autoStartOnLogin: false,
      showNotifications: true,
      companionUpdateChannel: "beta",
      tempFileRetentionDays: 7,
    };

    getUserPreferencesMock.mockResolvedValue(prefs);
    isAutostartEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_paired_origins") {
        return Promise.resolve([]);
      }

      if (command === "get_synced_localization") {
        return Promise.resolve(null);
      }

      return Promise.resolve(undefined);
    });
    fetchCompanionUpdateStatusMock.mockResolvedValue({
      available: true,
      currentVersion: "0.5.0",
      version: "0.6.0",
      notes: "Bug fixes and feed-based update checks.",
      publishedAt: "2026-03-27T12:34:56Z",
    });
    installCompanionUpdateMock.mockResolvedValue(undefined);

    render(<Preferences onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Update 0.6.0 is available on the Beta channel.")).toBeInTheDocument();
    expect(screen.getByText("Bug fixes and feed-based update checks.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install update" }));

    await waitFor(() => {
      expect(installCompanionUpdateMock).toHaveBeenCalledWith("beta");
    });

    expect(
      await screen.findByText("Update 0.6.0 has been installed. Restart the app if it does not relaunch automatically.")
    ).toBeInTheDocument();
  });
});
