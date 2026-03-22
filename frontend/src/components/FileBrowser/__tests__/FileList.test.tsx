import type { Virtualizer } from "@tanstack/react-virtual";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, translate } from "../../../i18n";
import { FileList } from "../FileList";

const rowVirtualizerStub = {
  getVirtualItems: () => [],
  getTotalSize: () => 0,
} as unknown as Virtualizer<HTMLDivElement, Element>;

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
        fileRowStyles={{
          iconBox: {},
          contentBox: {},
          buttonSelected: {},
          buttonNotSelected: {},
          buttonMultiSelected: {},
          buttonFocusedMultiSelected: {},
        }}
        viewMode="list"
      />
    );

    expect(screen.getByText(translate("fileBrowser.list.emptyDirectory"))).toBeInTheDocument();
  });
});
