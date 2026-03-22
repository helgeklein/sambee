import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../../i18n";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { ViewModeSelector } from "../ViewModeSelector";

describe("ViewModeSelector", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("uses translated view mode strings", async () => {
    await setLocale("en-XA");

    render(
      <SambeeThemeProvider>
        <ViewModeSelector viewMode="details" onViewModeChange={vi.fn()} />
      </SambeeThemeProvider>
    );

    expect(screen.getByRole("button", { name: "[Ṽíéŵ ḿóďé óṕťíóńš]" })).toBeInTheDocument();
    expect(screen.getByText("[Ďéťåíĺš]")).toBeInTheDocument();
  });

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
