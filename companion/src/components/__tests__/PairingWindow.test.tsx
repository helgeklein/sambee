import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import { PairingWindow } from "../PairingWindow";

const { invokeMock, listenHandlers, closeWindowMock, onCloseRequestedMock, closeRequestedHandlerRef, warnMock, errorMock } = vi.hoisted(
  () => ({
    invokeMock: vi.fn(),
    listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
    closeWindowMock: vi.fn(),
    onCloseRequestedMock: vi.fn(),
    closeRequestedHandlerRef: { current: null as ((event: { preventDefault: () => void }) => void | Promise<void>) | null },
    warnMock: vi.fn(),
    errorMock: vi.fn(),
  })
);

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
    close: closeWindowMock,
    onCloseRequested: onCloseRequestedMock.mockImplementation((handler) => {
      closeRequestedHandlerRef.current = handler;
      return Promise.resolve(() => {
        closeRequestedHandlerRef.current = null;
      });
    }),
  }),
}));

vi.mock("../../lib/logger", () => ({
  log: {
    warn: warnMock,
    error: errorMock,
  },
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

describe("PairingWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    closeWindowMock.mockReset();
    onCloseRequestedMock.mockClear();
    closeRequestedHandlerRef.current = null;
    warnMock.mockReset();
    errorMock.mockReset();
    listenHandlers.clear();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await setLocale("en");
  });

  it("rerenders idle copy when the locale changes at runtime", async () => {
    await setLocale("en");

    render(<PairingWindow />);

    expect(screen.getByRole("heading", { name: "Sambee Companion" })).toBeInTheDocument();
    await setLocale("en-XA");

    expect(await screen.findByRole("heading", { name: "[Šåḿƀéé Ćóḿṕåńíóń]" })).toBeInTheDocument();
    expect(screen.getByText(translate("pairing.idleMessage"))).toBeInTheDocument();
  });

  it("renders translated pairing states and lets the user close the success view", async () => {
    await setLocale("en-XA");
    invokeMock.mockResolvedValue(undefined);

    render(<PairingWindow />);

    expect(screen.getByRole("heading", { name: translate("app.title") })).toBeInTheDocument();
    expect(screen.getByText(translate("pairing.idleMessage"))).toBeInTheDocument();

    emitEvent("show-pairing", {
      pairing_id: "pair-1",
      origin: "https://example.test",
      pairing_code: "482901",
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: translate("pairing.title") })).toBeInTheDocument();
    });

    expect(screen.getByText("https://example.test")).toBeInTheDocument();
    expect(screen.getByText("482901")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: translate("pairing.actions.codesMatch") }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("confirm_pending_pairing", { pairingId: "pair-1" });
    });

    expect(await screen.findByRole("heading", { name: translate("pairing.approved.title") })).toBeInTheDocument();
    expect(screen.getByText(translate("pairing.approved.body", { origin: "https://example.test" }))).toBeInTheDocument();

    emitEvent("pairing-completed", undefined);

    expect(await screen.findByRole("heading", { name: translate("pairing.success.title") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: translate("pairing.actions.close") }));

    await waitFor(() => {
      expect(closeWindowMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an inline error when confirming pairing fails", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to confirm pairing"));

    render(<PairingWindow />);

    emitEvent("show-pairing", {
      pairing_id: "pair-1",
      origin: "https://example.test",
      pairing_code: "482901",
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: translate("pairing.title") })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: translate("pairing.actions.codesMatch") }));

    await waitFor(() => {
      expect(screen.getByText("Failed to confirm pairing")).toBeInTheDocument();
    });
  });

  it("rejects the pending pairing when the user closes after local approval", async () => {
    invokeMock.mockResolvedValue(undefined);

    render(<PairingWindow />);

    emitEvent("show-pairing", {
      pairing_id: "pair-1",
      origin: "https://example.test",
      pairing_code: "482901",
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: translate("pairing.title") })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: translate("pairing.actions.codesMatch") }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("confirm_pending_pairing", { pairingId: "pair-1" });
    });

    expect(await screen.findByRole("heading", { name: translate("pairing.approved.title") })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: translate("pairing.actions.close") }));
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("reject_pending_pairing", { pairingId: "pair-1" });
    expect(closeWindowMock).toHaveBeenCalledTimes(1);
  });

  it("intercepts native window close and rejects the pending pairing first", async () => {
    invokeMock.mockResolvedValue(undefined);

    render(<PairingWindow />);

    emitEvent("show-pairing", {
      pairing_id: "pair-1",
      origin: "https://example.test",
      pairing_code: "482901",
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: translate("pairing.title") })).toBeInTheDocument();
    });

    const preventDefault = vi.fn();
    await closeRequestedHandlerRef.current?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith("reject_pending_pairing", { pairingId: "pair-1" });
      expect(closeWindowMock).toHaveBeenCalledTimes(1);
    });
  });
});
