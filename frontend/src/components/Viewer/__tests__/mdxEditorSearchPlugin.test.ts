import { describe, expect, it, vi } from "vitest";

vi.mock("@mdxeditor/editor", () => ({
  contentEditableRef$: Symbol("contentEditableRef"),
  createRootEditorSubscription$: Symbol("createRootEditorSubscription"),
  editorSearchCursor$: Symbol("editorSearchCursor"),
  editorSearchRanges$: Symbol("editorSearchRanges"),
  editorSearchScrollableContent$: Symbol("editorSearchScrollableContent"),
  editorSearchTerm$: Symbol("editorSearchTerm"),
  editorSearchTextNodeIndex$: Symbol("editorSearchTextNodeIndex"),
  MDX_FOCUS_SEARCH_NAME: "MdxFocusSearch",
  MDX_SEARCH_NAME: "MdxSearch",
  rangeSearchScan: vi.fn(),
  realmPlugin: (plugin: unknown) => () => plugin,
}));

import { indexEditorSearchTextNodes } from "../mdxEditorSearchPlugin";

describe("mdxEditorSearchPlugin", () => {
  it("preserves DOM offsets for composed unicode characters", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.textContent = "äx äx äx äx";
    root.appendChild(paragraph);

    const index = indexEditorSearchTextNodes(root);
    const matchStarts: number[] = [];
    let searchOffset = 0;

    while (searchOffset < index.allText.length) {
      const matchStart = index.allText.indexOf("äx", searchOffset);

      if (matchStart === -1) {
        break;
      }

      matchStarts.push(matchStart);
      searchOffset = matchStart + 1;
    }

    expect(matchStarts).toEqual([0, 3, 6, 9]);
    expect(index.offsetIndex.filter((_, position) => matchStarts.includes(position))).toEqual([0, 3, 6, 9]);
  });
});
