import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { SettingsGroup } from "../SettingsGroup";
import { SettingsSectionList } from "../SettingsSectionList";

describe("SettingsGroup", () => {
  it("uses semantic heading levels with consistent heading-to-content spacing", () => {
    render(
      <SettingsSectionList>
        <SettingsGroup title="Primary section">
          <div>Primary content</div>
        </SettingsGroup>
        <SettingsGroup title="Nested section" level="subsection">
          <div>Nested content</div>
        </SettingsGroup>
        <SettingsGroup title="Compact section" contentSpacing="compact">
          <div>Compact content</div>
        </SettingsGroup>
      </SettingsSectionList>
    );

    const primaryHeading = screen.getByRole("heading", { name: "Primary section", level: 2 });
    const subsectionHeading = screen.getByRole("heading", { name: "Nested section", level: 3 });
    const compactHeading = screen.getByRole("heading", { name: "Compact section", level: 2 });

    expect(window.getComputedStyle(primaryHeading.parentElement!).marginBottom).toBe("16px");
    expect(window.getComputedStyle(subsectionHeading.parentElement!).marginBottom).toBe("12px");
    expect(window.getComputedStyle(compactHeading.parentElement!).marginBottom).toBe("8px");
    expect(window.getComputedStyle(primaryHeading).fontWeight).toBe("500");
    expect(window.getComputedStyle(subsectionHeading).fontWeight).toBe("500");
    expect(window.getComputedStyle(subsectionHeading.parentElement!.parentElement!.parentElement!).marginTop).toBe("32px");
  });

  it("uses a 24px rhythm between nested sections", () => {
    render(
      <SettingsSectionList level="subsection">
        <SettingsGroup title="First nested section" level="subsection">
          <div>First nested content</div>
        </SettingsGroup>
        <SettingsGroup title="Second nested section" level="subsection">
          <div>Second nested content</div>
        </SettingsGroup>
      </SettingsSectionList>
    );

    const secondHeading = screen.getByRole("heading", { name: "Second nested section", level: 3 });

    expect(window.getComputedStyle(secondHeading.parentElement!.parentElement!.parentElement!).marginTop).toBe("24px");
  });
});
