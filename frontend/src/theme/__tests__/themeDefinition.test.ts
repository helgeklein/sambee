import { describe, expect, it } from "vitest";
import { COLOR_ROLES, colorAt, editableDefinition, parseThemeImport, validateThemeDefinition, withColor } from "../themeDefinition";
import { builtInThemes } from "../themes";

describe("theme definitions", () => {
  it("defines every editable role explicitly in both built-in themes", () => {
    for (const theme of builtInThemes) {
      expect(validateThemeDefinition(theme)).toBeNull();
      for (const role of COLOR_ROLES) expect(colorAt(theme, role.path)).toMatch(/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/);
    }
    expect(COLOR_ROLES.map((role) => role.path)).not.toContain("background.paper");
    expect(COLOR_ROLES.map((role) => role.path)).toContain("components.alert.error.icon");
    expect(COLOR_ROLES.map((role) => role.path)).toContain("components.markdownViewer.document.headingBorder");
  });

  it("round trips alpha colors and ignores an imported identity", () => {
    const original = withColor(builtInThemes[0]!, "components.markdownViewer.document.headingBorder", "#112233aa");
    expect(colorAt(original, "components.markdownViewer.document.headingBorder")).toBe("#112233AA");
    const parsed = parseThemeImport(JSON.stringify({ version: 1, definition: { ...editableDefinition(original), id: "stolen" } }));
    expect(parsed.id).toBe("draft");
    expect(validateThemeDefinition(parsed)).toBeNull();
  });

  it("normalizes opaque alpha but preserves translucent and six-digit colors", () => {
    const original = builtInThemes[0]!;
    expect(withColor(original, "primary.main", "#112233ff").primary.main).toBe("#112233");
    expect(withColor(original, "primary.main", "#11223388").primary.main).toBe("#11223388");
    expect(withColor(original, "primary.main", "#1122ff").primary.main).toBe("#1122FF");
    expect(withColor(original, "primary.main", "#GGGGGGff").primary.main).toBe("#GGGGGGFF");
  });

  it("rejects malformed, incomplete, and unsupported imports", () => {
    expect(() => parseThemeImport("not json")).toThrow();
    expect(() => parseThemeImport(JSON.stringify({ version: 2, definition: editableDefinition(builtInThemes[0]!) }))).toThrow();
    const incomplete = editableDefinition(builtInThemes[0]!);
    delete incomplete.components?.markdownViewer?.document;
    expect(() => parseThemeImport(JSON.stringify({ version: 1, definition: incomplete }))).toThrow();
    expect(() =>
      parseThemeImport(JSON.stringify({ version: 1, definition: { ...editableDefinition(builtInThemes[0]!), name: null } }))
    ).toThrow(/name/);
    const extra = editableDefinition(builtInThemes[0]!);
    expect(() =>
      parseThemeImport(JSON.stringify({ version: 1, definition: { ...extra, primary: { ...extra.primary, stray: "#112233" } } }))
    ).toThrow(/primary.stray/);
    const invalid = withColor(builtInThemes[0]!, "primary.main", "#12345678");
    invalid.primary.main = "invalid";
    expect(validateThemeDefinition(invalid)).toMatch(/Main/);
  });
});
