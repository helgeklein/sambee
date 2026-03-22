import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { CURRENT_BUILD_INFO } from "../../utils/buildInfo";
import { fetchVersionInfo } from "../../utils/version";
import { AppUpdatePrompt } from "../AppUpdatePrompt";

vi.mock("../../utils/version", () => ({
  fetchVersionInfo: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function renderWithProvider() {
  return render(
    <SambeeThemeProvider>
      <AppUpdatePrompt />
    </SambeeThemeProvider>
  );
}

describe("AppUpdatePrompt", () => {
  it("stays hidden when the running build matches the server build", async () => {
    vi.mocked(fetchVersionInfo).mockResolvedValue({
      version: CURRENT_BUILD_INFO.version,
      build_time: "2026-03-22T00:00:00Z",
      git_commit: CURRENT_BUILD_INFO.git_commit,
    });

    renderWithProvider();

    await waitFor(() => {
      expect(fetchVersionInfo).toHaveBeenCalled();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays hidden when the server commit is unknown but the version matches", async () => {
    vi.mocked(fetchVersionInfo).mockResolvedValue({
      version: CURRENT_BUILD_INFO.version,
      build_time: "2026-03-22T00:00:00Z",
      git_commit: "unknown",
    });

    renderWithProvider();

    await waitFor(() => {
      expect(fetchVersionInfo).toHaveBeenCalled();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a reload prompt when the server build is newer", async () => {
    vi.mocked(fetchVersionInfo).mockResolvedValue({
      version: "0.5.1",
      build_time: "2026-03-22T00:00:00Z",
      git_commit: "abcdef123456",
    });

    renderWithProvider();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("A newer version of Sambee is available.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reload now" }));

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
