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

  it("applies row padding only at the declared form surface edges", () => {
    render(
      <FormSurface>
        <FormGroup testId="default-group">
          <FormRow>
            <input aria-label="Default field" />
          </FormRow>
        </FormGroup>
        <FormGroup edge="start" testId="start-group">
          <FormRow>
            <input aria-label="Start field" />
          </FormRow>
        </FormGroup>
        <FormGroup edge="end" testId="end-group">
          <FormRow>
            <input aria-label="End field" />
          </FormRow>
        </FormGroup>
        <FormGroup edge="both" testId="both-group">
          <FormRow>
            <input aria-label="Both field" />
          </FormRow>
        </FormGroup>
      </FormSurface>
    );

    const defaultRow = screen.getByTestId("default-group").firstElementChild!;
    const startRow = screen.getByTestId("start-group").firstElementChild!;
    const endRow = screen.getByTestId("end-group").firstElementChild!;
    const bothRow = screen.getByTestId("both-group").firstElementChild!;

    expect(getComputedStyle(defaultRow).paddingTop).not.toBe("0px");
    expect(getComputedStyle(defaultRow).paddingBottom).not.toBe("0px");
    expect(getComputedStyle(startRow).paddingTop).toBe("0px");
    expect(getComputedStyle(startRow).paddingBottom).not.toBe("0px");
    expect(getComputedStyle(endRow).paddingTop).not.toBe("0px");
    expect(getComputedStyle(endRow).paddingBottom).toBe("0px");
    expect(getComputedStyle(bothRow).paddingTop).toBe("0px");
    expect(getComputedStyle(bothRow).paddingBottom).toBe("0px");
  });

  it("retains a group's final row spacing before a following section divider", () => {
    render(
      <FormSurface>
        <FormGroup edge="start" testId="identity-group">
          <FormRow>
            <input aria-label="Email" />
          </FormRow>
        </FormGroup>
        <SettingsFormSection title="Access" />
        <FormGroup edge="end" testId="access-group">
          <FormRow>
            <input aria-label="Role" />
          </FormRow>
        </FormGroup>
      </FormSurface>
    );

    expect(getComputedStyle(screen.getByTestId("identity-group").firstElementChild!).paddingBottom).not.toBe("0px");
    expect(getComputedStyle(screen.getByTestId("access-group").firstElementChild!).paddingBottom).toBe("0px");
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
