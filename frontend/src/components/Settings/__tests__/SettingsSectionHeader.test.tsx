import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

describe("SettingsSectionHeader", () => {
  it("renders supporting copy with the semantic secondary text role", () => {
    render(<SettingsSectionHeader title="Appearance" description="Customize application appearance." />);

    expect(screen.getByText("Customize application appearance.")).toHaveStyle({ color: "rgba(0, 0, 0, 0.6)" });
  });
});
