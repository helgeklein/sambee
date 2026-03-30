import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../i18n";
import { type BrowserCommandContext, getEnabledBrowserCommands } from "../browserCommands";

function createContext(): BrowserCommandContext {
  return {
    isDualMode: true,
    useCompactLayout: false,
    settingsOpen: false,
    mobileSettingsOpen: false,
    helpOpen: false,
    quickBarMode: "smart",
    hasFiles: true,
    hasFocusedFile: true,
    connectionSelected: true,
    connectionWritable: true,
    canOpenFocusedFileInApp: true,
    canCopyToOtherPane: true,
    canMoveToOtherPane: true,
    openQuickNav: () => {},
    openFilterMode: () => {},
    openCommandMode: () => {},
    openSettings: () => {},
    openConnectionsSettings: () => {},
    openHelp: () => {},
    refresh: () => {},
    navigateUp: () => {},
    openFocusedItem: () => {},
    renameFocusedItem: () => {},
    deleteFocusedItem: () => {},
    newDirectory: () => {},
    newFile: () => {},
    openInApp: () => {},
    toggleDualPane: () => {},
    focusLeftPane: () => {},
    focusRightPane: () => {},
    switchPane: () => {},
    copyToOtherPane: () => {},
    moveToOtherPane: () => {},
  };
}

describe("browserCommands", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("localizes command titles and categories", async () => {
    const context = createContext();

    expect(getEnabledBrowserCommands(context)[0]).toMatchObject({
      title: "Open Smart Navigation",
      category: "Navigation",
      description: "Jump to directories from the smart navigation bar",
    });

    await setLocale("en-XA");

    expect(getEnabledBrowserCommands(context)[0]).toMatchObject({
      title: "[Óṕéń Šḿåŕť Ńåṽíğåťíóń]",
      category: "[Ńåṽíğåťíóń]",
      description: "[Ĵúḿṕ ťó ďíŕéćťóŕíéš ƒŕóḿ ťħé šḿåŕť ńåṽíğåťíóń ƀåŕ]",
    });
  });

  it("omits write commands for read-only connections", () => {
    const context = createContext();
    context.connectionWritable = false;
    context.canOpenFocusedFileInApp = false;
    context.canCopyToOtherPane = false;
    context.canMoveToOtherPane = false;

    const commandIds = getEnabledBrowserCommands(context).map((command) => command.id);

    expect(commandIds).not.toContain("browser.rename");
    expect(commandIds).not.toContain("browser.delete");
    expect(commandIds).not.toContain("browser.newDirectory");
    expect(commandIds).not.toContain("browser.newFile");
    expect(commandIds).not.toContain("browser.openInApp");
    expect(commandIds).not.toContain("browser.copyToOtherPane");
    expect(commandIds).not.toContain("browser.moveToOtherPane");
  });
});
