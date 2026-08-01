import { ListItem, ListItemText } from "@mui/material";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../../test/utils/test-utils";
import { SettingsList } from "../SettingsList";

describe("SettingsList", () => {
  it("removes list padding and aligns the first direct row with its section heading", () => {
    render(
      <SettingsList>
        <ListItem>
          <ListItemText primary="First setting" />
        </ListItem>
        <ListItem>
          <ListItemText primary="Second setting" />
        </ListItem>
      </SettingsList>
    );

    const firstRow = screen.getByText("First setting").closest("li");
    const secondRow = screen.getByText("Second setting").closest("li");

    expect(firstRow).toHaveStyle({ paddingTop: "0px" });
    expect(secondRow).toHaveStyle({ paddingTop: "8px" });
  });
});
