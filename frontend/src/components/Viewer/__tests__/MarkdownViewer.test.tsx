import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../../services/api";
import { SambeeThemeProvider } from "../../../theme";
import MarkdownViewer from "../MarkdownViewer";
import { createViewerSearchTestDriver } from "./viewerSearchTestUtils";

const mockMarkdownEditorBehavior = {
  changeBeforeUserEdit: false,
  delayFocus: false,
  emitNonEditableInputBeforeInitialChange: false,
  focusEditableBeforeInitialChange: false,
  focusCurrentSearchResultCalls: 0,
  focusResetsScrollPosition: false,
  initialNormalizedMarkdown: null as string | null,
  lastSearchOpen: false,
  lastSearchText: "",
  lastRestoredScrollTop: null as number | null,
  preserveSelectionCalls: 0,
  restorePreservedSelectionCalls: 0,
  skipUserEdit: false,
  throwOnInsertCodeBlock: false,
  throwOnRender: false,
};

const mockMarkdownEditorCommands = {
  createLink: vi.fn(),
  insertTable: vi.fn(),
  insertThematicBreak: vi.fn(),
  insertCodeBlock: vi.fn(),
  toggleInlineCode: vi.fn(),
};

vi.mock("../MarkdownRichEditor", () => {
  const MockMarkdownRichEditor = forwardRef<
    {
      focus: () => void;
      preserveSelection: () => void;
      restorePreservedSelection: () => boolean;
      focusCurrentSearchResult: () => boolean;
      nextSearchResult: () => void;
      previousSearchResult: () => void;
      createLink: () => void;
      insertTable: () => void;
      insertThematicBreak: () => void;
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

      mockMarkdownEditorBehavior.lastSearchOpen = searchOpen;
      mockMarkdownEditorBehavior.lastSearchText = searchText;

      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      const toolbarButtonRef = useRef<HTMLButtonElement | null>(null);
      const preservedSelectionRef = useRef<{
        type: "textarea";
        start: number;
        end: number;
        direction: "forward" | "backward" | "none";
        scrollTop: number;
      } | null>(null);
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

      useEffect(() => {
        if (mockMarkdownEditorBehavior.focusEditableBeforeInitialChange) {
          textareaRef.current?.focus();
        }

        if (mockMarkdownEditorBehavior.emitNonEditableInputBeforeInitialChange && toolbarButtonRef.current) {
          toolbarButtonRef.current.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }

        if (mockMarkdownEditorBehavior.initialNormalizedMarkdown !== null) {
          onChange(mockMarkdownEditorBehavior.initialNormalizedMarkdown);
        }
      }, [onChange]);

      useImperativeHandle(ref, () => ({
        focus: () => {
          if (mockMarkdownEditorBehavior.delayFocus) {
            window.setTimeout(() => {
              if (mockMarkdownEditorBehavior.focusResetsScrollPosition && textareaRef.current) {
                textareaRef.current.scrollTop = 0;
              }
              textareaRef.current?.focus({ preventScroll: true });
            }, 72);
            return;
          }

          if (mockMarkdownEditorBehavior.focusResetsScrollPosition && textareaRef.current) {
            textareaRef.current.scrollTop = 0;
          }

          textareaRef.current?.focus({ preventScroll: true });
        },
        preserveSelection: () => {
          mockMarkdownEditorBehavior.preserveSelectionCalls += 1;
          const textarea = textareaRef.current;

          if (!textarea) {
            preservedSelectionRef.current = null;
            return;
          }

          preservedSelectionRef.current = {
            type: "textarea",
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
            direction: textarea.selectionDirection ?? "none",
            scrollTop: textarea.scrollTop,
          };
        },
        restorePreservedSelection: () => {
          mockMarkdownEditorBehavior.restorePreservedSelectionCalls += 1;
          const textarea = textareaRef.current;

          if (!textarea) {
            return false;
          }

          textarea.focus({ preventScroll: true });

          if (!preservedSelectionRef.current) {
            return document.activeElement === textarea;
          }

          textarea.setSelectionRange(
            preservedSelectionRef.current.start,
            preservedSelectionRef.current.end,
            preservedSelectionRef.current.direction
          );
          textarea.scrollTop = preservedSelectionRef.current.scrollTop;
          mockMarkdownEditorBehavior.lastRestoredScrollTop = preservedSelectionRef.current.scrollTop;
          const restored = document.activeElement === textarea;

          if (restored) {
            preservedSelectionRef.current = null;
          }

          return restored;
        },
        focusCurrentSearchResult: () => {
          mockMarkdownEditorBehavior.focusCurrentSearchResultCalls += 1;
          const textarea = textareaRef.current;

          if (!textarea) {
            return false;
          }

          textarea.focus({ preventScroll: true });
          return document.activeElement === textarea;
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
        createLink: () => {
          mockMarkdownEditorCommands.createLink();
        },
        insertTable: () => {
          mockMarkdownEditorCommands.insertTable();
        },
        insertThematicBreak: () => {
          mockMarkdownEditorCommands.insertThematicBreak();
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
        <div
          className={className}
          onChangeCapture={(event) => {
            if (!mockMarkdownEditorBehavior.skipUserEdit) {
              return;
            }

            const target = event.target;
            if (target instanceof HTMLTextAreaElement) {
              onUserEdit?.();
            }
          }}
        >
          <button ref={toolbarButtonRef} type="button">
            Toolbar action
          </button>
          <textarea
            ref={textareaRef}
            aria-label={ariaLabel}
            value={markdown}
            readOnly={readOnly}
            onChange={(event) => {
              if (mockMarkdownEditorBehavior.skipUserEdit) {
                onChange(event.target.value);
                return;
              }

              if (mockMarkdownEditorBehavior.changeBeforeUserEdit) {
                onChange(event.target.value);
                onUserEdit?.();
                return;
              }

              onUserEdit?.();
              onChange(event.target.value);
            }}
          />
        </div>
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

  function suppressExpectedRenderCrashNoise(message: string): () => void {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const combinedMessage = args.map((value) => (value instanceof Error ? value.message : String(value))).join(" ");

      if (combinedMessage.includes(message)) {
        return;
      }
    });

    const handleWindowError = (event: ErrorEvent) => {
      if (event.error instanceof Error && event.error.message === message) {
        event.preventDefault();
      }
    };

    window.addEventListener("error", handleWindowError);

    return () => {
      window.removeEventListener("error", handleWindowError);
      consoleErrorSpy.mockRestore();
    };
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("access_token", "mock-token");
    vi.restoreAllMocks();
    mockMarkdownEditorBehavior.changeBeforeUserEdit = false;
    mockMarkdownEditorBehavior.delayFocus = false;
    mockMarkdownEditorBehavior.emitNonEditableInputBeforeInitialChange = false;
    mockMarkdownEditorBehavior.focusEditableBeforeInitialChange = false;
    mockMarkdownEditorBehavior.focusCurrentSearchResultCalls = 0;
    mockMarkdownEditorBehavior.focusResetsScrollPosition = false;
    mockMarkdownEditorBehavior.initialNormalizedMarkdown = null;
    mockMarkdownEditorBehavior.lastSearchOpen = false;
    mockMarkdownEditorBehavior.lastSearchText = "";
    mockMarkdownEditorBehavior.lastRestoredScrollTop = null;
    mockMarkdownEditorBehavior.preserveSelectionCalls = 0;
    mockMarkdownEditorBehavior.restorePreservedSelectionCalls = 0;
    mockMarkdownEditorBehavior.skipUserEdit = false;
    mockMarkdownEditorBehavior.throwOnInsertCodeBlock = false;
    mockMarkdownEditorBehavior.throwOnRender = false;
    mockMarkdownEditorCommands.createLink.mockReset();
    mockMarkdownEditorCommands.insertTable.mockReset();
    mockMarkdownEditorCommands.insertThematicBreak.mockReset();
    mockMarkdownEditorCommands.insertCodeBlock.mockReset();
    mockMarkdownEditorCommands.toggleInlineCode.mockReset();
  });

  function renderViewer() {
    return renderViewerWithProps();
  }

  function renderViewerWithProps({ onClose = () => {}, isReadOnly = false }: { onClose?: () => void; isReadOnly?: boolean } = {}) {
    return render(
      <SambeeThemeProvider>
        <MarkdownViewer connectionId="conn1" path="/docs/readme.md" onClose={onClose} isReadOnly={isReadOnly} />
      </SambeeThemeProvider>
    );
  }

  it("does not expose markdown edit mode for read-only connections", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    const acquireLockSpy = vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });

    renderViewerWithProps({ isReadOnly: true });

    await screen.findByText("Readme");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.queryByText("Browse and preview content, but block writes and edit flows through Sambee.")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "e" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
    });

    expect(acquireLockSpy).not.toHaveBeenCalled();
  });

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

  it("resets the viewer scroll position when entering edit mode", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n\nLine 2\n\nLine 3\n\nLine 4\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });

    renderViewer();

    await screen.findByText("Readme");

    const contentContainer = screen.getByTestId("markdown-viewer-content");

    contentContainer.scrollTop = 240;

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    });

    expect(contentContainer.scrollTop).toBe(0);
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

  it("renders only the close button in the top bar while editing", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByRole("textbox", { name: "Markdown editor" });

    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
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

  it("saves markdown changes and stays in edit mode", async () => {
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

    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
    expect(releaseSpy).not.toHaveBeenCalledWith("conn1", "/docs/readme.md");
  });

  it("restores focus to the editor after save even when editor focus is delayed", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "saveTextFile").mockResolvedValue();
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    mockMarkdownEditorBehavior.delayFocus = true;

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveFocus();
    });
  });

  it("preserves the caret position after saving", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "saveTextFile").mockResolvedValue();
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = (await screen.findByRole("textbox", { name: "Markdown editor" })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    editor.focus();
    editor.setSelectionRange(3, 3);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(editor).toHaveFocus();
      expect(editor.selectionStart).toBe(3);
      expect(editor.selectionEnd).toBe(3);
    });
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

  it("shows the backend read-only detail when a stale client save is rejected with 403", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "saveTextFile").mockRejectedValueOnce({
      response: {
        data: { detail: "Connection is read-only" },
        status: 403,
      },
    });
    const releaseSpy = vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Connection is read-only")).toBeInTheDocument();
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

  it("opens rendered markdown links in a new tab while in viewer mode", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("[Docs](https://example.com/docs)\n");

    renderViewer();

    const link = await screen.findByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens a markdown link on the first click even before viewer autofocus settles", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("[Docs](https://example.com/docs)\n");

    renderViewer();

    const link = await screen.findByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");

    // The onClick handler on external links calls window.open() directly,
    // ensuring the link opens even if the browser misses the native
    // <a target="_blank"> navigation due to mid-event React re-renders.
    fireEvent.click(link);
    expect(windowOpenSpy).toHaveBeenCalledWith("https://example.com/docs", "_blank", "noopener,noreferrer");

    windowOpenSpy.mockRestore();
  });

  it("restores viewer focus after opening an external markdown link so shortcuts still work", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("[Docs](https://example.com/docs)\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    const link = await screen.findByRole("link", { name: "Docs" });
    const viewerContent = link.closest('[tabindex="0"]');

    expect(viewerContent).not.toBeNull();

    act(() => {
      link.focus();
    });
    expect(link).toHaveFocus();

    fireEvent.click(link);

    await waitFor(() => {
      expect(viewerContent).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "e" });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
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

    await screen.findByLabelText("Unsaved changes");

    fireEvent.keyDown(editor, { key: "Escape" });

    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(unsavedDialog).toBeInTheDocument();

    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    });

    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("restores the caret position after cancelling the unsaved changes dialog", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = (await screen.findByRole("textbox", { name: "Markdown editor" })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# Updated\n" } });

    editor.focus();
    editor.setSelectionRange(3, 3);

    fireEvent.keyDown(editor, { key: "Escape" });

    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(unsavedDialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(editor).toHaveFocus();
    });

    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
  });

  it("preserves editor state before opening the unsaved changes dialog", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = (await screen.findByRole("textbox", { name: "Markdown editor" })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# Updated\n" } });

    editor.focus();
    editor.setSelectionRange(3, 3);
    editor.scrollTop = 220;

    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
      expect(mockMarkdownEditorBehavior.preserveSelectionCalls).toBeGreaterThan(0);
    });
  });

  it("shows an unsaved indicator in the header when the markdown draft is dirty", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });

    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "# Readme\nUpdated\n" } });

    expect(await screen.findByLabelText("Unsaved changes")).toBeInTheDocument();
  });

  it("does not mark the document dirty from a non-editable mount event before the initial editor normalization change", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    mockMarkdownEditorBehavior.emitNonEditableInputBeforeInitialChange = true;
    mockMarkdownEditorBehavior.initialNormalizedMarkdown = "# Readme\n\n";

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByRole("textbox", { name: "Markdown editor" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();
    });
  });

  it("does not mark the document dirty when autofocus happens before the initial editor normalization change", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    mockMarkdownEditorBehavior.focusEditableBeforeInitialChange = true;
    mockMarkdownEditorBehavior.initialNormalizedMarkdown = "# Readme\n\n";

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByRole("textbox", { name: "Markdown editor" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();
    });
  });

  it("keeps the unsaved indicator when the editor change event arrives without a user-edit callback", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Readme\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValueOnce({
      lock_id: "lock-1",
      file_path: "/docs/readme.md",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    mockMarkdownEditorBehavior.skipUserEdit = true;

    renderViewer();

    await screen.findByText("Readme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    await waitFor(() => {
      expect(editor).toHaveFocus();
    });
    fireEvent.change(editor, { target: { value: "# Readme\nUpdated\n" } });

    expect(await screen.findByLabelText("Unsaved changes")).toBeInTheDocument();
  });

  it("prompts again after dismissing the unsaved changes dialog with Escape", async () => {
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

    fireEvent.keyDown(editor, { key: "Escape" });
    const unsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await waitFor(() => {
      expect(within(unsavedDialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    fireEvent.keyDown(unsavedDialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    });

    const editorAfterDismiss = await screen.findByRole("textbox", { name: "Markdown editor" });
    await waitFor(() => {
      expect(document.activeElement).not.toBeNull();
    });

    expect(releaseSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(document.activeElement ?? editorAfterDismiss, { key: "Escape" });

    const reopenedUnsavedDialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await waitFor(() => {
      expect(within(reopenedUnsavedDialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    expect(reopenedUnsavedDialog).toBeInTheDocument();
    expect(releaseSpy).not.toHaveBeenCalled();
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

  it("closes shortcuts help on Escape without closing the markdown viewer", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");

    renderViewerWithProps({ onClose });

    await screen.findByText("Alpha");

    fireEvent.keyDown(document, { key: "?" });

    await waitFor(() => {
      expect(screen.getByText("Markdown viewer shortcuts")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Markdown viewer shortcuts")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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

  it("returns focus to the active editor match when edit-mode search is dismissed with Escape", async () => {
    const onClose = vi.fn();

    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewerWithProps({ onClose });

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    const searchInput = await viewerSearch.openSearch("alpha");

    await waitFor(() => {
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });

    fireEvent.keyDown(searchInput, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument();
      expect(editor).toHaveFocus();
    });

    expect(mockMarkdownEditorBehavior.focusCurrentSearchResultCalls).toBeGreaterThan(0);
    expect(mockMarkdownEditorBehavior.lastSearchOpen).toBe(false);
    expect(mockMarkdownEditorBehavior.lastSearchText).toBe("");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search")).toHaveValue("alpha");
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });
  });

  it("does not restore preview highlights after exiting edit mode when edit search was already closed", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n\nAlpha beta alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    const searchInput = await viewerSearch.openSearch("alpha");

    await waitFor(() => {
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });

    fireEvent.keyDown(searchInput, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument();
      expect(editor).toHaveFocus();
    });

    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
      expect(document.querySelectorAll('mark[data-text-search-highlight="true"]').length).toBe(0);
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

  it("opens the create-link dialog from the markdown shortcut", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(mockMarkdownEditorCommands.createLink).toHaveBeenCalledTimes(1);
  });

  it("inserts a table from the markdown shortcut", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "t", ctrlKey: true, altKey: true });

    expect(mockMarkdownEditorCommands.insertTable).toHaveBeenCalledTimes(1);
  });

  it("inserts a thematic break from the markdown shortcut", async () => {
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("# Alpha\n");
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(false);

    renderViewer();

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.keyDown(document, { key: "h", ctrlKey: true, altKey: true });

    expect(mockMarkdownEditorCommands.insertThematicBreak).toHaveBeenCalledTimes(1);
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
    const restoreCrashNoiseSuppression = suppressExpectedRenderCrashNoise("Editor render failed");

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

    restoreCrashNoiseSuppression();
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
