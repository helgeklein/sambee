import { describe, expect, it } from "vitest";
import {
  assertLocalPreviewSupported,
  LOCAL_IMAGE_CONVERSION_UNAVAILABLE_MESSAGE,
  LOCAL_PDF_NORMALIZATION_UNAVAILABLE_MESSAGE,
  PreviewUnavailableError,
} from "./previewPolicy";

describe("assertLocalPreviewSupported", () => {
  it("rejects conversion-dependent image previews before transport", () => {
    expect(() => assertLocalPreviewSupported("archive/photo.jxl", { kind: "image" })).toThrow(LOCAL_IMAGE_CONVERSION_UNAVAILABLE_MESSAGE);
  });

  it("rejects normalized PDF previews before transport", () => {
    expect(() => assertLocalPreviewSupported("archive/report.pdf", { kind: "pdf", variant: "normalized" })).toThrow(
      LOCAL_PDF_NORMALIZATION_UNAVAILABLE_MESSAGE
    );
  });

  it("allows native images, original PDFs, text, and downloads", () => {
    expect(() => assertLocalPreviewSupported("archive/photo.png", { kind: "image" })).not.toThrow();
    expect(() => assertLocalPreviewSupported("archive/report.pdf", { kind: "pdf" })).not.toThrow();
    expect(() => assertLocalPreviewSupported("archive/readme.txt", { kind: "text" })).not.toThrow();
    expect(() => assertLocalPreviewSupported("archive/photo.jxl", { kind: "image" }, { download: true })).not.toThrow();
  });

  it("provides a stable error code for viewer feedback", () => {
    expect(() => assertLocalPreviewSupported("photo.heic", { kind: "image" })).toThrow(PreviewUnavailableError);
    try {
      assertLocalPreviewSupported("photo.heic", { kind: "image" });
    } catch (error) {
      expect(error).toMatchObject({ code: "preview_transformation_unavailable" });
    }
  });
});
