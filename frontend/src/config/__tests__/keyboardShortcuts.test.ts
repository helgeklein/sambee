import { describe, expect, it } from "vitest";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../keyboardShortcuts";

describe("Keyboard Shortcuts Configuration", () => {
  describe("COMMON_SHORTCUTS", () => {
    it("should have all required fields", () => {
      for (const [key, shortcut] of Object.entries(COMMON_SHORTCUTS)) {
        expect(shortcut.id, `${key} missing id`).toBeDefined();
        expect(shortcut.keys, `${key} missing keys`).toBeDefined();
        expect(shortcut.description, `${key} missing description`).toBeDefined();
        expect(shortcut.label, `${key} missing label`).toBeDefined();
      }
    });

    it("should have unique IDs", () => {
      const ids = Object.values(COMMON_SHORTCUTS).map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have valid key values", () => {
      const validKeys = [
        "Enter",
        "Escape",
        "d",
        "f",
        "F3",
        "Home",
        "End",
        "PageDown",
        "PageUp",
        "ArrowRight",
        "ArrowLeft",
      ];

      for (const shortcut of Object.values(COMMON_SHORTCUTS)) {
        const keys = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
        for (const key of keys) {
          expect(validKeys.includes(key), `Invalid key: ${key} in shortcut ${shortcut.id}`).toBe(
            true
          );
        }
      }
    });
  });

  describe("VIEWER_SHORTCUTS", () => {
    it("should have all required fields", () => {
      for (const [key, shortcut] of Object.entries(VIEWER_SHORTCUTS)) {
        expect(shortcut.id, `${key} missing id`).toBeDefined();
        expect(shortcut.keys, `${key} missing keys`).toBeDefined();
        expect(shortcut.description, `${key} missing description`).toBeDefined();
        expect(shortcut.label, `${key} missing label`).toBeDefined();
      }
    });

    it("should have unique IDs", () => {
      const ids = Object.values(VIEWER_SHORTCUTS).map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("BROWSER_SHORTCUTS", () => {
    it("should have all required fields", () => {
      for (const [key, shortcut] of Object.entries(BROWSER_SHORTCUTS)) {
        expect(shortcut.id, `${key} missing id`).toBeDefined();
        expect(shortcut.keys, `${key} missing keys`).toBeDefined();
        expect(shortcut.description, `${key} missing description`).toBeDefined();
        expect(shortcut.label, `${key} missing label`).toBeDefined();
      }
    });

    it("should have unique IDs", () => {
      const ids = Object.values(BROWSER_SHORTCUTS).map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("Global ID Uniqueness", () => {
    it("should have no duplicate IDs across all categories", () => {
      const allIds = [
        ...Object.values(COMMON_SHORTCUTS).map((s) => s.id),
        ...Object.values(VIEWER_SHORTCUTS).map((s) => s.id),
        ...Object.values(BROWSER_SHORTCUTS).map((s) => s.id),
      ];

      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });
});
