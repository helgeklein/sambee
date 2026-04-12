import { describe, expect, it, vi } from "vitest";
import { createEditToolbarAction, createSaveToolbarAction } from "../viewerToolbarActions";

describe("viewerToolbarActions", () => {
  it("creates an edit toolbar action with the shared shortcut title", () => {
    const onClick = vi.fn();

    const action = createEditToolbarAction({
      onClick,
      isMobile: false,
      disabled: true,
      id: "edit-markdown",
    });

    expect(action).toMatchObject({
      id: "edit-markdown",
      kind: "icon",
      label: "Edit",
      disabled: true,
      title: "Edit (E)",
      onClick,
    });
  });

  it("creates a save toolbar action with the shared shortcut title", () => {
    const onClick = vi.fn();

    const action = createSaveToolbarAction({
      onClick,
      isMobile: true,
    });

    expect(action).toMatchObject({
      id: "save",
      kind: "icon",
      label: "Save",
      title: "Save (Ctrl+S)",
      onClick,
    });
  });
});
