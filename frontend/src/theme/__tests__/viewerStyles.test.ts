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
    const preCodeStyles = styles["& pre code, & pre code.hljs"] as Record<string, unknown>;

    expect(resolveThemeValue(preStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(preStyles.color, darkTheme)).toBe("#ebe8e2");
    expect(resolveThemeValue(preStyles.border, darkTheme)).toBe("1px solid #504535");
    expect(preStyles.padding).toBe("1.25rem");

    expect(preCodeStyles.display).toBe("block");
    expect(preCodeStyles.padding).toBe(0);
    expect(preCodeStyles.backgroundColor).toBe("transparent");

    expect(resolveThemeValue(inlineCodeStyles.backgroundColor, darkTheme)).toBe("#2b2925");
    expect(resolveThemeValue(inlineCodeStyles.color, darkTheme)).toBe("#ebe8e2");
    expect(resolveThemeValue(inlineCodeStyles.border, darkTheme)).toBe("1px solid #3b3935");
  });

  it("applies the dark code palette to rich-text code block editor surfaces", () => {
    const darkTheme = createMuiTheme("dark");
    const styles = getMarkdownEditorContentStyles("#ebe8e2", "#f4c430", "#f6e58d") as Record<string, unknown>;

    const codeMirrorWrapperStyles = styles["& [class*='codeMirrorWrapper']"] as Record<string, unknown>;
    const codeMirrorToolbarStyles = styles["& [class*='codeMirrorToolbar']"] as Record<string, unknown>;
    const codeMirrorSurfaceStyles = styles[
      "& [class*='codeMirrorWrapper'] .cm-editor, & [class*='codeMirrorWrapper'] .cm-scroller, & [class*='codeMirrorWrapper'] .cm-content, & [class*='codeMirrorWrapper'] .cm-gutters"
    ] as Record<string, unknown>;
    const codeMirrorGutterStyles = styles["& [class*='codeMirrorWrapper'] .cm-gutters"] as Record<string, unknown>;
    const codeMirrorComboboxStyles = styles["& [class*='codeMirrorWrapper'] [role='combobox']"] as Record<string, unknown>;
    const activeLineGutterStyles = styles["& [class*='codeMirrorWrapper'] .cm-editor.cm-focused .cm-activeLineGutter"] as Record<
      string,
      unknown
    >;

    expect(resolveThemeValue(codeMirrorWrapperStyles.borderColor, darkTheme)).toBe("#504535");
    expect(codeMirrorWrapperStyles.borderRadius).toBe(0);
    expect(resolveThemeValue(codeMirrorWrapperStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(codeMirrorToolbarStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(codeMirrorToolbarStyles.borderLeft, darkTheme)).toBe("1px solid #504535");
    expect(resolveThemeValue(codeMirrorToolbarStyles.borderBottom, darkTheme)).toBe("1px solid #504535");
    expect(codeMirrorToolbarStyles.borderBottomLeftRadius).toBe(0);

    expect(resolveThemeValue(codeMirrorSurfaceStyles.backgroundColor, darkTheme)).toBe("#1f1914");
    expect(resolveThemeValue(codeMirrorSurfaceStyles.color, darkTheme)).toBe("#ebe8e2");
    expect(resolveThemeValue(codeMirrorGutterStyles.borderRight, darkTheme)).toBe("1px solid #504535");
    expect(codeMirrorComboboxStyles.borderRadius).toBe(0);

    expect(styles["& [class*='codeMirrorWrapper'] .cm-editor.cm-focused .cm-activeLine"]).toBeUndefined();
    expect(resolveThemeValue(activeLineGutterStyles.backgroundColor, darkTheme)).toBe("#3d3d3d");
    expect(resolveThemeValue(activeLineGutterStyles.color, darkTheme)).toBe("#ebe8e2");
  });

  it("clears MDXEditor's nested inline-code span background in rich-text mode", () => {
    const styles = getMarkdownEditorContentStyles("#1f262b", "#c24400", "#ff5900") as Record<string, unknown>;

    const nestedInlineCodeSpanStyles = styles["& .sambee-markdown-inline-code span, & code:not(pre code) span"] as Record<string, unknown>;

    expect(nestedInlineCodeSpanStyles.backgroundColor).toBe("transparent !important");
    expect(nestedInlineCodeSpanStyles.color).toBe("inherit");
  });

  it("keeps markdown tables naturally sized but horizontally scrollable", () => {
    const lightTheme = createMuiTheme("light");
    const styles = getMarkdownContentStyles("#1f262b", "#c24400", "#ff5900") as Record<string, unknown>;

    const tableStyles = styles["& table"] as Record<string, unknown>;

    expect(tableStyles.display).toBe("block");
    expect(tableStyles.width).toBe("max-content");
    expect(tableStyles.maxWidth).toBe("100%");
    expect(tableStyles.overflowX).toBe("auto");
    expect(tableStyles.border).toBe(0);
    expect(resolveThemeValue(tableStyles.boxShadow, lightTheme)).toBe("inset 0 0 0 1px #d4c4ae");
    expect(resolveThemeValue(tableStyles.backgroundColor, lightTheme)).toBe("#fbf9f4");
  });
});
