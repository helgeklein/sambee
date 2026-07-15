import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { DesktopToolbarActions } from "../DesktopToolbarActions";

function renderWithProvider(component: React.ReactElement) {
  return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
}

describe("DesktopToolbarActions", () => {
  it("shows help and settings tooltips", async () => {
    const user = userEvent.setup();

    renderWithProvider(<DesktopToolbarActions onOpenHelp={vi.fn()} onOpenDocumentation={vi.fn()} onOpenSettings={vi.fn()} />);

    await user.hover(screen.getByLabelText("Help"));
    expect(await screen.findByText("Help")).toBeInTheDocument();

    await user.unhover(screen.getByLabelText("Help"));
    await user.hover(screen.getByLabelText("Open settings"));
    expect(await screen.findByText("Open settings (Ctrl+,)")).toBeInTheDocument();
  });

  it("opens the help menu and runs both actions", () => {
    const onOpenHelp = vi.fn();
    const onOpenDocumentation = vi.fn();

    renderWithProvider(
      <DesktopToolbarActions onOpenHelp={onOpenHelp} onOpenDocumentation={onOpenDocumentation} onOpenSettings={vi.fn()} />
    );

    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Documentation" }));
    expect(onOpenDocumentation).toHaveBeenCalledTimes(1);
  });
});
