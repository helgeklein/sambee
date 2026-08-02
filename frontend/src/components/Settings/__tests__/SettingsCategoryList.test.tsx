import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import { SettingsCategoryList } from "../SettingsCategoryList";
import { getVisibleSettingsSections } from "../settingsNavigation";

function renderList() {
  const onSelect = vi.fn();

  render(
    <SambeeThemeProvider>
      <SettingsCategoryList
        sections={getVisibleSettingsSections(false)}
        onSelect={onSelect}
        selectedItem="appearance"
        listRole="listbox"
        itemRole="option"
      />
    </SambeeThemeProvider>
  );

  return { onSelect };
}

describe("SettingsCategoryList", () => {
  it("uses the shared category label and icon sizes", () => {
    renderList();

    const appearanceOption = screen.getByRole("option", { name: /^appearance$/i });
    const label = screen.getByText("Appearance", { exact: true });
    const icon = appearanceOption.querySelector("svg");

    expect(label).toHaveStyle({ fontSize: "1rem" });
    expect(icon).toHaveStyle({ fontSize: "1.5rem" });
  });

  it("shows local drives as a top-level category without child UI", () => {
    renderList();

    expect(screen.getByRole("option", { name: /^connections$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /text editor/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local drives/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand|collapse/i })).not.toBeInTheDocument();
  });

  it("navigates when local drives is selected", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();

    await user.click(screen.getByRole("option", { name: /local drives/i }));

    expect(onSelect).toHaveBeenCalledWith("local-drives");
  });
});
