import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedAsyncData } from "../../hooks/useCachedAsyncData";
import { SambeeThemeProvider } from "../../theme";
import type { AboutSettings as AboutSettingsData } from "../../types";
import { AboutSettings } from "../AboutSettings";

vi.mock("../../services/api", () => ({
  default: {
    getAboutSettings: vi.fn(),
  },
}));

import api from "../../services/api";

const aboutSettings: AboutSettingsData = {
  version: "0.9.24",
  build_time: "2026-08-02T10:00:00Z",
  git_commit: "5966e381",
  started_at: "2026-08-02T09:00:00Z",
  architecture: "x86_64",
  logical_cpu_count: 4,
  memory_bytes: 8589934592,
  python_runtime: "CPython 3.13.12",
  database_version: "3.48.0",
};

describe("AboutSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedAsyncData();
    vi.mocked(api.getAboutSettings).mockResolvedValue(aboutSettings);
  });

  it("displays application, runtime, and hardware information in account-style tables", async () => {
    render(
      <SambeeThemeProvider>
        <AboutSettings />
      </SambeeThemeProvider>
    );

    expect(await screen.findByRole("table", { name: "Application" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Software" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Hardware" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Version" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Database" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Memory available" })).toBeInTheDocument();
    expect(screen.getByText("SQLite 3.48.0")).toBeInTheDocument();
    expect(screen.getByText("8 GiB")).toBeInTheDocument();
    expect(screen.queryByText("Container")).not.toBeInTheDocument();
    expect(screen.queryByText("Operating system")).not.toBeInTheDocument();
  });

  it("copies all about information as formatted plain text", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <SambeeThemeProvider>
        <AboutSettings />
      </SambeeThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: "Copy about information" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Application\nVersion: 0.9.24\nBuild: Aug 2, 2026, 10:00 AM\nCommit: 5966e381")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Software\nStarted: Aug 2, 2026, 09:00 AM\nPython: CPython 3.13.12\nDatabase: SQLite 3.48.0")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Hardware\nArchitecture: x86_64\nLogical CPUs: 4\nMemory available: 8 GiB")
    );
    expect(await screen.findByText("About information copied.")).toBeInTheDocument();
  });
});
