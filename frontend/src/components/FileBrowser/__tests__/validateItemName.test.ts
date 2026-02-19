/**
 * validateItemName Unit Tests
 *
 * Verifies the shared name validation function used by both
 * Rename and Create Item dialogs.
 *
 * Covers:
 * - Empty / whitespace-only names
 * - Reserved names (".", "..")
 * - Invalid NTFS/SMB characters (\/:*?"<>|)
 * - Trailing spaces and periods
 * - Valid names (including edge cases)
 */

import { describe, expect, it } from "vitest";
import { INVALID_NAME_CHARS, NAME_DIALOG_STRINGS, validateItemName } from "../nameDialogStrings";

describe("validateItemName", () => {
  // ── Empty / whitespace ──────────────────────────────────────────────────

  it("rejects empty string", () => {
    expect(validateItemName("")).toBe(NAME_DIALOG_STRINGS.VALIDATION_EMPTY);
  });

  it("rejects whitespace-only string", () => {
    expect(validateItemName("   ")).toBe(NAME_DIALOG_STRINGS.VALIDATION_EMPTY);
  });

  // ── Reserved dot names ─────────────────────────────────────────────────

  it("rejects single dot '.'", () => {
    expect(validateItemName(".")).toBe(NAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES);
  });

  it("rejects double dot '..'", () => {
    expect(validateItemName("..")).toBe(NAME_DIALOG_STRINGS.VALIDATION_DOT_NAMES);
  });

  it("allows triple dot '...'", () => {
    // "..." is unusual but technically valid (not "." or "..")
    // However it ends with a period, so it should be rejected for trailing
    expect(validateItemName("...")).toBe(NAME_DIALOG_STRINGS.VALIDATION_TRAILING);
  });

  // ── Invalid NTFS characters ────────────────────────────────────────────

  it.each(["\\", "/", ":", "*", "?", '"', "<", ">", "|"])("rejects name containing '%s'", (char) => {
    expect(validateItemName(`file${char}name`)).toBe(NAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS);
  });

  it("rejects name with multiple invalid characters", () => {
    expect(validateItemName("file<>name")).toBe(NAME_DIALOG_STRINGS.VALIDATION_INVALID_CHARS);
  });

  // ── Trailing space / period ────────────────────────────────────────────

  it("accepts name with trailing space (trim removes it)", () => {
    // The frontend validateItemName trims first, so "myfile " → "myfile"
    // which is valid. The backend has the same trim-then-validate logic.
    expect(validateItemName("myfile ")).toBeNull();
  });

  it("rejects name ending with a period", () => {
    expect(validateItemName("myfile.")).toBe(NAME_DIALOG_STRINGS.VALIDATION_TRAILING);
  });

  // ── Valid names ────────────────────────────────────────────────────────

  it("accepts a simple filename", () => {
    expect(validateItemName("readme.txt")).toBeNull();
  });

  it("accepts a filename with spaces in the middle", () => {
    expect(validateItemName("my document.txt")).toBeNull();
  });

  it("accepts a directory name without extension", () => {
    expect(validateItemName("Photos")).toBeNull();
  });

  it("accepts a dotfile like .gitignore", () => {
    expect(validateItemName(".gitignore")).toBeNull();
  });

  it("accepts a name with hyphens and underscores", () => {
    expect(validateItemName("my-file_v2")).toBeNull();
  });

  it("accepts a name with parentheses and brackets", () => {
    expect(validateItemName("photo (1) [copy]")).toBeNull();
  });

  it("accepts filename with multiple dots", () => {
    expect(validateItemName("archive.tar.gz")).toBeNull();
  });

  it("accepts unicode characters", () => {
    expect(validateItemName("日本語ファイル.txt")).toBeNull();
  });
});

describe("INVALID_NAME_CHARS regex", () => {
  it("matches all forbidden NTFS characters", () => {
    const forbidden = ["\\", "/", ":", "*", "?", '"', "<", ">", "|"];
    for (const ch of forbidden) {
      expect(INVALID_NAME_CHARS.test(ch)).toBe(true);
    }
  });

  it("does not match valid characters", () => {
    const valid = ["a", "1", " ", ".", "-", "_", "(", ")", "[", "]", "+", "=", "@", "#", "~"];
    for (const ch of valid) {
      expect(INVALID_NAME_CHARS.test(ch)).toBe(false);
    }
  });
});
