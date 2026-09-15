import { describe, expect, it } from "vitest";
import { getEditorChangeSummary } from "../editorChangeTracking";

describe("getEditorChangeSummary", () => {
  it("reports additions, modifications, and deletions", () => {
    const summary = getEditorChangeSummary("one\ntwo\nthree\nfour\nfive\nsix\nseven", "one\nchanged\nthree\nfour\ninserted\nfive\nsix");

    expect(summary).toMatchObject({ added: 1, modified: 1, deleted: 1 });
    expect(summary.markers).toEqual([
      { lineNumber: 2, kinds: ["modified"] },
      { lineNumber: 5, kinds: ["added"] },
      { lineNumber: 7, kinds: ["deleted"] },
    ]);
  });

  it("anchors a trailing deletion to the final remaining line", () => {
    const summary = getEditorChangeSummary("one\ntwo\nthree", "one");

    expect(summary).toMatchObject({ added: 0, modified: 0, deleted: 2 });
    expect(summary.markers).toEqual([{ lineNumber: 1, kinds: ["deleted"] }]);
  });

  it("anchors an entirely deleted document to CodeMirror's empty first line", () => {
    const summary = getEditorChangeSummary("one", "");

    expect(summary).toMatchObject({ added: 0, modified: 0, deleted: 1 });
    expect(summary.markers).toEqual([{ lineNumber: 1, kinds: ["deleted"] }]);
  });
});
