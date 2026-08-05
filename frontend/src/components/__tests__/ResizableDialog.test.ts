import { afterEach, describe, expect, it } from "vitest";
import {
  clampResizableDialogSize,
  getResizableDialogMaximumSize,
  type ResizableDialogConfig,
  readResizableDialogSize,
  writeResizableDialogSize,
} from "../ResizableDialog";

const TEST_STORAGE_KEY = "resizable-dialog-test-size";
const TEST_CONFIG = {
  storageKey: TEST_STORAGE_KEY,
  minWidth: 640,
  minHeight: 480,
  maxWidth: 1200,
} satisfies ResizableDialogConfig;

describe("resizable dialog size preferences", () => {
  afterEach(() => {
    window.localStorage.removeItem(TEST_STORAGE_KEY);
  });

  it("preserves 32 pixel viewport gutters at its maximum size", () => {
    expect(getResizableDialogMaximumSize(TEST_CONFIG, { width: 1024, height: 768 })).toEqual({ width: 960, height: 704 });
  });

  it("clamps a preferred size to its policy and current viewport", () => {
    expect(clampResizableDialogSize(TEST_CONFIG, { width: 400, height: 1000 }, { width: 1024, height: 768 })).toEqual({
      width: 640,
      height: 704,
    });
  });

  it("round-trips valid stored dimensions and ignores invalid data", () => {
    const size = { width: 800, height: 600 };

    writeResizableDialogSize(TEST_STORAGE_KEY, size);
    expect(readResizableDialogSize(TEST_STORAGE_KEY)).toEqual(size);

    window.localStorage.setItem(TEST_STORAGE_KEY, "not json");
    expect(readResizableDialogSize(TEST_STORAGE_KEY)).toBeNull();
  });
});
