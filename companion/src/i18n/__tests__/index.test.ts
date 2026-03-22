import { afterEach, describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, setLocale, translate } from "../index";

describe("companion i18n", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("switches representative companion strings when the locale changes", async () => {
    expect(translate("pairing.title")).toBe("Confirm this pairing request");
    expect(translate("doneEditing.buttons.doneUpload")).toBe("✓ Done Editing — Hold to Upload");
    expect(translate("appPicker.title", { extension: "docx" })).toBe("Choose an app to open this .docx file");
    expect(translate("preferences.title")).toBe("Preferences");

    await setLocale("en-XA");

    expect(translate("pairing.title")).toBe("[Ćóńƒíŕḿ ťħíš ṕåíŕíńğ ŕéqúéšť]");
    expect(translate("doneEditing.buttons.doneUpload")).toBe("[✓ Ďóńé Éďíťíńğ — Ħóĺď ťó Úṕĺóåď]");
    expect(translate("appPicker.title", { extension: "docx" })).toBe("[Ćħóóšé åń åṕṕ ťó óṕéń ťħíš .docx ƒíĺé]");
    expect(translate("preferences.title")).toBe("[Ṕŕéƒéŕéńćéš]");
    expect(document.documentElement.lang).toBe("en-XA");
    expect(document.documentElement.dir).toBe("ltr");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-XA");
  });
});
