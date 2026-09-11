import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/utils/test-utils";
import { AppearanceSettings } from "../PreferencesSettings";

const { setLanguagePreferenceMock, setRegionalLocalePreferenceMock, themeCommitMock, settingStates } = vi.hoisted(() => ({
  setLanguagePreferenceMock: vi.fn(),
  setRegionalLocalePreferenceMock: vi.fn(),
  themeCommitMock: vi.fn(),
  settingStates: {
    language: { error: null as string | null, pending: false, saved: false },
    regionalLocale: { error: null as string | null, pending: false, saved: false },
    theme: { error: null as string | null, pending: false, saved: false },
  },
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
  useCurrentUserSetting: (field: string) => {
    const state =
      field === "localization.language"
        ? settingStates.language
        : field === "localization.regional_locale"
          ? settingStates.regionalLocale
          : settingStates.theme;
    return {
      confirmedValue: "sambee-light",
      ...state,
      commit: themeCommitMock,
      clearError: vi.fn(),
    };
  },
}));

describe("AppearanceSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeCommitMock.mockResolvedValue(undefined);
    setLanguagePreferenceMock.mockResolvedValue(undefined);
    setRegionalLocalePreferenceMock.mockResolvedValue(undefined);
    for (const state of Object.values(settingStates)) {
      state.error = null;
      state.pending = false;
      state.saved = false;
    }
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

  it.each([
    ["Space", " "],
    ["Enter", "{Enter}"],
  ])("persists a focused theme when activated with %s", async (_keyName, key) => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    screen.getByRole("radio", { name: "Sambee dark" }).focus();
    await user.keyboard(key);

    await waitFor(() => expect(themeCommitMock).toHaveBeenCalledWith("sambee-dark"));
  });

  it("keeps the requested theme selected while its update is pending", async () => {
    const user = userEvent.setup();
    themeCommitMock.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(<AppearanceSettings />);

    screen.getByRole("radio", { name: "Sambee dark" }).focus();
    await user.keyboard(" ");

    await waitFor(() => expect(themeCommitMock).toHaveBeenCalledWith("sambee-dark"));
    expect(screen.getByRole("radio", { name: "Sambee dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sambee dark" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Sambee light" })).not.toBeChecked();
    expect(screen.getByRole("status", { name: "Saving setting" })).toBeInTheDocument();
  });

  it("restores theme radio focus after its save completes", async () => {
    const user = userEvent.setup();
    let resolveThemeUpdate: (() => void) | undefined;
    themeCommitMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveThemeUpdate = resolve;
        })
    );
    render(<AppearanceSettings />);

    const darkTheme = screen.getByRole("radio", { name: "Sambee dark" });
    darkTheme.focus();
    await user.keyboard(" ");

    await waitFor(() => expect(darkTheme).toBeDisabled());
    darkTheme.blur();
    resolveThemeUpdate?.();

    await waitFor(() => expect(darkTheme).toHaveFocus());
  });

  it("renders saved and failed theme feedback", () => {
    settingStates.theme.saved = true;
    const { rerender } = render(<AppearanceSettings />);

    expect(screen.getByRole("status", { name: "Setting saved" })).toBeInTheDocument();

    settingStates.theme.saved = false;
    settingStates.theme.error = "Unable to save theme.";
    rerender(<AppearanceSettings />);
    expect(screen.getByText("Unable to save theme.")).toBeInTheDocument();
  });

  it("renders localized select saving, saved, and error feedback", () => {
    settingStates.language.pending = true;
    const { rerender } = render(<AppearanceSettings />);

    expect(screen.getByRole("combobox", { name: "Language" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status", { name: "Saving setting" })).toBeInTheDocument();

    settingStates.language.pending = false;
    settingStates.language.saved = true;
    rerender(<AppearanceSettings />);
    expect(screen.getByRole("status", { name: "Setting saved" })).toBeInTheDocument();

    settingStates.language.saved = false;
    settingStates.regionalLocale.error = "Could not save regional settings.";
    rerender(<AppearanceSettings />);
    expect(screen.getByText("Could not save regional settings.")).toBeInTheDocument();
  });
});
