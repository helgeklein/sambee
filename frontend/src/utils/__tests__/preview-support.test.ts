import { describe, expect, it } from "vitest";
import { hasPreviewSupport, isImageFile } from "../FileTypeRegistry";

describe("hasPreviewSupport", () => {
  it("returns true for image formats", () => {
    expect(hasPreviewSupport("image/png")).toBe(true);
    expect(hasPreviewSupport("image/jpeg")).toBe(true);
    expect(hasPreviewSupport("image/gif")).toBe(true);
    expect(hasPreviewSupport("image/webp")).toBe(true);
  });

  it("returns true for advanced image formats", () => {
    expect(hasPreviewSupport("image/vnd.adobe.photoshop")).toBe(true); // PSD
    expect(hasPreviewSupport("application/postscript")).toBe(true); // EPS/AI
    expect(hasPreviewSupport("image/x-eps")).toBe(true); // EPS
    expect(hasPreviewSupport("application/illustrator")).toBe(true); // AI
  });

  it("returns true for markdown", () => {
    expect(hasPreviewSupport("text/markdown")).toBe(true);
  });

  it("returns false for PDF (not implemented yet)", () => {
    expect(hasPreviewSupport("application/pdf")).toBe(false);
  });

  it("returns false for unknown MIME types", () => {
    expect(hasPreviewSupport("application/octet-stream")).toBe(false);
    expect(hasPreviewSupport("application/x-unknown")).toBe(false);
  });

  it("returns false for document formats without preview", () => {
    expect(hasPreviewSupport("application/msword")).toBe(false);
    expect(hasPreviewSupport("application/vnd.ms-excel")).toBe(false);
  });
});

describe("isImageFile", () => {
  it("returns true for AI files", () => {
    expect(isImageFile("document.ai")).toBe(true);
    expect(isImageFile("logo.AI")).toBe(true);
  });

  it("returns true for EPS files", () => {
    expect(isImageFile("graphic.eps")).toBe(true);
    expect(isImageFile("vector.EPS")).toBe(true);
  });

  it("returns true for PSD files", () => {
    expect(isImageFile("design.psd")).toBe(true);
    expect(isImageFile("layer.psb")).toBe(true);
  });

  it("returns true for standard image formats", () => {
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("icon.png")).toBe(true);
    expect(isImageFile("animation.gif")).toBe(true);
  });

  it("returns false for non-image files", () => {
    expect(isImageFile("document.pdf")).toBe(false);
    expect(isImageFile("spreadsheet.xlsx")).toBe(false);
    expect(isImageFile("text.txt")).toBe(false);
  });
});
