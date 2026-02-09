import { describe, expect, it } from "vitest";
import { normalizeQuerySeparators } from "../search";

// ============================================================================
// normalizeQuerySeparators
// ============================================================================

describe("normalizeQuerySeparators", () => {
  it("returns the query unchanged when it contains no backslashes", () => {
    expect(normalizeQuerySeparators("abc/def")).toBe("abc/def");
  });

  it("replaces a single backslash with a forward slash", () => {
    expect(normalizeQuerySeparators("abc\\def")).toBe("abc/def");
  });

  it("replaces multiple backslashes", () => {
    expect(normalizeQuerySeparators("a\\b\\c")).toBe("a/b/c");
  });

  it("handles mixed separators", () => {
    expect(normalizeQuerySeparators("a\\b/c\\d")).toBe("a/b/c/d");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeQuerySeparators("")).toBe("");
  });

  it("handles query with no separators at all", () => {
    expect(normalizeQuerySeparators("documents")).toBe("documents");
  });
});
