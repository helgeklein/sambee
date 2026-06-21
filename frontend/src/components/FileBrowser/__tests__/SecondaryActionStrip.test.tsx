import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { SecondaryActionStrip } from "../SecondaryActionStrip";

describe("SecondaryActionStrip", () => {
  it("does not leak flex layout props onto DOM wrappers", () => {
    const { container } = render(
      <SambeeThemeProvider>
        <SecondaryActionStrip
          connections={[
            {
              id: "demo-conn",
              name: "Demo",
              type: "smb",
              host: "demo",
              port: 445,
              share_name: "share",
              username: "demo-user",
              created_at: "2026-03-11T00:00:00Z",
              updated_at: "2026-03-11T00:00:00Z",
            },
          ]}
          selectedConnectionId="demo-conn"
          onConnectionChange={vi.fn()}
          viewMode="list"
          onViewModeChange={vi.fn()}
          sortBy="name"
          onSortChange={vi.fn()}
          sortDirection="asc"
          onDirectionChange={vi.fn()}
          hasFiles={true}
        />
      </SambeeThemeProvider>
    );

    const stripRoot = container.firstElementChild;
    const connectionTriggerContent = screen.getByRole("combobox", { name: "Select connection" }).firstElementChild;
    const viewModeTriggerContent = screen.getByRole("button", { name: "View mode options" }).firstElementChild;
    const sortTriggerContent = screen.getByRole("button", { name: "Sort options" }).firstElementChild;

    for (const element of [stripRoot, connectionTriggerContent, viewModeTriggerContent, sortTriggerContent]) {
      expect(element).not.toHaveAttribute("display");
      expect(element).not.toHaveAttribute("alignitems");
      expect(element).not.toHaveAttribute("justifycontent");
    }
  });
});
