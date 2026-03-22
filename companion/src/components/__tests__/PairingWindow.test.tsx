import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import { PairingWindow } from "../PairingWindow";

const { invokeMock, listenHandlers, closeWindowMock, warnMock, errorMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  closeWindowMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
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
    close: closeWindowMock,
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

  it("renders translated pairing states and auto-closes after success", async () => {
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
    vi.advanceTimersByTime(2500);

    await waitFor(() => {
      expect(closeWindowMock).toHaveBeenCalledTimes(1);
    });
  });
});
