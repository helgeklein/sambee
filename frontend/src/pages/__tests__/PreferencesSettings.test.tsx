import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, setRegionalLocalePreference } from "../../i18n";
import { render } from "../../test/utils/test-utils";
import { PreferencesSettings } from "../PreferencesSettings";

const { setThemeByIdMock, setIncludeDotDirectoriesMock, patchCurrentUserSettingsMock, loadCurrentUserSettingsMock } = vi.hoisted(() => ({
  setThemeByIdMock: vi.fn(),
  setIncludeDotDirectoriesMock: vi.fn(),
  patchCurrentUserSettingsMock: vi.fn(),
  loadCurrentUserSettingsMock: vi.fn(),
}));

vi.mock("../../theme", () => ({
  useSambeeTheme: () => ({
    currentTheme: {
      id: "sambee-light",
      name: "Sambee light",
      primary: { main: "#1976d2" },
      background: { default: "#ffffff" },
      text: { primary: "#111111" },
    },
    availableThemes: [
      {
        id: "sambee-light",
        name: "Sambee light",
        description: "Application default light theme",
        primary: { main: "#1976d2" },
        background: { default: "#ffffff" },
        text: { primary: "#111111" },
      },
    ],
    setThemeById: setThemeByIdMock,
  }),
}));

vi.mock("../FileBrowser/preferences", () => ({
  useQuickNavIncludeDotDirectoriesPreference: () => [false, setIncludeDotDirectoriesMock],
}));

vi.mock("../../services/userSettingsSync", () => ({
  USER_SETTINGS_CHANGED_EVENT: "sambee:user-settings-changed",
  loadCurrentUserSettings: loadCurrentUserSettingsMock,
  patchCurrentUserSettings: patchCurrentUserSettingsMock,
}));

describe("PreferencesSettings", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    loadCurrentUserSettingsMock.mockResolvedValue(null);
    patchCurrentUserSettingsMock.mockResolvedValue(null);
    await setLocale("en");
    await setRegionalLocalePreference("browser");
  });

  afterEach(async () => {
    await setLocale("en");
    await setRegionalLocalePreference("browser");
  });

  it("renders localization controls and preview text", async () => {
    render(<PreferencesSettings />);

    expect(screen.getByText("Localization")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Regional settings" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText(/Date and time:/i)).toBeInTheDocument();
    expect(screen.getByText(/Number:/i)).toBeInTheDocument();
  });

  it("persists the selected language preference", async () => {
    const user = userEvent.setup();
    render(<PreferencesSettings />);

    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(await screen.findByRole("option", { name: "Pseudo-localized English (testing)" }));

    await waitFor(() => {
      expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({
        localization: {
          language: "en-XA",
        },
      });
    });
  });

  it("persists the selected regional locale preference", async () => {
    const user = userEvent.setup();
    render(<PreferencesSettings />);

    await user.click(screen.getByRole("combobox", { name: "Regional settings" }));
    await user.click(await screen.findByRole("option", { name: "German (Germany)" }));

    await waitFor(() => {
      expect(patchCurrentUserSettingsMock).toHaveBeenCalledWith({
        localization: {
          regional_locale: "de-DE",
        },
      });
    });
  });
});
