import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseCompanionResult } from "../../hooks/useCompanion";
import api from "../../services/api";
import { getBackendAvailabilitySnapshot, resetBackendAvailabilityForTests } from "../../services/backendAvailability";
import { type ApiMock, setupSuccessfulApiMocks } from "../../test/helpers";

const mockUseCompanion = vi.fn<() => UseCompanionResult>();
const mockBuildCompanionWsUrl = vi.fn<() => Promise<string | null>>();

vi.mock("../../services/api");
vi.mock("../../hooks/useCompanion", () => ({
  useCompanion: () => mockUseCompanion(),
}));
vi.mock("../../services/companion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/companion")>();
  return {
    ...actual,
    buildCompanionWsUrl: () => mockBuildCompanionWsUrl(),
  };
});

class InspectableWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: InspectableWebSocket[] = [];

  url: string;
  readyState = InspectableWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    InspectableWebSocket.instances.push(this);
  }

  close() {
    this.readyState = InspectableWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  send(_data: string) {}
  addEventListener() {}
  removeEventListener() {}
}

const buildDefaultCompanionResult = (): UseCompanionResult => ({
  status: "unavailable",
  drives: [],
  initiatePairing: vi.fn(),
  confirmPairing: vi.fn(),
  refresh: vi.fn(),
  loading: false,
});

describe("FileBrowser WebSocket behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackendAvailabilityForTests();
    localStorage.setItem("access_token", "fake-token");
    InspectableWebSocket.instances = [];
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: InspectableWebSocket,
    });

    mockUseCompanion.mockReturnValue(buildDefaultCompanionResult());
    mockBuildCompanionWsUrl.mockResolvedValue("ws://localhost:21549/api/ws?hmac=test&ts=1&origin=http%3A%2F%2Flocalhost%3A3000");

    setupSuccessfulApiMocks(api as unknown as ApiMock);
  });

  it("does not mark the backend as reconnecting when the realtime socket closes", async () => {
    const { renderBrowser } = await import("./FileBrowser.test.utils");

    renderBrowser("/browse/smb/test-server-1");

    await waitFor(() => {
      expect(InspectableWebSocket.instances.length).toBeGreaterThan(0);
    });

    const backendSocket = InspectableWebSocket.instances.find((socket) => socket.url.includes("/api/ws"));
    expect(backendSocket?.url).toBe("ws://localhost:3000/api/ws?token=fake-token");

    backendSocket?.close();

    expect(getBackendAvailabilitySnapshot().status).toBe("available");
  });

  it("does not build a companion WebSocket while viewing only SMB panes", async () => {
    mockUseCompanion.mockReturnValue({
      ...buildDefaultCompanionResult(),
      status: "paired",
    });

    const { renderBrowser } = await import("./FileBrowser.test.utils");

    renderBrowser("/browse/smb/test-server-1");

    await waitFor(() => {
      expect(api.listDirectory).toHaveBeenCalled();
    });

    expect(mockBuildCompanionWsUrl).not.toHaveBeenCalled();
    expect(InspectableWebSocket.instances.every((socket) => !socket.url.includes("21549"))).toBe(true);
  });

  it("builds a companion WebSocket after a visible local-drive pane becomes active", async () => {
    mockUseCompanion.mockReturnValue({
      ...buildDefaultCompanionResult(),
      status: "paired",
    });

    const { renderBrowser } = await import("./FileBrowser.test.utils");

    renderBrowser("/browse/local/c/Users");

    await waitFor(() => {
      expect(mockBuildCompanionWsUrl).toHaveBeenCalled();
    });

    expect(InspectableWebSocket.instances.some((socket) => socket.url.includes("21549"))).toBe(true);
  });
});
