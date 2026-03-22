import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import { DoneEditingWindow } from "../DoneEditingWindow";

const HOLD_DURATION_MS = 1500;

const { invokeMock, listenHandlers } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
    listenHandlers.set(eventName, callback);
    return Promise.resolve(() => {
      listenHandlers.delete(eventName);
    });
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "done-editing-test",
  }),
}));

function emitEvent<TPayload>(eventName: string, payload: TPayload) {
  const handler = listenHandlers.get(eventName);

  if (!handler) {
    throw new Error(`Missing listener for ${eventName}`);
  }

  act(() => {
    handler({ payload });
  });
}

describe("DoneEditingWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenHandlers.clear();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await setLocale("en");
  });

  it("renders translated modified-state UI and uploads after a completed hold", async () => {
    await setLocale("en-XA");

    invokeMock.mockImplementation((command: string) => {
      if (command === "get_done_editing_context") {
        return Promise.resolve({
          operation_id: "edit-1",
          filename: "report.docx",
          app_name: "LibreOffice Writer",
        });
      }

      if (command === "finish_editing") {
        return Promise.resolve("ok");
      }

      return Promise.resolve(undefined);
    });

    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) =>
        window.setTimeout(() => {
          now = HOLD_DURATION_MS;
          callback(now);
        }, 16)
      )
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((handle: number) => {
        window.clearTimeout(handle);
      })
    );

    render(<DoneEditingWindow />);

    await waitFor(() => {
      expect(screen.getByText("✎ report.docx")).toBeInTheDocument();
    });

    expect(screen.getByText(translate("doneEditing.openedIn", { appName: "LibreOffice Writer" }))).toBeInTheDocument();

    emitEvent("file-status", {
      kind: "modified",
      modifiedAt: "12:34:56",
    });

    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent === `${translate("doneEditing.statusLabel")} ${translate("doneEditing.modifiedAt", { time: "12:34:56" })}`
      )
    ).toBeInTheDocument();
    expect(screen.getByText(translate("doneEditing.buttons.discardHold"))).toBeInTheDocument();

    const doneButton = screen.getByText(translate("doneEditing.buttons.doneUpload")).closest("button");

    expect(doneButton).not.toBeNull();

    fireEvent.mouseDown(doneButton!);
    vi.advanceTimersByTime(16);
    fireEvent.mouseUp(doneButton!);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("finish_editing", { operationId: "edit-1" });
    });

    emitEvent("upload-progress", { progress: 0.42 });

    const uploadProgress = screen.getByRole("progressbar", { name: translate("doneEditing.aria.uploadProgress") });
    expect(uploadProgress).toHaveAttribute("aria-valuenow", "42");
  });
});
