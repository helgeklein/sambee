import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { DesktopToolbarActions } from "../DesktopToolbarActions";

function renderWithProvider(component: React.ReactElement) {
  return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
}

describe("DesktopToolbarActions", () => {
  it("shows help and settings controls with the expected tooltip text", () => {
    renderWithProvider(<DesktopToolbarActions onOpenHelp={vi.fn()} onOpenDocumentation={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByLabelText("Help")).toHaveAttribute("title", "Help");
    expect(screen.getByLabelText("Open settings")).toHaveAttribute("title", "Open settings (Ctrl+,)");
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
