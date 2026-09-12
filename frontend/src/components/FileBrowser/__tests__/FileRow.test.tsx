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

  it("does not render an application context menu on desktop", async () => {
    await setLocale("en-XA");

    render(<FileRow {...createDefaultFileRowProps()} />);

    const expectedAriaLabel = `${translate("fileBrowser.row.itemTypes.file")}: report.pdf${translate("fileBrowser.row.selectedSuffix")}`;
    const rowButton = screen.getByRole("button", { name: expectedAriaLabel });

    expect(rowButton).toBeInTheDocument();

    fireEvent.contextMenu(rowButton);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("invokes onClick when the row button is pressed", () => {
    const props = createDefaultFileRowProps();

    render(<FileRow {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/i }));

    expect(props.onClick).toHaveBeenCalledWith(props.file, props.index);
  });

  it("disables unavailable archive entries and hides their actions", () => {
    const props = createDefaultFileRowProps();
    props.file = { ...props.file, is_readable: false, archive_entry_state: "blocked" };

    render(<FileRow {...props} />);

    const rowButton = screen.getByRole("button", { name: /report\.pdf/i });
    expect(rowButton).toBeDisabled();
    fireEvent.click(rowButton);
    fireEvent.contextMenu(rowButton);

    expect(props.onClick).not.toHaveBeenCalled();
    expect(screen.queryByText(translate("fileBrowser.row.openInBrowserViewer"))).not.toBeInTheDocument();
  });

  it("keeps readable archive directories enabled for navigation", () => {
    const props = createDefaultFileRowProps();
    props.file = {
      ...props.file,
      name: "nested",
      path: "nested",
      type: FileType.DIRECTORY,
      is_readable: true,
      archive_entry_state: "readable",
    };

    render(<FileRow {...props} />);

    const rowButton = screen.getByRole("button", { name: /nested/i });
    expect(rowButton).not.toBeDisabled();
    fireEvent.click(rowButton);
    expect(props.onClick).toHaveBeenCalledWith(props.file, props.index);
  });

  it("updates archive entry actions when a refresh marks the entry unavailable", () => {
    const props = createDefaultFileRowProps();
    const { rerender } = render(<FileRow {...props} />);

    rerender(<FileRow {...props} file={{ ...props.file, is_readable: false, archive_entry_state: "blocked" }} />);

    const rowButton = screen.getByRole("button", { name: /report\.pdf/i });
    expect(rowButton).toBeDisabled();
    fireEvent.contextMenu(rowButton);
    expect(screen.queryByText(translate("fileBrowser.row.openInBrowserViewer"))).not.toBeInTheDocument();
  });

  it("opens compact item actions without activating the row", () => {
    const props = createDefaultFileRowProps();
    const onOpenItemActions = vi.fn();

    render(<FileRow {...props} useCompactLayout showCompactActions onOpenItemActions={onOpenItemActions} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for report.pdf" }));

    expect(onOpenItemActions).toHaveBeenCalledWith(props.file, props.index, expect.any(HTMLElement));
    expect(props.onClick).not.toHaveBeenCalled();
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

    expect(screen.getByTitle("C:\\Users\\Sambee\\Projects\\Project Archive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcut target: C:\\Users\\Sambee\\Projects\\Project Archive/i })).toBeInTheDocument();
    expect(screen.getByText(/\u2192/)).toBeInTheDocument();
    expect(screen.getByTestId("ShortcutIcon")).toBeInTheDocument();
    expect(screen.queryByTestId("FolderIcon")).not.toBeInTheDocument();
    expect(screen.getByTitle("Project.lnk")).toHaveStyle({ flex: "0 1 auto" });
    expect(screen.getByTitle("C:\\Users\\Sambee\\Projects\\Project Archive")).toHaveStyle({ flex: "1 1 auto" });
  });

  it("renders an unresolved shortcut extension with the shortcut icon", () => {
    const props = createDefaultFileRowProps();
    props.isMultiSelected = false;
    props.file = { ...props.file, name: "My Drive.lnk" };

    render(<FileRow {...props} />);

    expect(screen.getByTestId("ShortcutIcon")).toBeInTheDocument();
  });

  it("shortens target paths from the ancestor end while retaining the basename", () => {
    const measureCharacters = (text: string) => text.length;

    expect(shortenTargetPath("/Users/sambee/Projects/Archive/report.pdf", 17, measureCharacters)).toBe("/.../report.pdf");
    expect(shortenTargetPath("C:\\Users\\sambee\\Projects\\report.pdf", 18, measureCharacters)).toBe("C:\\...\\report.pdf");
    expect(shortenTargetPath("/Users/sambee/report.pdf", 100, measureCharacters)).toBe("/Users/sambee/report.pdf");
    expect(shortenTargetPath("report.pdf", 3, measureCharacters)).toBe("...");
    expect(shortenTargetPath("/Users/sambee/very-long-report.pdf", 14, measureCharacters)).toBe("...-report.pdf");
  });

  it("rerenders when compact layout changes", () => {
    const props = createDefaultFileRowProps();
    const { rerender } = render(<FileRow {...props} />);

    rerender(<FileRow {...props} useCompactLayout />);

    expect(screen.getByText("report.pdf")).toHaveStyle({ fontSize: "17px" });
    expect(screen.getByTestId("CheckCircleIcon")).toHaveStyle({ fontSize: "28px" });
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

    expect(screen.getByText("Project Archive")).toBeInTheDocument();
  });

  it("does not attach application context actions to shortcut rows", () => {
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
    const rowButton = screen.getByRole("button", { name: /shortcut target: Project Archive/i });
    fireEvent.contextMenu(rowButton);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
