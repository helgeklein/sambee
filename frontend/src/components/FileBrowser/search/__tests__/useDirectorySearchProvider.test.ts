import { describe, expect, it } from "vitest";
import { getDirectoryResultPresentation } from "../useDirectorySearchProvider";

describe("getDirectoryResultPresentation", () => {
  it("returns proportional-renderer data with a highlighted smart path", () => {
    expect(getDirectoryResultPresentation("Documents/Quarterly Reports/2026", "Reports")).toEqual({
      primaryText: "…/Quarterly Reports/2026",
      secondaryText: "/Documents/",
      primaryHighlight: { start: 12, end: 19 },
    });
  });

  it("uses the connection root as context when a shallow directory has no parent path", () => {
    expect(getDirectoryResultPresentation("Documents", "Doc")).toEqual({
      primaryText: "Documents",
      secondaryText: "/",
      primaryHighlight: { start: 0, end: 3 },
    });
  });

  it("preserves a root marker in a truncated rooted path's parent context", () => {
    expect(getDirectoryResultPresentation("/Documents/Quarterly Reports/2026", "Reports")).toEqual({
      primaryText: "…/Quarterly Reports/2026",
      secondaryText: "/Documents/",
      primaryHighlight: { start: 12, end: 19 },
    });
  });
});
