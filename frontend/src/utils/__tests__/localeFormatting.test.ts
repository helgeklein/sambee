import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { compareLocalizedStrings, formatLocalizedDateTime, formatLocalizedNumber } from "../localeFormatting";

describe("localeFormatting", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await setLocale("en");
  });

  it("uses the active i18n locale for dates, numbers, and comparisons", async () => {
    await setLocale("en-XA");

    const toLocaleStringSpy = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("formatted-date");
    const localeCompareSpy = vi.spyOn(String.prototype, "localeCompare");

    expect(formatLocalizedDateTime("2024-01-02T03:04:05Z", { year: "numeric" })).toBe("formatted-date");
    expect(toLocaleStringSpy).toHaveBeenCalledWith("en-XA", { year: "numeric" });

    compareLocalizedStrings("alpha", "beta");
    expect(localeCompareSpy).toHaveBeenCalledWith("beta", "en-XA", undefined);

    expect(formatLocalizedNumber(1234.5)).toBe(new Intl.NumberFormat("en-XA").format(1234.5));
  });
});
