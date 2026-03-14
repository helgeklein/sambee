import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SambeeThemeProvider } from "../../theme";
import { BrowserSettings } from "../BrowserSettings";
import { QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY } from "../FileBrowser/preferences";

describe("BrowserSettings", () => {
  beforeEach(() => {
    localStorage.removeItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY);
  });

  const renderSettings = () =>
    render(
      <SambeeThemeProvider>
        <BrowserSettings />
      </SambeeThemeProvider>
    );

  it("persists the quick-nav dot-directory preference", async () => {
    const user = userEvent.setup();

    renderSettings();

    const toggle = screen.getByRole("checkbox", { name: "Include dot directories in quick nav" });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(localStorage.getItem(QUICK_NAV_INCLUDE_DOT_DIRECTORIES_STORAGE_KEY)).toBe("true");
  });
});
