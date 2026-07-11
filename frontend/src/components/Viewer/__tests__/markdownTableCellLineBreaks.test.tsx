import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import {
  normalizeMarkdownTableCellLineBreaks,
  prepareMarkdownTableCellLineBreaksForEditor,
  preserveUnchangedMarkdownTableSource,
  remarkRenderMarkdownTableCellLineBreaks,
} from "../markdownTableCellLineBreaks";

describe("markdownTableCellLineBreaks", () => {
  it("normalizes uppercase br tags in table cells to the canonical form", () => {
    const markdown = ["| Column |", "| --- |", "| foo<BR>bar |", ""].join("\n");

    expect(normalizeMarkdownTableCellLineBreaks(markdown)).toContain("foo<br />bar");
  });

  it("normalizes malformed closing br tags in table cells to the canonical form", () => {
    const markdown = ["| Column |", "| --- |", "| foo</br>bar |", ""].join("\n");

    expect(normalizeMarkdownTableCellLineBreaks(markdown)).toContain("foo<br />bar");
  });

  it("normalizes numeric newline entities in table cells to the canonical form", () => {
    const markdown = ["| Left | Right |", "| --- | --- |", "| foo&#10;bar | baz&#x000A;qux |", ""].join("\n");
    const normalized = normalizeMarkdownTableCellLineBreaks(markdown);

    expect(normalized).toContain("foo<br />bar");
    expect(normalized).toContain("baz<br />qux");
  });

  it("strips trailing table-cell line breaks during normalization", () => {
    const markdown = ["| Column |", "| --- |", "| foo<br /><br /> |", ""].join("\n");
    const normalized = normalizeMarkdownTableCellLineBreaks(markdown);

    expect(normalized).toContain("foo");
    expect(normalized).not.toContain("foo<br");
  });

  it("is idempotent for already-canonical table-cell markdown", () => {
    const markdown = ["| Column |", "| --- |", "| foo<br />bar |", ""].join("\n");
    const normalized = normalizeMarkdownTableCellLineBreaks(markdown);

    expect(normalizeMarkdownTableCellLineBreaks(normalized)).toBe(normalized);
  });

  it("renders canonical breaks visually only inside table cells", async () => {
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkRenderMarkdownTableCellLineBreaks]}>
        {["Paragraph <br /> text", "", "| Column |", "| --- |", "| foo<br />bar |", ""].join("\n")}
      </ReactMarkdown>
    );

    const paragraph = await screen.findByText("Paragraph <br /> text");
    const tableCell = await screen.findByRole("cell", { name: /foo\s+bar/ });

    expect(paragraph.querySelector("br")).toBeNull();
    expect(tableCell.querySelectorAll("br")).toHaveLength(1);
  });

  it("maps canonical table-cell breaks to editor-form br tags only inside tables", () => {
    const markdown = ["Paragraph <br /> text", "", "| Column |", "| --- |", "| foo<br />bar |", ""].join("\n");

    const prepared = prepareMarkdownTableCellLineBreaksForEditor(markdown);

    expect(prepared).toContain("| foo<br>bar |");
    expect(prepared).toContain("Paragraph <br /> text");
  });

  it("does not reformat unrelated markdown while preparing table-cell editor breaks", () => {
    const markdown = ["Paragraph <br /> text", "", "* one", "* two", "", "| A |", "| - |", "| foo<br />bar |", ""].join("\n");

    const prepared = prepareMarkdownTableCellLineBreaksForEditor(markdown);

    expect(prepared).toBe(["Paragraph <br /> text", "", "* one", "* two", "", "| A |", "| - |", "| foo<br>bar |", ""].join("\n"));
  });

  it("does not rewrite outside-table br text when no table-cell break replacement is needed", () => {
    const markdown = ["```html", "<br />", "```", "", "Outside <br /> stays literal.", ""].join("\n");

    expect(prepareMarkdownTableCellLineBreaksForEditor(markdown)).toBe(markdown);
  });

  it("restores original source for semantically unchanged tables", () => {
    const previousMarkdown = ["Outside <br /> stays literal.", "", "| A |", "| - |", "| foo<br />bar |", ""].join("\n");
    const nextMarkdown = ["Outside <br /> stays literal.", "", "| A            |", "| ------------ |", "| foo<br />bar |", ""].join("\n");

    expect(preserveUnchangedMarkdownTableSource(previousMarkdown, nextMarkdown)).toBe(previousMarkdown);
  });
});
