import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileOperationAction } from "../../../pages/FileBrowser/fileOperationActions";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { FileOperationsToolbar } from "../FileOperationsToolbar";

function createAction(id: FileOperationAction["id"], overrides: Partial<FileOperationAction> = {}): FileOperationAction {
  return {
    id,
    label: id,
    tooltip: `${id} (F1)`,
    enabled: true,
    onClick: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(actions: FileOperationAction[]) {
  return render(
    <SambeeThemeProvider>
      <FileOperationsToolbar actions={actions} moreLabel="More" />
    </SambeeThemeProvider>
  );
}

describe("FileOperationsToolbar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders text command buttons and delegates enabled actions", () => {
    const onClick = vi.fn();
    renderToolbar([createAction("copy", { label: "Copy", tooltip: "Copy (F5)", onClick })]);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not invoke disabled actions", () => {
    const onClick = vi.fn();
    renderToolbar([createAction("delete", { label: "Delete", enabled: false, onClick })]);

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the command shortcut in a button tooltip", async () => {
    const user = userEvent.setup();
    renderToolbar([createAction("copy", { label: "Copy", tooltip: "Copy (F5)" })]);

    await user.hover(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copy (F5)");
  });

  it("moves lower-priority commands into More when the toolbar is narrow", async () => {
    const observers: ResizeObserverCallback[] = [];
    let toolbarWidth = 180;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe(_target: Element) {
          observers.at(-1)?.([{ contentRect: { width: toolbarWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      }
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.operationId) return { width: 100 } as DOMRect;
      if (this.hasAttribute("data-more-button")) return { width: 60 } as DOMRect;
      if (this.dataset.testid === "file-operations-toolbar") return { width: toolbarWidth } as DOMRect;
      return { width: 0 } as DOMRect;
    });
    const copy = createAction("copy", { label: "Copy" });
    const move = createAction("move", { label: "Move" });

    renderToolbar([copy, move]);

    await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Move" })).toBeInTheDocument();

    toolbarWidth = 600;
    act(() => observers[0]([], {} as ResizeObserver));

    await waitFor(() => expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });
});
