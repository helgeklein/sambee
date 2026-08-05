import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import { SettingsPage } from "../SettingsPage";

describe("SettingsPage", () => {
  it("keeps its scrollable content out of sequential tab navigation", () => {
    render(
      <SambeeThemeProvider>
        <SettingsPage category="appearance" title="Appearance" description="Customize appearance.">
          Settings content
        </SettingsPage>
      </SambeeThemeProvider>
    );

    expect(screen.getByTestId("settings-page-content")).toHaveAttribute("tabindex", "-1");
  });
});
