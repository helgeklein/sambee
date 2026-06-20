import { createTheme, type Theme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { getMarkdownCodeSurfaceColors, getMarkdownContentStyles, getMarkdownEditorContentStyles } from "../viewerStyles";

function createMuiTheme(mode: "light" | "dark"): Theme {
  return createTheme({
    palette: {
      mode,
    },
  });
}

function resolveThemeValue<T>(value: T | ((theme: Theme) => T), theme: Theme): T {
  return typeof value === "function" ? (value as (theme: Theme) => T)(theme) : value;
}

describe("viewerStyles markdown regressions", () => {
  it("uses the website dark code palette for markdown code surfaces", () => {
    const darkTheme = createMuiTheme("dark");

    expect(getMarkdownCodeSurfaceColors(darkTheme)).toEqual({
      blockBackground: "#1f1914",
      inlineBackground: "#2b2925",
      blockBorder: "#504535",
      inlineBorder: "#3b3935",
      textColor: "#ebe8e2",
      activeLineGutterBackground: "#3d3d3d",
    });
  });

  it("applies the dark code palette to viewer inline code and code blocks", () => {
    const darkTheme = createMuiTheme("dark");
    const styles = getMarkdownContentStyles("#ebe8e2", "#f4c430", "#f6e58d") as Record<string, unknown>;

    const preStyles = styles["& pre"] as Record<string, unknown>;
    const inlineCodeStyles = styles["& code:not(pre code)"] as Record<string, unknown>;

    expect(resolveThemeValue(preStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(preStyles.color, darkTheme)).toBe("#ebe8e2");
    expect(resolveThemeValue(preStyles.border, darkTheme)).toBe("1px solid #504535");

    expect(resolveThemeValue(inlineCodeStyles.backgroundColor, darkTheme)).toBe("#2b2925");
    expect(resolveThemeValue(inlineCodeStyles.color, darkTheme)).toBe("#ebe8e2");
    expect(resolveThemeValue(inlineCodeStyles.border, darkTheme)).toBe("1px solid #3b3935");
  });

  it("applies the dark code palette to rich-text code block editor surfaces", () => {
    const darkTheme = createMuiTheme("dark");
    const styles = getMarkdownEditorContentStyles("#ebe8e2", "#f4c430", "#f6e58d") as Record<string, unknown>;

    const codeBlockWrapperStyles = styles["& .sambee-markdown-code-block > div"] as Record<string, unknown>;
    const codeMirrorSurfaceStyles = styles[
      "& .sambee-markdown-code-block .cm-editor, & .sambee-markdown-code-block .cm-scroller, & .sambee-markdown-code-block .cm-content, & .sambee-markdown-code-block .cm-gutters"
    ] as Record<string, unknown>;
    const activeLineStyles = styles["& .sambee-markdown-code-block .cm-editor.cm-focused .cm-activeLineGutter"] as Record<string, unknown>;

    expect(resolveThemeValue(codeBlockWrapperStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(codeBlockWrapperStyles.border, darkTheme)).toBe("1px solid #504535");
    expect(resolveThemeValue(codeBlockWrapperStyles.color, darkTheme)).toBe("#ebe8e2");

    expect(resolveThemeValue(codeMirrorSurfaceStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(codeMirrorSurfaceStyles.color, darkTheme)).toBe("#ebe8e2");

    expect(resolveThemeValue(activeLineStyles.backgroundColor, darkTheme)).toBe("#3d3d3d");
    expect(resolveThemeValue(activeLineStyles.color, darkTheme)).toBe("#ebe8e2");
  });

  it("keeps markdown tables naturally sized but horizontally scrollable", () => {
    const lightTheme = createMuiTheme("light");
    const styles = getMarkdownContentStyles("#1f262b", "#c24400", "#ff5900") as Record<string, unknown>;

    const tableStyles = styles["& table"] as Record<string, unknown>;

    expect(tableStyles.display).toBe("block");
    expect(tableStyles.width).toBe("max-content");
    expect(tableStyles.maxWidth).toBe("100%");
    expect(tableStyles.overflowX).toBe("auto");
    expect(resolveThemeValue(tableStyles.border, lightTheme)).toBe("1px solid #827562");
    expect(resolveThemeValue(tableStyles.backgroundColor, lightTheme)).toBe("#fbf9f4");
  });
});
