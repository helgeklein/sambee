import { createTheme } from "@mui/material";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { OVERLAY_SURFACE_CSS_VARIABLE } from "../../../theme/palette";
import {
  FormFieldLabel,
  FormGroup,
  FormRow,
  FormSurface,
  formFieldControlSx,
  formOutlinedControlSx,
  formSelectMenuProps,
  formSelectSx,
} from "../../Form/FormLayout";
import { SettingsFormSection } from "../SettingsFormLayout";
import { getSettingsPageSurfaceColor } from "../settingsSurface";

describe("SettingsFormLayout", () => {
  it("renders the shared surface, field group, and section heading", () => {
    render(
      <FormSurface testId="form-surface">
        <FormGroup testId="field-group">
          <FormRow>
            <FormFieldLabel label="Name" description="A display name" descriptionId="name-description" htmlFor="name" required />
            <input id="name" aria-describedby="name-description" />
          </FormRow>
        </FormGroup>
        <SettingsFormSection title="Access" />
      </FormSurface>
    );

    expect(screen.getByTestId("form-surface")).toContainElement(screen.getByTestId("field-group"));
    expect(screen.getByText("Name", { selector: "label" })).toHaveAttribute("for", "name");
    expect(screen.getByText("A display name")).toHaveAttribute("id", "name-description");
    expect(screen.getByRole("heading", { name: "Access", level: 2 })).toBeInTheDocument();
  });

  it("replaces the normal description with visible warning feedback", () => {
    render(
      <FormFieldLabel
        label="Name"
        description="A display name"
        descriptionId="name-description"
        feedback={{ message: "This name may be difficult to find.", severity: "warning" }}
      />
    );

    expect(screen.getByText("Warning: This name may be difficult to find.")).toHaveAttribute("id", "name-description");
    expect(screen.queryByText("A display name")).not.toBeInTheDocument();
  });

  it("uses the generic dialog paper variable for Settings pages", () => {
    const theme = createTheme({ palette: { background: { default: "#123456" } } });

    expect(getSettingsPageSurfaceColor(theme)).toBe(`var(${OVERLAY_SURFACE_CSS_VARIABLE}, #123456)`);
  });

  it("uses primary text for actionable select values and options", () => {
    expect(formSelectSx).toEqual({
      "& .MuiSelect-select, & .MuiSelect-icon": {
        color: "text.primary",
      },
    });
    expect(formSelectMenuProps).toEqual({
      sx: {
        "& .MuiMenuItem-root": {
          color: "text.primary",
        },
      },
    });
  });

  it("leaves focused outlines to MUI and aligns desktop controls", () => {
    expect(formFieldControlSx).toMatchObject({
      display: "flex",
      justifyContent: { md: "flex-end" },
      width: "100%",
    });
    expect(formOutlinedControlSx).not.toHaveProperty("& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline");
  });
});
