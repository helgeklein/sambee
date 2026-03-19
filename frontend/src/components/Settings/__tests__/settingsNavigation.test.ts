import { describe, expect, it } from "vitest";
import { getSettingsCategoryByPath, getVisibleSettingsSections } from "../settingsNavigation";

describe("settingsNavigation", () => {
  it("returns the consolidated settings sections for regular users", () => {
    expect(getVisibleSettingsSections(false)).toEqual([
      {
        section: "personal",
        label: "Personal",
        categories: ["preferences", "connections"],
      },
    ]);
  });

  it("returns the consolidated settings sections for admins", () => {
    expect(getVisibleSettingsSections(true)).toEqual([
      {
        section: "personal",
        label: "Personal",
        categories: ["preferences", "connections"],
      },
      {
        section: "administration",
        label: "Administration",
        categories: ["admin-users", "admin-system"],
      },
    ]);
  });

  it("maps current settings routes to their categories", () => {
    expect(getSettingsCategoryByPath("/settings/preferences")).toBe("preferences");
    expect(getSettingsCategoryByPath("/settings/connections")).toBe("connections");
    expect(getSettingsCategoryByPath("/settings/admin/users")).toBe("admin-users");
    expect(getSettingsCategoryByPath("/settings/admin/system")).toBe("admin-system");
  });

  it("does not resolve retired legacy settings routes", () => {
    expect(getSettingsCategoryByPath("/settings/appearance")).toBeNull();
    expect(getSettingsCategoryByPath("/settings/browser")).toBeNull();
    expect(getSettingsCategoryByPath("/settings/smb-connections")).toBeNull();
    expect(getSettingsCategoryByPath("/settings/local-drives")).toBeNull();
    expect(getSettingsCategoryByPath("/settings/admin/advanced")).toBeNull();
  });
});
