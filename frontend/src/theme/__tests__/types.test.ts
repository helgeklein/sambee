import { describe, expect, it } from "vitest";
import { THEME_SCHEMA } from "../types";

//
// types.test.ts
//

describe("Theme System - types.ts", () => {
  describe("THEME_SCHEMA", () => {
    it("should define schema for id field", () => {
      expect(THEME_SCHEMA["id"]).toBeDefined();
      expect(THEME_SCHEMA["id"]?.label).toBe("Theme ID");
      expect(THEME_SCHEMA["id"]?.type).toBe("text");
      expect(THEME_SCHEMA["id"]?.required).toBe(true);
    });

    it("should define schema for name field", () => {
      expect(THEME_SCHEMA["name"]).toBeDefined();
      expect(THEME_SCHEMA["name"]?.label).toBe("Theme Name");
      expect(THEME_SCHEMA["name"]?.type).toBe("text");
      expect(THEME_SCHEMA["name"]?.required).toBe(true);
    });

    it("should define schema for mode field with options", () => {
      expect(THEME_SCHEMA["mode"]).toBeDefined();
      expect(THEME_SCHEMA["mode"]?.label).toBe("Theme Mode");
      expect(THEME_SCHEMA["mode"]?.type).toBe("select");
      expect(THEME_SCHEMA["mode"]?.required).toBe(true);
      expect(THEME_SCHEMA["mode"]?.options).toEqual(["light", "dark"]);
    });

    it("should define schema for primary palette", () => {
      expect(THEME_SCHEMA["primary"]).toBeDefined();
      expect(THEME_SCHEMA["primary"]?.label).toBe("Primary Color");
      expect(THEME_SCHEMA["primary"]?.type).toBe("color");
      expect(THEME_SCHEMA["primary"]?.required).toBe(true);
    });

    it("should define schema for primary.main field", () => {
      expect(THEME_SCHEMA["primary"]?.fields?.["main"]).toBeDefined();
      expect(THEME_SCHEMA["primary"]?.fields?.["main"]?.label).toBe("Main");
      expect(THEME_SCHEMA["primary"]?.fields?.["main"]?.type).toBe("color");
      expect(THEME_SCHEMA["primary"]?.fields?.["main"]?.required).toBe(true);
    });

    it("should define optional background schema", () => {
      expect(THEME_SCHEMA["background"]).toBeDefined();
      expect(THEME_SCHEMA["background"]?.required).toBe(false);
      expect(THEME_SCHEMA["background"]?.type).toBe("color");
    });

    it("should define optional text schema", () => {
      expect(THEME_SCHEMA["text"]).toBeDefined();
      expect(THEME_SCHEMA["text"]?.required).toBe(false);
      expect(THEME_SCHEMA["text"]?.type).toBe("color");
    });

    it("should have descriptions for all main fields", () => {
      expect(THEME_SCHEMA["id"]?.description).toBeTruthy();
      expect(THEME_SCHEMA["name"]?.description).toBeTruthy();
      expect(THEME_SCHEMA["mode"]?.description).toBeTruthy();
      expect(THEME_SCHEMA["primary"]?.description).toBeTruthy();
    });

    it("should use correct field types", () => {
      const validTypes = ["text", "color", "select", "object"];

      Object.values(THEME_SCHEMA).forEach((field) => {
        expect(validTypes).toContain(field.type);
      });
    });

    it("should mark core fields as required", () => {
      expect(THEME_SCHEMA["id"]?.required).toBe(true);
      expect(THEME_SCHEMA["name"]?.required).toBe(true);
      expect(THEME_SCHEMA["mode"]?.required).toBe(true);
      expect(THEME_SCHEMA["primary"]?.required).toBe(true);
    });

    it("should mark optional fields as not required", () => {
      expect(THEME_SCHEMA["description"]?.required).toBe(false);
      expect(THEME_SCHEMA["background"]?.required).toBe(false);
      expect(THEME_SCHEMA["text"]?.required).toBe(false);
      expect(THEME_SCHEMA["action"]?.required).toBe(false);
    });

    it("should define optional action schema", () => {
      expect(THEME_SCHEMA["action"]).toBeDefined();
      expect(THEME_SCHEMA["action"]?.required).toBe(false);
      expect(THEME_SCHEMA["action"]?.type).toBe("color");
    });

    it("should define schema for action.hover field", () => {
      expect(THEME_SCHEMA["action"]?.fields?.["hover"]).toBeDefined();
      expect(THEME_SCHEMA["action"]?.fields?.["hover"]?.label).toBe("Hover State");
      expect(THEME_SCHEMA["action"]?.fields?.["hover"]?.type).toBe("color");
      expect(THEME_SCHEMA["action"]?.fields?.["hover"]?.required).toBe(false);
    });

    it("should define schema for action.selected field", () => {
      expect(THEME_SCHEMA["action"]?.fields?.["selected"]).toBeDefined();
      expect(THEME_SCHEMA["action"]?.fields?.["selected"]?.label).toBe("Selected State");
      expect(THEME_SCHEMA["action"]?.fields?.["selected"]?.type).toBe("color");
      expect(THEME_SCHEMA["action"]?.fields?.["selected"]?.required).toBe(false);
    });
  });
});
