import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { ViewModeSelector } from "../ViewModeSelector";

describe("ViewModeSelector", () => {
  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens and keeps the top-bar menu open when %s is pressed", async (_label, sequence) => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <ViewModeSelector viewMode="list" onViewModeChange={vi.fn()} />
      </SambeeThemeProvider>
    );

    const trigger = screen.getByRole("button", { name: "View mode options" });
    trigger.focus();

    await user.keyboard(sequence);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    expect(screen.getByText("Details")).toBeInTheDocument();
  });
});
