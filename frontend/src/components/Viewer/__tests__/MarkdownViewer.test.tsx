import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../../services/api";
import { SambeeThemeProvider } from "../../../theme";
import MarkdownViewer from "../MarkdownViewer";
import { createViewerSearchTestDriver } from "./viewerSearchTestUtils";

const mockMarkdownEditorBehavior = {
  changeBeforeUserEdit: false,
  throwOnInsertCodeBlock: false,
  throwOnRender: false,
};

const mockMarkdownEditorCommands = {
  insertCodeBlock: vi.fn(),
  toggleInlineCode: vi.fn(),
};

vi.mock("../MarkdownRichEditor", () => {
  const MockMarkdownRichEditor = forwardRef<
    {
      focus: () => void;
      nextSearchResult: () => void;
      previousSearchResult: () => void;
      toggleInlineCode: () => void;
      insertCodeBlock: () => void;
    },
    {
      markdown: string;
      onChange: (markdown: string) => void;
      onUserEdit?: () => void;
      ariaLabel: string;
      autoFocus?: boolean;
      readOnly?: boolean;
      className?: string;
      searchText?: string;
      searchOpen?: boolean;
      onSearchStateChange?: (state: {
        searchText: string;
        searchMatches: number;
        currentMatch: number;
        isSearchOpen: boolean;
        isSearchable: boolean;
        viewMode: "rich-text" | "source" | "diff";
      }) => void;
    }
  >(
    (
      { markdown, onChange, onUserEdit, ariaLabel, readOnly = false, className, searchText = "", searchOpen = false, onSearchStateChange },
      ref
    ) => {
      if (mockMarkdownEditorBehavior.throwOnRender) {
        throw new Error("Editor render failed");
      }

      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      const [currentMatch, setCurrentMatch] = useState(0);

      useEffect(() => {
        if (!searchOpen || !searchText) {
          setCurrentMatch(0);
          return;
        }

        setCurrentMatch(1);
      }, [searchOpen, searchText]);

      useEffect(() => {
        onSearchStateChange?.({
          searchText,
          searchMatches: searchText ? 2 : 0,
          currentMatch: searchText ? currentMatch : 0,
          isSearchOpen: searchOpen,
          isSearchable: true,
          viewMode: "rich-text",
        });
      }, [currentMatch, onSearchStateChange, searchOpen, searchText]);

      useImperativeHandle(ref, () => ({
        focus: () => {
          textareaRef.current?.focus();
        },
        nextSearchResult: () => {
          if (!searchText) {
            return;
          }

          setCurrentMatch((previousMatch) => (previousMatch >= 2 ? 1 : previousMatch + 1));
        },
        previousSearchResult: () => {
          if (!searchText) {
            return;
          }

          setCurrentMatch((previousMatch) => (previousMatch <= 1 ? 2 : previousMatch - 1));
        },
        toggleInlineCode: () => {
          mockMarkdownEditorCommands.toggleInlineCode();
        },
        insertCodeBlock: () => {
          if (mockMarkdownEditorBehavior.throwOnInsertCodeBlock) {
            throw new Error("Insert code block failed");
          }

          mockMarkdownEditorCommands.insertCodeBlock();
        },
      }));

      return (
        <textarea
          ref={textareaRef}
          className={className}
          aria-label={ariaLabel}
          value={markdown}
          readOnly={readOnly}
          onChange={(event) => {
            if (mockMarkdownEditorBehavior.changeBeforeUserEdit) {
              onChange(event.target.value);
              onUserEdit?.();
              return;
            }

            onUserEdit?.();
            onChange(event.target.value);
          }}
        />
      );
    }
  );

  MockMarkdownRichEditor.displayName = "MockMarkdownRichEditor";

  return {
    __esModule: true,
    default: MockMarkdownRichEditor,
  };
});

describe("MarkdownViewer", () => {
  const viewerSearch = createViewerSearchTestDriver({
    assertCurrentMatchActive: () => {
      expect(document.querySelectorAll('mark[data-text-search-current="true"]').length).toBeGreaterThan(0);
    },
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("access_token", "mock-token");
    vi.restoreAllMocks();
    mockMarkdownEditorBehavior.changeBeforeUserEdit = false;
    mockMarkdownEditorBehavior.throwOnInsertCodeBlock = false;
    mockMarkdownEditorBehavior.throwOnRender = false;
    mockMarkdownEditorCommands.insertCodeBlock.mockReset();
    mockMarkdownEditorCommands.toggleInlineCode.mockReset();
  });

  function renderViewer() {
    return renderViewerWithProps();
  }

  function renderViewerWithProps({ onClose = () => {} }: { onClose?: () => void } = {}) {
    return render(
      <SambeeThemeProvider>
        <MarkdownViewer connectionId="conn1" path="/docs/readme.md" onClose={onClose} />
      </SambeeThemeProvider>
    );
  }

  it("enters edit mode and acquires a lock for server-backed markdown files", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    const acquireLockSpy = vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveFocus();
    });
    expect(acquireLockSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md", expect.any(String));
  });

  it("exits edit mode on Escape without closing the viewer or prompting when nothing changed", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewerWithProps({ onClose });

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    await waitFor(() => {
      expect(editor).toHaveFocus();
    });

    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md");
  });

  it("shows an error and stays in read-only mode when entering edit mode fails", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockRejectedValueOnce(new Error("Lock conflict"));

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByText("Unable to enter edit mode. Failed to acquire edit lock.: Lock conflict")).toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("saves markdown changes and releases the lock", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const saveSpy = vi.spyOn(apiService, "saveTextFile").mockResolvedValue();
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md", "# Updated\n", {
        filename: "readme.md",
        mimeType: "text/markdown;charset=utf-8",
      });
    });

    await waitFor(() => {
      expect(releaseSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md");
    });
    expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("shows an error and stays in edit mode when saving fails", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "saveTextFile").mockRejectedValueOnce(new Error("Disk full"));
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save markdown changes.: Disk full")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    expect(releaseSpy).not.toHaveBeenCalledWith("conn1", "/docs/readme.md");
  });

  it("searches rendered markdown and navigates between matches", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");

    renderViewer();

    await screen.findByText("Alpha");
    await viewerSearch.expectFirstMatchActive({
      searchTerm: "alpha",
      expectedCounterText: "1 / 3",
    });

    await waitFor(() => {
      expect(document.querySelectorAll('mark[data-text-search-highlight="true"]').length).toBe(3);
    });

    await viewerSearch.expectRefinedSearchKeepsCurrentMatchActive({
      refinedSearchTerm: "al",
      expectedCounterText: "1 / 3",
    });

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));

    await waitFor(() => {
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
    });
  });

  it("treats cross-inline markdown text as a single search match", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("sam**bee** sambee\n");

    renderViewer();

    await screen.findByText("sambee", { exact: false });
    await viewerSearch.openSearch("sambee");

    await waitFor(() => {
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });

    expect(document.querySelectorAll('mark[data-text-search-highlight="true"]').length).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));

    await waitFor(() => {
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
    });
  });

  it("keeps edit mode open when discard confirmation is rejected", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    });

    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("prompts on Escape after a real edit even if the editor reports change before user-edit", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    mockMarkdownEditorBehavior.changeBeforeUserEdit = true;

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(unsavedDialog).toBeInTheDocument();

    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    });

    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("discards and closes from the unsaved changes dialog", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewerWithProps({ onClose });

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(releaseSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("saves from the unsaved changes dialog before closing the viewer", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const saveSpy = vi.spyOn(apiService, "saveTextFile").mockResolvedValue();
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewerWithProps({ onClose });

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md", "# Updated\n", {
        filename: "readme.md",
        mimeType: "text/markdown;charset=utf-8",
      });
      expect(releaseSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("sends heartbeat requests while an edit lock is held", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    const heartbeatSpy = vi.spyOn(apiService, "heartbeatEditLock").mockResolvedValue();
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalled();
    });

    const heartbeatIntervalCall = setIntervalSpy.mock.calls.find((call) => call[1] === 30_000);
    const heartbeatCallback = heartbeatIntervalCall?.[0];
    expect(typeof heartbeatCallback).toBe("function");

    await act(async () => {
      await (heartbeatCallback as TimerHandler & (() => Promise<void> | void))();
    });

    await waitFor(() => {
      expect(heartbeatSpy).toHaveBeenCalledWith("conn1", "/docs/readme.md");
    });
  });

  it("closes search instead of the viewer when Escape is pressed in the search input", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");

    renderViewerWithProps({ onClose });

    await screen.findByText("Alpha");
    await viewerSearch.expectEscapeClosesSearch({
      searchTerm: "alpha",
      assertViewerStillOpen: () => {
        expect(onClose).not.toHaveBeenCalled();
      },
    });
  });

  it("searches markdown while editing and navigates between matches", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    await viewerSearch.openSearch("alpha");

    await waitFor(() => {
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));

    await waitFor(() => {
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
    });
  });

  it("triggers inline code formatting from the markdown shortcut", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "e", ctrlKey: true });

    expect(mockMarkdownEditorCommands.toggleInlineCode).toHaveBeenCalledTimes(1);
  });

  it("inserts a code block from the markdown shortcut", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "E", ctrlKey: true, shiftKey: true });

    expect(mockMarkdownEditorCommands.insertCodeBlock).toHaveBeenCalledTimes(1);
  });

  it("recovers from a markdown editor render crash without closing the viewer", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);
    mockMarkdownEditorBehavior.throwOnRender = true;

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByText("Editor unavailable");

    mockMarkdownEditorBehavior.throwOnRender = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry editor" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    });

    consoleErrorSpy.mockRestore();
  });

  it("shows a recoverable error when a markdown editor command throws", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);
    mockMarkdownEditorBehavior.throwOnInsertCodeBlock = true;

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "E", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText("Failed to run Insert code block. Insert code block failed")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
  });
});
