import { describe, expect, it } from "vitest";
import { abbreviatePath } from "./pathDisplay";

const measureCharacters = (text: string) => text.length;

describe("abbreviatePath", () => {
  it("preserves a connection prefix and basename while collapsing ancestors", () => {
    expect(abbreviatePath("Demo:/Users/sambee/Projects/Archive/report.pdf", 20, measureCharacters)).toBe("Demo:/.../report.pdf");
  });

  it("keeps an omission indicator when only the connection and basename fit", () => {
    expect(abbreviatePath("Demo:/Test/Test dir", 17, measureCharacters)).toBe("Demo:/...Test dir");
  });

  it("leaves a path unchanged when it fits", () => {
    expect(abbreviatePath("Demo:/Test/report.pdf", 100, measureCharacters)).toBe("Demo:/Test/report.pdf");
  });
});
