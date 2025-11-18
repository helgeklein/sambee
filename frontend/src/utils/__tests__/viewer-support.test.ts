import { describe, expect, it } from "vitest";
import { hasViewerSupport, isImageFile } from "../FileTypeRegistry";

describe("hasViewerSupport", () => {
  it("returns true for image formats", () => {
    expect(hasViewerSupport("image/png")).toBe(true);
    expect(hasViewerSupport("image/jpeg")).toBe(true);
    expect(hasViewerSupport("image/gif")).toBe(true);
    expect(hasViewerSupport("image/webp")).toBe(true);
    expect(hasViewerSupport("image/svg+xml")).toBe(true);
  });

  it("returns true for advanced image formats", () => {
    expect(hasViewerSupport("image/vnd.adobe.photoshop")).toBe(true); // PSD
    expect(hasViewerSupport("application/postscript")).toBe(true); // EPS/AI
    expect(hasViewerSupport("image/x-eps")).toBe(true); // EPS
    expect(hasViewerSupport("image/tiff")).toBe(true); // TIFF
  });

  it("returns true for markdown", () => {
    expect(hasViewerSupport("text/markdown")).toBe(true);
  });

  it("returns false for PDF (not implemented yet)", () => {
    expect(hasViewerSupport("application/pdf")).toBe(false);
  });

  it("returns false for unknown MIME types", () => {
    expect(hasViewerSupport("application/octet-stream")).toBe(false);
    expect(hasViewerSupport("application/x-unknown")).toBe(false);
  });

  it("returns false for document formats without view", () => {
    expect(hasViewerSupport("application/msword")).toBe(false);
    expect(hasViewerSupport("application/vnd.ms-excel")).toBe(false);
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
