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

  it("renders an active contextual notice inside and above its scrollable content", () => {
    render(
      <SambeeThemeProvider>
        <SettingsPage category="appearance" contextualNotice={<div data-testid="settings-notice">Saved</div>}>
          <div data-testid="settings-body">Settings content</div>
        </SettingsPage>
      </SambeeThemeProvider>
    );

    const notice = screen.getByTestId("settings-notice");
    const content = screen.getByTestId("settings-page-content");
    const body = screen.getByTestId("settings-body");
    expect(content).toContainElement(notice);
    expect(notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
