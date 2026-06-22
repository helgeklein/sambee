import { afterEach, describe, expect, it } from "vitest";
import { CONNECTION_DIALOG_STRINGS } from "../../components/Admin/connectionDialogConstants";
import { CONFIRM_DELETE_STRINGS } from "../../components/FileBrowser/confirmDeleteDialogStrings";
import { SORT_CONTROLS_STRINGS } from "../../components/FileBrowser/sortControlsStrings";
import { STATUS_BAR_STRINGS } from "../../components/FileBrowser/statusBarStrings";
import { VIEW_MODE_SELECTOR_STRINGS } from "../../components/FileBrowser/viewModeSelectorStrings";
import { THEME_SELECTOR_STRINGS } from "../../components/themeSelectorStrings";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS } from "../../config/keyboardShortcuts";
import { compareLocalizedStrings, formatLocalizedDateTime, formatLocalizedNumber } from "../../utils/localeFormatting";
import {
  getAvailableLanguages,
  isPseudoLanguageEnabled,
  LOCALE_STORAGE_KEY,
  REGIONAL_LOCALE_STORAGE_KEY,
  setLocale,
  setRegionalLocalePreference,
  translate,
} from "../index";

describe("frontend i18n", () => {
  afterEach(async () => {
    await setLocale("en");
    await setRegionalLocalePreference("browser");
  });

  it("switches File Browser dialog strings when the locale changes", async () => {
    expect(CONFIRM_DELETE_STRINGS.BUTTON_DELETE).toBe("Delete");
    expect(CONNECTION_DIALOG_STRINGS.TITLE_ADD).toBe("Add Connection");
    expect(COMMON_SHORTCUTS.SEARCH.description).toBe("Search");
    expect(BROWSER_SHORTCUTS.SHOW_HELP.description).toBe("Show keyboard shortcuts");
    expect(translate("fileBrowser.shortcuts.openSelectedItem")).toBe("Open the selected file in Sambee.");
    expect(BROWSER_SHORTCUTS.OPEN_IN_APP.description).toBe("Open the selected file in its native app");
    expect(BROWSER_SHORTCUTS.OPEN_IN_VIEWER_PICKER.description).toBe("Choose a Sambee viewer for the selected file");
    expect(BROWSER_SHORTCUTS.OPEN_IN_NATIVE_PICKER.description).toBe("Choose a native app for the selected file");
    expect(SORT_CONTROLS_STRINGS.fieldLabel("modified")).toBe("Modified");
    expect(VIEW_MODE_SELECTOR_STRINGS.optionLabel("details")).toBe("Details");
    expect(STATUS_BAR_STRINGS.itemCount(2)).toBe("2 items");
    expect(THEME_SELECTOR_STRINGS.themeName({ id: "sambee-dark", name: "unused" })).toBe("Sambee dark");
    expect(translate("app.loading")).toBe("Loading...");
    expect(translate("auth.login.title")).toBe("Sambee Login");
    expect(translate("fileBrowser.list.emptyDirectory")).toBe("This directory is empty");
    expect(translate("fileBrowser.search.placeholders.directory")).toBe("Navigate to any directory");
    expect(translate("fileBrowser.commands.items.quickNav.title")).toBe("Open Navigate Mode");
    expect(translate("fileBrowser.commands.items.openInApp.title")).toBe("Open Focused File In Native App");
    expect(translate("fileBrowser.commands.items.openInViewerPicker.title")).toBe("Choose Sambee Viewer For Focused File");
    expect(translate("fileBrowser.row.openInCompanionApp")).toBe("Open in native app");
    expect(translate("fileBrowser.row.openInBrowserViewer")).toBe("Open in Sambee");
    expect(translate("app.errorBoundary.title")).toBe("Something went wrong");
    expect(translate("viewer.fallback.failedTitle")).toBe("Viewer unavailable");

    await setLocale("en-XA");

    expect(CONFIRM_DELETE_STRINGS.BUTTON_DELETE).toBe("[Ďéĺéťé]");
    expect(CONFIRM_DELETE_STRINGS.TITLE_FILE).toBe("[Ďéĺéťé ƒíĺé]");
    expect(CONNECTION_DIALOG_STRINGS.TITLE_ADD).toBe("[Åďď Ćóńńéćťíóń]");
    expect(CONNECTION_DIALOG_STRINGS.ERROR_USERNAME_REQUIRED).toBe("[Úšéŕńåḿé íš ŕéqúíŕéď]");
    expect(COMMON_SHORTCUTS.SEARCH.description).toBe("[Šéåŕćħ]");
    expect(BROWSER_SHORTCUTS.SHOW_HELP.description).toBe("[Šħóŵ ķéýƀóåŕď šħóŕťćúťš]");
    expect(translate("fileBrowser.shortcuts.openSelectedItem")).toBe("[Óṕéń ťħé šéĺéćťéď ƒíĺé íń Šåḿƀéé.]");
    expect(BROWSER_SHORTCUTS.OPEN_IN_APP.description).toBe("[Óṕéń ťħé šéĺéćťéď ƒíĺé íń íťš ńåťíṽé åṕṕ]");
    expect(BROWSER_SHORTCUTS.OPEN_IN_VIEWER_PICKER.description).toBe("[Ćħóóšé å Šåḿƀéé ṽíéŵéŕ ƒóŕ ťħé šéĺéćťéď ƒíĺé]");
    expect(BROWSER_SHORTCUTS.OPEN_IN_NATIVE_PICKER.description).toBe("[Ćħóóšé å ńåťíṽé åṕṕ ƒóŕ ťħé šéĺéćťéď ƒíĺé]");
    expect(SORT_CONTROLS_STRINGS.fieldLabel("modified")).toBe("[Ḿóďíƒíéď]");
    expect(VIEW_MODE_SELECTOR_STRINGS.optionLabel("details")).toBe("[Ďéťåíĺš]");
    expect(STATUS_BAR_STRINGS.itemCount(2)).toBe("[2 íťéḿš]");
    expect(THEME_SELECTOR_STRINGS.themeName({ id: "sambee-dark", name: "unused" })).toBe("[Šåḿƀéé ďåŕķ]");
    expect(translate("app.loading")).toBe("[Ĺóåďíńğ...]");
    expect(translate("auth.login.title")).toBe("[Šåḿƀéé Ĺóğíń]");
    expect(translate("fileBrowser.list.emptyDirectory")).toBe("[Ťħíš ďíŕéćťóŕý íš éḿṕťý]");
    expect(translate("fileBrowser.search.placeholders.directory")).toBe("[Ńåṽíğåťé ťó åńý ďíŕéćťóŕý]");
    expect(translate("fileBrowser.commands.items.quickNav.title")).toBe("[Óṕéń Ńåṽíğåťé Ḿóďé]");
    expect(translate("fileBrowser.commands.items.openInApp.title")).toBe("[Óṕéń Ƒóćúšéď Ƒíĺé Íń Ńåťíṽé Åṕṕ]");
    expect(translate("fileBrowser.commands.items.openInViewerPicker.title")).toBe("[Ćħóóšé Šåḿƀéé Ṽíéŵéŕ Ƒóŕ Ƒóćúšéď Ƒíĺé]");
    expect(translate("fileBrowser.row.openInCompanionApp")).toBe("[Óṕéń íń ńåťíṽé åṕṕ]");
    expect(translate("fileBrowser.row.openInBrowserViewer")).toBe("[Óṕéń íń Šåḿƀéé]");
    expect(translate("app.errorBoundary.title")).toBe("[Šóḿéťħíńğ ŵéńť ŵŕóńğ]");
    expect(translate("viewer.fallback.failedTitle")).toBe("[Ṽíéŵéŕ úńåṽåíĺåƀĺé]");
    expect(document.documentElement.lang).toBe("en-XA");
    expect(document.documentElement.dir).toBe("ltr");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-XA");
  });

  it("updates regional formatting independently from the display language", async () => {
    await setLocale("en");
    await setRegionalLocalePreference("de-DE");

    expect(formatLocalizedNumber(1234567.89)).toBe(new Intl.NumberFormat("de-DE").format(1234567.89));
    expect(formatLocalizedDateTime("2026-03-22T14:35:00Z", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })).toBe(
      new Date("2026-03-22T14:35:00Z").toLocaleString("de-DE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
    );
    expect(compareLocalizedStrings("ä", "z")).toBe("ä".localeCompare("z", "de-DE", undefined));
    expect(window.localStorage.getItem(REGIONAL_LOCALE_STORAGE_KEY)).toBe("de-DE");
  });

  it("hides the pseudo locale from production language options", () => {
    expect(isPseudoLanguageEnabled(false)).toBe(false);
    expect(getAvailableLanguages(false)).toEqual(["en"]);
  });
});
