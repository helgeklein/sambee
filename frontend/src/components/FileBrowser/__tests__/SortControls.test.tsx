import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { SortControls } from "../SortControls";

describe("SortControls", () => {
  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens and keeps the top-bar sort menu open when %s is pressed", async (_label, sequence) => {
    const user = userEvent.setup();

    render(
      <SambeeThemeProvider>
        <SortControls sortBy="name" onSortChange={vi.fn()} sortDirection="asc" onDirectionChange={vi.fn()} />
      </SambeeThemeProvider>
    );

    const trigger = screen.getByRole("button", { name: "Sort options" });
    trigger.focus();

    await user.keyboard(sequence);

    await waitFor(() => {
      expect(screen.getByText("Ascending")).toBeInTheDocument();
    });

    expect(screen.getByText("Descending")).toBeInTheDocument();
  });
});
