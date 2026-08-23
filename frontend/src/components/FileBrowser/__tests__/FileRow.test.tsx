import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../../i18n";
import { FileType } from "../../../types";
import { FileRow, shortenTargetPath } from "../FileRow";

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

  it("renders a shortcut's full target path", () => {
    const props = createDefaultFileRowProps();
    props.isMultiSelected = false;
    props.file = {
      ...props.file,
      name: "Project.lnk",
      link_kind: "windows_shortcut",
      link_target: {
        source_path: "Project.lnk",
        state: "resolved",
        target: { name: "Project Archive", path: "C:\\Users\\Sambee\\Projects\\Project Archive", type: "directory" },
      },
    };

    render(<FileRow {...props} />);

    expect(screen.getByText(/-> C:\\Users\\Sambee\\Projects\\Project Archive/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcut target: C:\\Users\\Sambee\\Projects\\Project Archive/i })).toBeInTheDocument();
    expect(screen.getByTestId("ShortcutIcon")).toBeInTheDocument();
  });

  it("shortens target paths from the ancestor end while retaining the basename", () => {
    const measureCharacters = (text: string) => text.length;

    expect(shortenTargetPath("/Users/sambee/Projects/Archive/report.pdf", 17, measureCharacters)).toBe("/.../report.pdf");
    expect(shortenTargetPath("C:\\Users\\sambee\\Projects\\report.pdf", 18, measureCharacters)).toBe("C:\\...\\report.pdf");
    expect(shortenTargetPath("/Users/sambee/report.pdf", 100, measureCharacters)).toBe("/Users/sambee/report.pdf");
    expect(shortenTargetPath("report.pdf", 3, measureCharacters)).toBe("report.pdf");
  });

  it("rerenders when deferred shortcut metadata arrives", () => {
    const props = createDefaultFileRowProps();
    props.isMultiSelected = false;
    props.file = {
      ...props.file,
      name: "Project.lnk",
      link_kind: "windows_shortcut",
    };

    const { rerender } = render(<FileRow {...props} />);

    expect(screen.queryByText(/-> Project Archive/)).not.toBeInTheDocument();

    rerender(
      <FileRow
        {...props}
        file={{
          ...props.file,
          link_target: {
            source_path: "Project.lnk",
            state: "resolved",
            target: { name: "Project Archive", type: "directory" },
          },
        }}
      />
    );

    expect(screen.getByText(/-> Project Archive/)).toBeInTheDocument();
  });

  it("hides file actions for a shortcut resolving to a directory", () => {
    const props = createDefaultFileRowProps();
    props.isMultiSelected = false;
    props.file = {
      ...props.file,
      name: "Project.lnk",
      link_kind: "windows_shortcut",
      link_target: {
        source_path: "Project.lnk",
        state: "resolved",
        target: { name: "Project Archive", type: "directory" },
      },
    };

    render(<FileRow {...props} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /shortcut target: Project Archive/i }));

    expect(screen.getByText(translate("common.actions.rename"))).toBeInTheDocument();
    expect(screen.queryByText(translate("fileBrowser.row.openInBrowserViewer"))).not.toBeInTheDocument();
    expect(screen.queryByText(translate("fileBrowser.row.chooseBrowserViewer"))).not.toBeInTheDocument();
    expect(screen.queryByText(translate("fileBrowser.row.openInNativeApp"))).not.toBeInTheDocument();
    expect(screen.queryByText(translate("fileBrowser.row.chooseNativeApp"))).not.toBeInTheDocument();
  });
});
