import { afterEach, describe, expect, it } from "vitest";
import {
  clampSettingsDialogSize,
  getSettingsDialogMaximumSize,
  readSettingsDialogSize,
  SETTINGS_DIALOG_SIZE_STORAGE_KEY,
  writeSettingsDialogSize,
} from "../settingsDialogSize";

describe("settings dialog size preferences", () => {
  afterEach(() => {
    window.localStorage.removeItem(SETTINGS_DIALOG_SIZE_STORAGE_KEY);
  });

  it("preserves 32 pixel gutters around the maximum size", () => {
    expect(getSettingsDialogMaximumSize({ width: 1024, height: 768 })).toEqual({ width: 960, height: 704 });
  });

  it("clamps a stored size to the current viewport", () => {
    expect(clampSettingsDialogSize({ width: 1200, height: 1000 }, { width: 1024, height: 768 })).toEqual({
      width: 960,
      height: 704,
    });
  });

  it("keeps a desktop dialog large enough for the navigation rail and content", () => {
    expect(clampSettingsDialogSize({ width: 640, height: 480 }, { width: 1200, height: 900 })).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("uses the maximum size when the viewport is smaller than the usable minimum", () => {
    expect(clampSettingsDialogSize({ width: 640, height: 480 }, { width: 600, height: 400 })).toEqual({
      width: 536,
      height: 336,
    });
  });

  it("round-trips a valid user-selected size", () => {
    const size = { width: 900, height: 640 };

    writeSettingsDialogSize(size);

    expect(readSettingsDialogSize()).toEqual(size);
  });

  it("ignores malformed persisted data", () => {
    window.localStorage.setItem(SETTINGS_DIALOG_SIZE_STORAGE_KEY, "not json");

    expect(readSettingsDialogSize()).toBeNull();
  });
});
