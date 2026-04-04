import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();

  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => (
      <actual.MemoryRouter initialEntries={["/browse"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {children}
      </actual.MemoryRouter>
    ),
  };
});

import App from "../App";
import { markBackendUnavailable, resetBackendAvailabilityForTests } from "../services/backendAvailability";
import { subscribeBackendRecoveryReconnect } from "../services/backendRecoveryEvents";

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

    useEffect(() => {
      return subscribeBackendRecoveryReconnect(({ reason }) => {
        setLastReason(reason);
      });
    }, []);

    return <div data-testid="mock-file-browser">{lastReason}</div>;
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
});
