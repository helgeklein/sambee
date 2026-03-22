import { afterEach, describe, expect, it, vi } from "vitest";
import { createShareFile, shareNativeContent, shouldWarmNativeSharePayload, supportsNativeShare } from "../nativeShare";

const originalNavigator = globalThis.navigator;

function setNavigatorMock(mockNavigator: Partial<Navigator>) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: mockNavigator,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  vi.restoreAllMocks();
});

describe("nativeShare", () => {
  it("reports whether native share is supported", () => {
    setNavigatorMock({ share: vi.fn() as unknown as Navigator["share"] });

    expect(supportsNativeShare()).toBe(true);
  });

  it("skips warming when save-data is enabled", () => {
    setNavigatorMock({
      share: vi.fn() as unknown as Navigator["share"],
      connection: { saveData: true },
    } as Partial<Navigator>);

    expect(shouldWarmNativeSharePayload()).toBe(false);
  });

  it("skips warming on slow connection hints", () => {
    setNavigatorMock({
      share: vi.fn() as unknown as Navigator["share"],
      connection: { effectiveType: "3g" },
    } as Partial<Navigator>);

    expect(shouldWarmNativeSharePayload()).toBe(false);
  });

  it("allows warming when no constrained-network hint is present", () => {
    setNavigatorMock({
      share: vi.fn() as unknown as Navigator["share"],
      connection: { effectiveType: "4g", saveData: false },
    } as Partial<Navigator>);

    expect(shouldWarmNativeSharePayload()).toBe(true);
  });

  it("creates a File with the blob type", () => {
    const file = createShareFile(new Blob(["hello"], { type: "text/plain" }), "hello.txt");

    expect(file.name).toBe("hello.txt");
    expect(file.type).toBe("text/plain");
  });

  it("shares files when file sharing is supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    setNavigatorMock({
      share: share as unknown as Navigator["share"],
      canShare: canShare as unknown as Navigator["canShare"],
    });

    const file = createShareFile(new Blob(["hello"], { type: "text/plain" }), "hello.txt");
    const result = await shareNativeContent({ file, title: "hello.txt" });

    expect(result).toBe("shared");
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(share).toHaveBeenCalledWith({ files: [file], title: "hello.txt" });
  });

  it("falls back to text sharing when file sharing is unavailable", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    setNavigatorMock({
      share: share as unknown as Navigator["share"],
      canShare: canShare as unknown as Navigator["canShare"],
    });

    const file = createShareFile(new Blob(["hello"], { type: "text/plain" }), "hello.txt");
    const result = await shareNativeContent({ file, title: "hello.txt", text: "hello" });

    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "hello.txt", text: "hello" });
  });

  it("returns unsupported when no shareable data remains", async () => {
    const share = vi.fn();
    const canShare = vi.fn().mockReturnValue(false);
    setNavigatorMock({
      share: share as unknown as Navigator["share"],
      canShare: canShare as unknown as Navigator["canShare"],
    });

    const file = createShareFile(new Blob(["hello"], { type: "text/plain" }), "hello.txt");
    const result = await shareNativeContent({ file });

    expect(result).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });

  it("treats user cancellation as a non-error outcome", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    const canShare = vi.fn().mockReturnValue(true);
    setNavigatorMock({
      share: share as unknown as Navigator["share"],
      canShare: canShare as unknown as Navigator["canShare"],
    });

    const file = createShareFile(new Blob(["hello"], { type: "text/plain" }), "hello.txt");
    const result = await shareNativeContent({ file });

    expect(result).toBe("cancelled");
  });
});
