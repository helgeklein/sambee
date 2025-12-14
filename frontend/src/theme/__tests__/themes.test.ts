import { describe, expect, it } from "vitest";
import { builtInThemes, getDefaultTheme, getThemeById } from "../themes";

//
// themes.test.ts
//

describe("Theme System - themes.ts", () => {
  describe("builtInThemes", () => {
    it("should have at least 2 built-in themes", () => {
      expect(builtInThemes.length).toBeGreaterThanOrEqual(2);
    });

    it("should have sambee-light as first theme", () => {
      expect(builtInThemes[0]!.id).toBe("sambee-light");
      expect(builtInThemes[0]!.mode).toBe("light");
    });

    it("should have sambee-dark as second theme", () => {
      expect(builtInThemes[1]!.id).toBe("sambee-dark");
      expect(builtInThemes[1]!.mode).toBe("dark");
    });

    it("should have unique IDs for all themes", () => {
      const ids = builtInThemes.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have valid theme structure", () => {
      builtInThemes.forEach((theme) => {
        expect(theme).toHaveProperty("id");
        expect(theme).toHaveProperty("name");
        expect(theme).toHaveProperty("mode");
        expect(theme).toHaveProperty("primary");
        expect(theme).toHaveProperty("secondary");
        expect(theme.primary).toHaveProperty("main");
        expect(theme.secondary).toHaveProperty("main");
        expect(["light", "dark"]).toContain(theme.mode);
      });
    });

    it("should have non-empty names", () => {
      builtInThemes.forEach((theme) => {
        expect(theme.name.length).toBeGreaterThan(0);
      });
    });

    it("should have valid hex colors for primary.main", () => {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      builtInThemes.forEach((theme) => {
        expect(theme.primary.main).toMatch(hexColorRegex);
      });
    });

    it("should have valid hex colors for secondary.main", () => {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      builtInThemes.forEach((theme) => {
        expect(theme.secondary.main).toMatch(hexColorRegex);
      });
    });
  });

  describe("getThemeById", () => {
    it("should return sambee-light theme by ID", () => {
      const theme = getThemeById("sambee-light");
      expect(theme).toBeDefined();
      expect(theme?.id).toBe("sambee-light");
    });

    it("should return sambee-dark theme by ID", () => {
      const theme = getThemeById("sambee-dark");
      expect(theme).toBeDefined();
      expect(theme?.id).toBe("sambee-dark");
    });

    it("should return undefined for non-existent theme", () => {
      const theme = getThemeById("non-existent-theme");
      expect(theme).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      const theme = getThemeById("");
      expect(theme).toBeUndefined();
    });
  });

  describe("getDefaultTheme", () => {
    it("should return sambee-light when called without arguments", () => {
      const theme = getDefaultTheme();
      expect(theme.id).toBe("sambee-light");
      expect(theme.mode).toBe("light");
    });

    it("should return sambee-light when called with 'light'", () => {
      const theme = getDefaultTheme("light");
      expect(theme.id).toBe("sambee-light");
      expect(theme.mode).toBe("light");
    });

    it("should return sambee-dark when called with 'dark'", () => {
      const theme = getDefaultTheme("dark");
      expect(theme.id).toBe("sambee-dark");
      expect(theme.mode).toBe("dark");
    });

    it("should return a valid theme structure", () => {
      const theme = getDefaultTheme();
      expect(theme).toHaveProperty("id");
      expect(theme).toHaveProperty("name");
      expect(theme).toHaveProperty("mode");
      expect(theme).toHaveProperty("primary");
      expect(theme).toHaveProperty("secondary");
    });
  });

  describe("Theme color consistency", () => {
    it("sambee-light and sambee-dark should have same primary color", () => {
      const lightTheme = getThemeById("sambee-light");
      const darkTheme = getThemeById("sambee-dark");
      expect(lightTheme?.primary.main).toBe(darkTheme?.primary.main);
    });

    it("sambee-light should use golden yellow as primary", () => {
      const theme = getThemeById("sambee-light");
      expect(theme?.primary.main).toBe("#F4C430");
    });

    it("sambee-dark should use golden yellow as primary", () => {
      const theme = getThemeById("sambee-dark");
      expect(theme?.primary.main).toBe("#F4C430");
    });

    it("sambee-light should have action colors defined", () => {
      const theme = getThemeById("sambee-light");
      expect(theme?.action).toBeDefined();
      expect(theme?.action?.hover).toBeDefined();
      expect(theme?.action?.selected).toBeDefined();
    });

    it("sambee-dark should have action colors defined", () => {
      const theme = getThemeById("sambee-dark");
      expect(theme?.action).toBeDefined();
      expect(theme?.action?.hover).toBeDefined();
      expect(theme?.action?.selected).toBeDefined();
    });

    it("sambee-light and sambee-dark should have same action colors", () => {
      const lightTheme = getThemeById("sambee-light");
      const darkTheme = getThemeById("sambee-dark");
      expect(lightTheme?.action?.hover).toBe(darkTheme?.action?.hover);
      expect(lightTheme?.action?.selected).toBe(darkTheme?.action?.selected);
    });
  });
});
