import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { AppearanceSettings } from "../PreferencesSettings";

const { setLanguagePreferenceMock, setRegionalLocalePreferenceMock, themeCommitMock } = vi.hoisted(() => ({
  setLanguagePreferenceMock: vi.fn(),
  setRegionalLocalePreferenceMock: vi.fn(),
  themeCommitMock: vi.fn(),
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
        primary: { main: "#1976d2" },
        background: { default: "#ffffff" },
        text: { primary: "#111111" },
      },
      {
        id: "sambee-dark",
        name: "Sambee dark",
        primary: { main: "#d4a020" },
        background: { default: "#1f262b" },
        text: { primary: "#f6f1e8" },
      },
    ],
  }),
}));

vi.mock("../../i18n/LocalePreferencesProvider", () => ({
  LocalePreferencesProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocalePreferences: () => ({
    languagePreference: "browser",
    regionalLocale: "en-US",
    regionalLocalePreference: "browser",
    setLanguagePreference: setLanguagePreferenceMock,
    setRegionalLocalePreference: setRegionalLocalePreferenceMock,
  }),
}));

vi.mock("../../services/userSettingsStore", () => ({
  useCurrentUserSetting: () => ({
    confirmedValue: "sambee-light",
    pending: false,
    error: null,
    commit: themeCommitMock,
    clearError: vi.fn(),
  }),
}));

describe("AppearanceSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeCommitMock.mockResolvedValue(undefined);
    setLanguagePreferenceMock.mockResolvedValue(undefined);
    setRegionalLocalePreferenceMock.mockResolvedValue(undefined);
  });

  it("renders independent localization controls and no routine Save action", () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Regional settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("persists a selected language immediately", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(await screen.findByRole("option", { name: "Pseudo-English (for localization testing)" }));

    await waitFor(() => expect(setLanguagePreferenceMock).toHaveBeenCalledWith("en-XA"));
  });

  it("persists a selected regional locale immediately", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("combobox", { name: "Regional settings" }));
    await user.click(await screen.findByRole("option", { name: "German (Germany)" }));

    await waitFor(() => expect(setRegionalLocalePreferenceMock).toHaveBeenCalledWith("de-DE"));
  });

  it("persists a selected theme as its own field update", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByText("Sambee dark"));

    await waitFor(() => expect(themeCommitMock).toHaveBeenCalledWith("sambee-dark"));
  });
});
