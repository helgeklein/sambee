import type { Virtualizer } from "@tanstack/react-virtual";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, translate } from "../../../i18n";
import type { FileEntry } from "../../../types";
import { FileList } from "../FileList";

const rowVirtualizerStub = {
  getVirtualItems: () => [],
  getTotalSize: () => 0,
} as unknown as Virtualizer<HTMLDivElement, Element>;

const fileRowStylesStub = {
  iconBox: {},
  contentBox: {},
  buttonSelected: {},
  buttonNotSelected: {},
  buttonMultiSelected: {},
  buttonFocusedMultiSelected: {},
};

describe("FileList", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("renders the translated empty state", async () => {
    await setLocale("en-XA");

    render(
      <FileList
        files={[]}
        focusedIndex={-1}
        selectedFiles={new Set()}
        onFileClick={() => {}}
        rowVirtualizer={rowVirtualizerStub}
        parentRef={{ current: null }}
        listContainerRef={() => {}}
        fileRowStyles={fileRowStylesStub}
        useCompactLayout={false}
        viewMode="list"
      />
    );

    expect(screen.getByText(translate("fileBrowser.list.emptyDirectory"))).toBeInTheDocument();
  });

  it("suppresses the empty state when requested", () => {
    render(
      <FileList
        files={[]}
        showEmptyState={false}
        focusedIndex={-1}
        selectedFiles={new Set()}
        onFileClick={() => {}}
        rowVirtualizer={rowVirtualizerStub}
        parentRef={{ current: null }}
        listContainerRef={() => {}}
        fileRowStyles={fileRowStylesStub}
        useCompactLayout={false}
        viewMode="list"
      />
    );

    expect(screen.queryByText(translate("fileBrowser.list.emptyDirectory"))).not.toBeInTheDocument();
  });

  it("does not wire dynamic row measurement for fixed-height rows", () => {
    const measureElement = vi.fn();
    const rowVirtualizerWithItems = {
      getVirtualItems: () => [{ index: 0, key: "file-0", start: 0, size: 40 }],
      getTotalSize: () => 40,
      measureElement,
    } as unknown as Virtualizer<HTMLDivElement, Element>;

    const files: FileEntry[] = [
      {
        name: "readme.txt",
        path: "readme.txt",
        type: "file",
        size: 123,
        mime_type: "text/plain",
        modified_at: "2026-07-15T00:00:00Z",
        is_readable: true,
        is_hidden: false,
      },
    ];

    render(
      <FileList
        files={files}
        focusedIndex={0}
        selectedFiles={new Set()}
        onFileClick={() => {}}
        rowVirtualizer={rowVirtualizerWithItems}
        parentRef={{ current: null }}
        listContainerRef={() => {}}
        fileRowStyles={fileRowStylesStub}
        useCompactLayout={false}
        viewMode="list"
      />
    );

    expect(screen.getByText("readme.txt")).toBeInTheDocument();
    expect(measureElement).not.toHaveBeenCalled();
  });
});
