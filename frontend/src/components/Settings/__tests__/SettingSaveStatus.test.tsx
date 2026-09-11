import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { SettingSaveStatus } from "../SettingSaveStatus";

describe("SettingSaveStatus", () => {
  it("renders nothing while idle", () => {
    render(<SettingSaveStatus pending={false} saved={false} savingLabel="Saving setting" savedLabel="Setting saved" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces saving state without creating an interactive control", () => {
    render(<SettingSaveStatus pending saved={false} savingLabel="Saving setting" savedLabel="Setting saved" />);

    expect(screen.getByRole("status", { name: "Saving setting" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("announces successful save state", () => {
    render(<SettingSaveStatus pending={false} saved savingLabel="Saving setting" savedLabel="Setting saved" />);

    expect(screen.getByRole("status", { name: "Setting saved" })).toBeInTheDocument();
  });
});
