import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, setRegionalLocalePreference } from "../../i18n";
import { render } from "../../test/utils/test-utils";
import { AppearanceSettings } from "../PreferencesSettings";

const { saveThemeByIdMock, setThemeByIdMock, setIncludeDotDirectoriesMock, patchCurrentUserSettingsMock, loadCurrentUserSettingsMock } =
  vi.hoisted(() => ({
    saveThemeByIdMock: vi.fn(),
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
      {
        id: "sambee-dark",
        name: "Sambee dark",
        description: "Application default dark theme",
        primary: { main: "#d4a020" },
        background: { default: "#1f262b" },
        text: { primary: "#f6f1e8" },
      },
    ],
    saveThemeById: saveThemeByIdMock,
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

describe("AppearanceSettings", () => {
  const originalNavigatorLanguage = navigator.language;
  const originalNavigatorLanguages = navigator.languages;

  beforeEach(async () => {
    vi.clearAllMocks();
    loadCurrentUserSettingsMock.mockResolvedValue(null);
    patchCurrentUserSettingsMock.mockResolvedValue(null);
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US", "en"] });
    await setLocale("en");
    await setRegionalLocalePreference("browser");
  });

  afterEach(async () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: originalNavigatorLanguage });
    Object.defineProperty(navigator, "languages", { configurable: true, value: originalNavigatorLanguages });
    await setLocale("en");
    await setRegionalLocalePreference("browser");
  });

  it("renders localization controls and preview text", async () => {
    render(<AppearanceSettings />);

    expect(screen.getByText("Localization")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Regional settings" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Preview").tagName).toBe("LABEL");
    expect(screen.queryByText("Quick navigation")).not.toBeInTheDocument();
  });

  it("uses plain browser-default labels for both localization dropdowns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("combobox", { name: "Language" }));

    expect(await screen.findByRole("option", { name: "Browser default" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("combobox", { name: "Regional settings" }));

    expect(await screen.findByRole("option", { name: "Browser default" })).toBeInTheDocument();
  });

  it("persists the selected language preference only after saving", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(await screen.findByRole("option", { name: "Pseudo-English (for localization testing)" }));

    expect(saveThemeByIdMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(saveThemeByIdMock).toHaveBeenCalledWith("sambee-light", {
        localization: { language: "en-XA", regional_locale: "browser" },
      });
    });
  });

  it("persists the selected regional locale preference only after saving", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("combobox", { name: "Regional settings" }));
    await user.click(await screen.findByRole("option", { name: "German (Germany)" }));

    expect(saveThemeByIdMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(saveThemeByIdMock).toHaveBeenCalledWith("sambee-light", {
        localization: { language: "en", regional_locale: "de-DE" },
      });
    });
  });

  it("submits a changed theme and localization in one settings update", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByText("Sambee dark"));
    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(await screen.findByRole("option", { name: "Pseudo-English (for localization testing)" }));
    await user.click(screen.getByRole("button"));

    expect(saveThemeByIdMock).toHaveBeenCalledTimes(1);
    expect(saveThemeByIdMock).toHaveBeenCalledWith("sambee-dark", {
      localization: { language: "en-XA", regional_locale: "browser" },
    });
    expect(patchCurrentUserSettingsMock).not.toHaveBeenCalled();
  });
});
