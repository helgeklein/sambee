import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../../i18n";
import { FileType } from "../../../types";
import { FileRow } from "../FileRow";

function createDefaultFileRowProps() {
  return {
    file: {
      name: "report.pdf",
      path: "/report.pdf",
      type: FileType.FILE,
      size: 1024,
      modified_at: "2024-01-01T00:00:00Z",
      is_readable: true,
      is_hidden: false,
    },
    useCompactLayout: false,
    index: 0,
    isSelected: true,
    isMultiSelected: true,
    virtualStart: 0,
    virtualSize: 48,
    onClick: vi.fn(),
    fileRowStyles: {
      buttonSelected: {},
      buttonNotSelected: {},
      buttonMultiSelected: {},
      buttonFocusedMultiSelected: {},
      iconBox: {},
      contentBox: {},
    },
    viewMode: "list" as const,
    onOpenAssociatedViewer: vi.fn(),
    onOpenViewerPicker: vi.fn(),
    onOpenAssociatedNativeApp: vi.fn(),
    onOpenNativePicker: vi.fn(),
    onRename: vi.fn(),
  };
}

describe("FileRow", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("renders translated context menu items and aria labels", async () => {
    await setLocale("en-XA");

    render(<FileRow {...createDefaultFileRowProps()} />);

    const expectedAriaLabel = `${translate("fileBrowser.row.itemTypes.file")}: report.pdf${translate("fileBrowser.row.selectedSuffix")}`;
    const rowButton = screen.getByRole("button", { name: expectedAriaLabel });

    expect(rowButton).toBeInTheDocument();

    fireEvent.contextMenu(rowButton);

    expect(screen.getByText(translate("common.actions.rename"))).toBeInTheDocument();
    expect(screen.getByText(translate("fileBrowser.row.openInBrowserViewer"))).toBeInTheDocument();
    expect(screen.getByText(translate("fileBrowser.row.chooseBrowserViewer"))).toBeInTheDocument();
    expect(screen.getByText(translate("fileBrowser.row.openInNativeApp"))).toBeInTheDocument();
    expect(screen.getByText(translate("fileBrowser.row.chooseNativeApp"))).toBeInTheDocument();
  });

  it("invokes onClick when the row button is pressed", () => {
    const props = createDefaultFileRowProps();

    render(<FileRow {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/i }));

    expect(props.onClick).toHaveBeenCalledWith(props.file, props.index);
  });
});
