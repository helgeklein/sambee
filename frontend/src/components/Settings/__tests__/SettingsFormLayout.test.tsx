import { createTheme } from "@mui/material";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { DIALOG_SURFACE_CSS_VARIABLE } from "../../../theme/palette";
import {
  SettingsFormFieldLabel,
  SettingsFormGroup,
  SettingsFormRow,
  SettingsFormSection,
  SettingsFormSurface,
  settingsSelectMenuProps,
  settingsSelectSx,
} from "../SettingsFormLayout";
import { getSettingsPageSurfaceColor } from "../settingsSurface";

describe("SettingsFormLayout", () => {
  it("renders the shared surface, field group, and section heading", () => {
    render(
      <SettingsFormSurface testId="form-surface">
        <SettingsFormGroup testId="field-group">
          <SettingsFormRow>
            <SettingsFormFieldLabel label="Name" description="A display name" descriptionId="name-description" htmlFor="name" required />
            <input id="name" aria-describedby="name-description" />
          </SettingsFormRow>
        </SettingsFormGroup>
        <SettingsFormSection title="Access" />
      </SettingsFormSurface>
    );

    expect(screen.getByTestId("form-surface")).toContainElement(screen.getByTestId("field-group"));
    expect(screen.getByText("Name", { selector: "label" })).toHaveAttribute("for", "name");
    expect(screen.getByText("A display name")).toHaveAttribute("id", "name-description");
    expect(screen.getByRole("heading", { name: "Access", level: 2 })).toBeInTheDocument();
  });

  it("uses the generic dialog paper variable for Settings pages", () => {
    const theme = createTheme({ palette: { background: { default: "#123456" } } });

    expect(getSettingsPageSurfaceColor(theme)).toBe(`var(${DIALOG_SURFACE_CSS_VARIABLE}, #123456)`);
  });

  it("uses primary text for actionable select values and options", () => {
    expect(settingsSelectSx).toEqual({
      "& .MuiSelect-select, & .MuiSelect-icon": {
        color: "text.primary",
      },
    });
    expect(settingsSelectMenuProps).toEqual({
      sx: {
        "& .MuiMenuItem-root": {
          color: "text.primary",
        },
      },
    });
  });
});
