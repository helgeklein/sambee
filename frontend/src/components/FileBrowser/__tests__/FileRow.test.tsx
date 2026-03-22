import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../../i18n";
import { FileType } from "../../../types";
import { FileRow } from "../FileRow";

describe("FileRow", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("renders translated context menu items and aria labels", async () => {
    await setLocale("en-XA");

    render(
      <FileRow
        file={{
          name: "report.pdf",
          path: "/report.pdf",
          type: FileType.FILE,
          size: 1024,
          modified_at: "2024-01-01T00:00:00Z",
          is_readable: true,
          is_hidden: false,
        }}
        index={0}
        isSelected={true}
        isMultiSelected={true}
        virtualStart={0}
        virtualSize={48}
        onClick={vi.fn()}
        fileRowStyles={{
          buttonSelected: {},
          buttonNotSelected: {},
          buttonMultiSelected: {},
          buttonFocusedMultiSelected: {},
          iconBox: {},
          contentBox: {},
        }}
        viewMode="list"
        onOpenInApp={vi.fn()}
        onRename={vi.fn()}
      />
    );

    const expectedAriaLabel = `${translate("fileBrowser.row.itemTypes.file")}: report.pdf${translate("fileBrowser.row.selectedSuffix")}`;
    const rowButton = screen.getByRole("button", { name: expectedAriaLabel });

    expect(rowButton).toBeInTheDocument();

    fireEvent.contextMenu(rowButton);

    expect(screen.getByText(translate("common.actions.rename"))).toBeInTheDocument();
    expect(screen.getByText(translate("fileBrowser.row.openInCompanionApp"))).toBeInTheDocument();
  });
});
