import { describe, expect, it } from "vitest";
import { getDialogSurfaceTokens } from "../palette";

describe("getDialogSurfaceTokens", () => {
  it("derives dark dialog layers from the shared chrome surface", () => {
    expect(getDialogSurfaceTokens("#1F262B", "dark")).toEqual({
      backdrop: "rgba(31, 38, 43, 0.92)",
      paper: "#382c0a",
      form: "color-mix(in srgb, black 12%, #382c0a)",
    });
  });

  it("preserves the supplied background for light dialog papers", () => {
    expect(getDialogSurfaceTokens("#FBF9F4", "light")).toMatchObject({
      backdrop: undefined,
      paper: "#FBF9F4",
    });
  });
});
