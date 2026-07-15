import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();

  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => (
      <actual.MemoryRouter initialEntries={["/browse"]}>{children}</actual.MemoryRouter>
    ),
  };
});

import App from "../App";
import { markBackendUnavailable, resetBackendAvailabilityForTests } from "../services/backendAvailability";
import { subscribeBackendRecoveryConfirmed, subscribeBackendRecoveryReconnect } from "../services/backendRecoveryEvents";

vi.mock("../components/AppUpdatePrompt", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("../i18n/CompanionLocalizationSync", () => ({
  CompanionLocalizationSync: () => null,
}));

vi.mock("../pages/Login", () => ({
  __esModule: true,
  default: () => <div>Login Page</div>,
}));

vi.mock("../pages/FileBrowser", () => ({
  __esModule: true,
  default: function MockFileBrowser() {
    const [lastReason, setLastReason] = useState<string>("none");
    const [recoveredReason, setRecoveredReason] = useState<string>("none");

    useEffect(() => {
      const unsubscribeReconnect = subscribeBackendRecoveryReconnect(({ reason }) => {
        setLastReason(reason);
      });

      const unsubscribeRecovered = subscribeBackendRecoveryConfirmed(({ reason }) => {
        setRecoveredReason(reason);
      });

      return () => {
        unsubscribeReconnect();
        unsubscribeRecovered();
      };
    }, []);

    return (
      <div>
        <div data-testid="mock-file-browser">{lastReason}</div>
        <div data-testid="mock-file-browser-recovered">{recoveredReason}</div>
      </div>
    );
  },
}));

describe("App backend recovery integration", () => {
  it("emits a reconnect event on focus when backend recovery is needed", async () => {
    resetBackendAvailabilityForTests();

    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByTestId("mock-file-browser")).toHaveTextContent("none");

    act(() => {
      markBackendUnavailable("offline");
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-file-browser")).toHaveTextContent("backend-status-change");
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-file-browser")).toHaveTextContent("window-focus");
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("emits a confirmed recovery event when a proactive probe succeeds", async () => {
    resetBackendAvailabilityForTests();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByTestId("mock-file-browser-recovered")).toHaveTextContent("none");

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-file-browser-recovered")).toHaveTextContent("health-probe-success");
    });
  });

  it("does not emit a confirmed recovery event during a normal backend recovery transition", async () => {
    markBackendUnavailable("offline");

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("mock-file-browser")).toHaveTextContent("health-probe-success");
    });

    expect(screen.getByTestId("mock-file-browser-recovered")).toHaveTextContent("none");
  });
});
