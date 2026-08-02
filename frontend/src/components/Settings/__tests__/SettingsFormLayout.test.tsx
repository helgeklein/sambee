import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import {
  SettingsFormFieldLabel,
  SettingsFormGroup,
  SettingsFormRow,
  SettingsFormSection,
  SettingsFormSurface,
} from "../SettingsFormLayout";

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
});
