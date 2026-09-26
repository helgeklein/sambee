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

  it("uses the listed MIME type when raw content lacks one", () => {
    expect(createShareFile(new Blob(["hello"]), "hello.txt", "text/plain").type).toBe("text/plain");
  });

  it("uses the listed MIME type when the raw download is generic", () => {
    const rawBlob = new Blob(["%PDF-1.4"], { type: "application/octet-stream" });
    expect(createShareFile(rawBlob, "document.pdf", "application/pdf").type).toBe("application/pdf");
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

  it("shares multiple original files in one invocation", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    setNavigatorMock({ share, canShare } as Partial<Navigator>);

    const files = [createShareFile(new Blob(["first"]), "first.txt"), createShareFile(new Blob(["second"]), "second.txt")];
    expect(await shareNativeContent({ files })).toBe("shared");
    expect(canShare).toHaveBeenCalledWith({ files });
    expect(share).toHaveBeenCalledWith({ files });
  });

  it("never falls back to text when a file-only share is unsupported", async () => {
    const share = vi.fn();
    setNavigatorMock({ share, canShare: vi.fn().mockReturnValue(false) } as Partial<Navigator>);

    const files = [createShareFile(new Blob(["first"]), "first.txt")];
    expect(await shareNativeContent({ files, title: "first.txt" })).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
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
