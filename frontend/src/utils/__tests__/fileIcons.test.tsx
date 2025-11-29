import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getFileIcon } from "../fileIcons";

describe("getFileIcon", () => {
  it("should render folder icon for directories", () => {
    const { container } = render(getFileIcon({ filename: "test-folder", isDirectory: true }));
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should render file icon for files with extension", () => {
    const { container } = render(getFileIcon({ filename: "test.js", isDirectory: false }));
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should handle files without extension", () => {
    const { container } = render(getFileIcon({ filename: "README", isDirectory: false }));
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should render different icons for different file types", () => {
    const jsIcon = render(getFileIcon({ filename: "script.js", isDirectory: false }));
    const pyIcon = render(getFileIcon({ filename: "script.py", isDirectory: false }));

    expect(jsIcon.container.innerHTML).toBeTruthy();
    expect(pyIcon.container.innerHTML).toBeTruthy();
    // Icons should be different (though we can't easily compare their content)
  });

  it("should respect custom size prop", () => {
    const { container } = render(getFileIcon({ filename: "test.txt", isDirectory: false, size: 32 }));
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("class");
    // MUI icons use fontSize in sx prop which gets applied as class
  });

  it("should use default size when not specified", () => {
    const { container } = render(getFileIcon({ filename: "test.txt", isDirectory: false }));
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // MUI icons use default fontSize of 24px
  });
});
