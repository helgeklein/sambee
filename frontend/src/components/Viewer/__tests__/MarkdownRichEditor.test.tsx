import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KEY_DOWN_COMMAND } from "lexical";
import { type ComponentProps, createRef, type ForwardedRef, forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import MarkdownRichEditor, { type MarkdownRichEditorHandle } from "../MarkdownRichEditor";
import { normalizeMarkdownTableCellLineBreaks } from "../markdownTableCellLineBreaks";

function mockMobileMode(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

const {
  mockCodeBlockPlugin,
  mockCodeMirrorPlugin,
  mockGetNearestNodeFromDOMNode,
  mockGetSelection,
  mockIsCodeBlockNode,
  mockIsTableNode,
  mockIsRangeSelection,
  mockMdxEditorAutoFocusHistory,
  mockMdxEditorChangeHandlerRef,
  mockNestedEditorUpdatedCommand,
  mockToggleLinkCommand,
} = vi.hoisted(() => ({
  mockCodeBlockPlugin: vi.fn((params?: unknown) => ({ type: "codeBlockPlugin", params })),
  mockCodeMirrorPlugin: vi.fn((params?: unknown) => ({ type: "codeMirrorPlugin", params })),
  mockGetNearestNodeFromDOMNode: vi.fn(),
  mockGetSelection: vi.fn(),
  mockIsCodeBlockNode: vi.fn(),
  mockIsTableNode: vi.fn(),
  mockIsRangeSelection: vi.fn(),
  mockMdxEditorAutoFocusHistory: [] as boolean[],
  mockMdxEditorChangeHandlerRef: { current: null as null | ((markdown: string) => void) },
  mockNestedEditorUpdatedCommand: Symbol("NESTED_EDITOR_UPDATED_COMMAND"),
  mockToggleLinkCommand: Symbol("toggleLinkCommand"),
}));

const mockApplyFormat = vi.fn();
const mockLexicalFocus = vi.fn((callback?: () => void) => {
  callback?.();
});
const mockLexicalUpdate = vi.fn((updateFn: () => void) => {
  updateFn();
});
const mockLexicalRead = vi.fn(<T,>(callback: () => T) => callback());
const mockInsertCodeBlock = vi.fn();
const mockInsertTable = vi.fn();
const mockInsertThematicBreak = vi.fn();
const mockApplyBlockType = vi.fn();
const mockApplyListType = vi.fn();
const mockDispatchCommand = vi.fn();
const mockGetMarkdown = vi.fn((markdown: string) => markdown);
const mockRegisterCommand = vi.fn(() => vi.fn());
const mockSetMarkdown = vi.fn();
const mockSetSourceEditorMarkdown = vi.fn();
const mockSetViewMode = vi.fn();
let mockCurrentBlockType: "paragraph" | "quote" | "h1" | "h2" | "h3" = "paragraph";
let mockCurrentListType: "" | "bullet" | "number" | "check" = "";
let mockViewMode: "rich-text" | "source" | "diff" = "rich-text";
const mockGetRootElement = vi.fn<() => Element | null>(() => document.querySelector('textarea[aria-label="Mock editor input"]'));
const mockActiveEditor = {
  dispatchCommand: mockDispatchCommand,
  focus: mockLexicalFocus,
  getEditorState: () => ({ read: mockLexicalRead }),
  getRootElement: mockGetRootElement,
  registerCommand: mockRegisterCommand,
  update: mockLexicalUpdate,
};

vi.mock("@lexical/link", () => ({
  TOGGLE_LINK_COMMAND: mockToggleLinkCommand,
}));

vi.mock("lexical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lexical")>();

  return {
    ...actual,
    $getNearestNodeFromDOMNode: mockGetNearestNodeFromDOMNode,
    $getSelection: mockGetSelection,
    $isRangeSelection: mockIsRangeSelection,
  };
});

vi.mock("@mdxeditor/gurx", () => ({
  useCellValue: () => (iconName: string) => iconName,
  useCellValues: (...signals: unknown[]) => {
    if (signals.some((signal) => String(signal).includes("activeEditor"))) {
      return [
        (iconName: string) => iconName,
        {
          dispatchCommand: mockDispatchCommand,
          registerCommand: mockRegisterCommand,
        },
      ];
    }

    return [0, (iconName: string) => iconName];
  },
  usePublisher: (signal: unknown) => {
    if (String(signal).includes("insertCodeBlock")) {
      return mockInsertCodeBlock;
    }

    if (String(signal).includes("insertTable")) {
      return mockInsertTable;
    }

    if (String(signal).includes("insertThematicBreak")) {
      return mockInsertThematicBreak;
    }

    if (String(signal).includes("applyBlockType")) {
      return mockApplyBlockType;
    }

    if (String(signal).includes("applyListType")) {
      return mockApplyListType;
    }

    if (String(signal).includes("viewMode")) {
      return mockSetViewMode;
    }

    if (String(signal).includes("markdownSignal")) {
      return mockSetSourceEditorMarkdown;
    }

    if (String(signal).includes("markdownSourceEditorValue")) {
      return mockSetSourceEditorMarkdown;
    }

    return mockApplyFormat;
  },
}));

const mockSearchState = {
  closeSearch: vi.fn(),
  currentRange: null as Range | null,
  cursor: 0,
  isSearchOpen: false,
  next: vi.fn(),
  openSearch: vi.fn(),
  prev: vi.fn(),
  search: "",
  setSearch: vi.fn(),
  total: 2,
};

vi.mock("@mdxeditor/editor", () => {
  const passthroughComponent = ({ children }: { children?: ReactNode }) => <>{children}</>;

  return {
    BlockTypeSelect: passthroughComponent,
    BoldItalicUnderlineToggles: passthroughComponent,
    CreateLink: passthroughComponent,
    CodeMirrorEditor: passthroughComponent,
    DiffSourceToggleWrapper: passthroughComponent,
    InsertTable: passthroughComponent,
    InsertThematicBreak: passthroughComponent,
    ListsToggle: passthroughComponent,
    MDXEditor: forwardRef(
      (
        props: {
          plugins?: Array<{ type?: string; params?: { toolbarContents?: () => ReactNode } }>;
          autoFocus?: boolean | object;
          contentEditableClassName?: string;
          markdown?: string;
          onChange?: (markdown: string) => void;
        },
        ref: ForwardedRef<unknown>
      ) => {
        mockMdxEditorAutoFocusHistory.push(Boolean(props.autoFocus));
        const textareaRef = useRef<HTMLTextAreaElement | null>(null);
        const [currentMarkdown, setCurrentMarkdown] = useState(props.markdown ?? "");

        useEffect(() => {
          setCurrentMarkdown(props.markdown ?? "");
        }, [props.markdown]);

        useEffect(() => {
          const handleEditorChange = (nextMarkdown: string) => {
            setCurrentMarkdown(nextMarkdown);
            props.onChange?.(nextMarkdown);
          };

          mockMdxEditorChangeHandlerRef.current = handleEditorChange;

          return () => {
            if (mockMdxEditorChangeHandlerRef.current === handleEditorChange) {
              mockMdxEditorChangeHandlerRef.current = null;
            }
          };
        }, [props.onChange]);

        useImperativeHandle(ref, () => ({
          focus: () => {
            textareaRef.current?.focus({ preventScroll: true });
          },
          getMarkdown: () => mockGetMarkdown(currentMarkdown),
          setMarkdown: (nextMarkdown: string) => {
            mockSetMarkdown(nextMarkdown);
            setCurrentMarkdown(nextMarkdown);
            props.onChange?.(nextMarkdown);
          },
        }));

        return (
          <div data-testid="mock-mdx-editor">
            <span data-testid="mock-mdx-editor-autofocus">{String(Boolean(props.autoFocus))}</span>
            <div className="mdxeditor-toolbar">
              <button type="button" data-toolbar-item aria-label="Bold">
                B
              </button>
              {props.plugins
                ?.filter((plugin) => plugin.type === "toolbarPlugin")
                .map((plugin) => (
                  <div key={plugin.type}>{plugin.params?.toolbarContents?.()}</div>
                ))}
            </div>
            <div data-testid="mock-editor-scroll-parent" style={{ overflow: "auto", maxHeight: 120 }}>
              <textarea
                aria-label="Mock editor input"
                className={props.contentEditableClassName}
                value={currentMarkdown}
                onChange={(event) => {
                  setCurrentMarkdown(event.target.value);
                  props.onChange?.(event.target.value);
                }}
                ref={(element) => {
                  textareaRef.current = element;
                  if (element && props.autoFocus) {
                    element.focus();
                  }
                }}
              />
            </div>
          </div>
        );
      }
    ),
    Separator: passthroughComponent,
    UndoRedo: passthroughComponent,
    diffSourcePlugin: (params?: unknown) => ({ type: "diffSourcePlugin", params }),
    contentEditableRef$: Symbol("contentEditableRef"),
    createRootEditorSubscription$: Symbol("createRootEditorSubscription"),
    applyBlockType$: Symbol("applyBlockType"),
    applyListType$: Symbol("applyListType"),
    editorSearchCursor$: Symbol("editorSearchCursor"),
    editorSearchRanges$: Symbol("editorSearchRanges"),
    editorSearchScrollableContent$: Symbol("editorSearchScrollableContent"),
    editorSearchTerm$: Symbol("editorSearchTerm"),
    editorSearchTextNodeIndex$: Symbol("editorSearchTextNodeIndex"),
    currentBlockType$: Symbol("currentBlockType"),
    editorInTable$: Symbol("editorInTable"),
    currentListType$: Symbol("currentListType"),
    headingsPlugin: (params?: unknown) => ({ type: "headingsPlugin", params }),
    linkPlugin: () => ({ type: "linkPlugin" }),
    listsPlugin: () => ({ type: "listsPlugin" }),
    markdownShortcutPlugin: () => ({ type: "markdownShortcutPlugin" }),
    quotePlugin: () => ({ type: "quotePlugin" }),
    searchPlugin: () => ({ type: "searchPlugin" }),
    codeBlockPlugin: mockCodeBlockPlugin,
    codeMirrorPlugin: mockCodeMirrorPlugin,
    tablePlugin: () => ({ type: "tablePlugin" }),
    thematicBreakPlugin: () => ({ type: "thematicBreakPlugin" }),
    toolbarPlugin: (params: { toolbarContents: () => ReactNode }) => ({ type: "toolbarPlugin", params }),
    activeEditor$: Symbol("activeEditor"),
    applyFormat$: Symbol("applyFormat"),
    $isCodeBlockNode: mockIsCodeBlockNode,
    $isTableNode: mockIsTableNode,
    ButtonWithTooltip: ({ title, children, ...props }: { title: string; children?: ReactNode; [key: string]: unknown }) => (
      <button
        type="button"
        data-toolbar-item
        data-editor-tooltip={title}
        aria-label={String(props["aria-label"] ?? title)}
        onClick={props["onClick"] as (() => void) | undefined}
      >
        {children}
      </button>
    ),
    useCellValue: (signal: unknown) => {
      if (String(signal).includes("currentBlockType")) {
        return mockCurrentBlockType;
      }

      if (String(signal).includes("currentListType")) {
        return mockCurrentListType;
      }

      if (String(signal).includes("editorInTable")) {
        return false;
      }

      if (String(signal).includes("viewMode")) {
        return mockViewMode;
      }

      if (String(signal).includes("activeEditor")) {
        return mockActiveEditor;
      }

      return "rich-text";
    },
    useEditorSearch: () => mockSearchState,
    currentFormat$: Symbol("currentFormat"),
    MDX_FOCUS_SEARCH_NAME: "MdxFocusSearch",
    MDX_SEARCH_NAME: "MdxSearch",
    NESTED_EDITOR_UPDATED_COMMAND: mockNestedEditorUpdatedCommand,
    iconComponentFor$: Symbol("iconComponentFor"),
    insertCodeBlock$: Symbol("insertCodeBlock"),
    insertTable$: Symbol("insertTable"),
    insertThematicBreak$: Symbol("insertThematicBreak"),
    IS_APPLE: false,
    IS_BOLD: 1,
    IS_CODE: 16,
    IS_ITALIC: 2,
    IS_UNDERLINE: 8,
    lexicalTheme: {
      text: {
        code: "mock-inline-code",
      },
    },
    markdown$: Symbol("markdownSignal"),
    markdownSourceEditorValue$: Symbol("markdownSourceEditorValue"),
    MultipleChoiceToggleGroup: ({ items }: { items: Array<{ title: string; contents: ReactNode; onChange?: () => void }> }) => (
      <div className="mdxeditor-toolbar-mock-group">
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            data-toolbar-item
            data-editor-tooltip={item.title}
            aria-label={item.title}
            onClick={item.onChange}
          >
            {item.contents}
          </button>
        ))}
      </div>
    ),
    rangeSearchScan: vi.fn(),
    realmPlugin: (plugin: unknown) => () => ({ type: "searchPlugin", plugin }),
    viewMode$: Symbol("viewMode"),
  };
});

describe("MarkdownRichEditor", () => {
  function renderEditor(props: ComponentProps<typeof MarkdownRichEditor>) {
    return render(
      <SambeeThemeProvider>
        <MarkdownRichEditor {...props} />
      </SambeeThemeProvider>
    );
  }

  function appendNestedTableCellEditable(
    editorContainer: HTMLElement,
    nestedEditor?: {
      dispatchCommand?: (command: unknown, payload: boolean) => void;
      update?: (callback: () => void) => void;
    }
  ) {
    const table = document.createElement("table");
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const nestedEditable = document.createElement("div") as HTMLDivElement & {
      __lexicalEditor?: {
        dispatchCommand?: (command: unknown, payload: boolean) => void;
        update?: (callback: () => void) => void;
      };
    };

    nestedEditable.setAttribute("contenteditable", "true");
    nestedEditable.setAttribute("data-lexical-editor", "true");

    if (nestedEditor) {
      nestedEditable.__lexicalEditor = nestedEditor;
    }

    cell.append(nestedEditable);
    row.append(cell);
    table.append(row);
    editorContainer.append(table);

    return nestedEditable;
  }

  beforeEach(() => {
    mockViewportWidth(1280);
    mockMobileMode(false);
    mockApplyFormat.mockReset();
    mockApplyBlockType.mockReset();
    mockApplyListType.mockReset();
    mockLexicalFocus.mockClear();
    mockLexicalRead.mockClear();
    mockLexicalUpdate.mockClear();
    mockCodeBlockPlugin.mockClear();
    mockCodeMirrorPlugin.mockClear();
    mockMdxEditorAutoFocusHistory.length = 0;
    mockMdxEditorChangeHandlerRef.current = null;
    mockInsertCodeBlock.mockReset();
    mockInsertTable.mockReset();
    mockInsertThematicBreak.mockReset();
    mockDispatchCommand.mockReset();
    mockGetMarkdown.mockClear();
    mockGetRootElement.mockReset();
    mockGetRootElement.mockImplementation(() => document.querySelector('textarea[aria-label="Mock editor input"]'));
    mockGetSelection.mockReset();
    mockGetSelection.mockReturnValue(null);
    mockGetNearestNodeFromDOMNode.mockReset();
    mockGetNearestNodeFromDOMNode.mockReturnValue(null);
    mockIsCodeBlockNode.mockReset();
    mockIsCodeBlockNode.mockReturnValue(false);
    mockIsTableNode.mockReset();
    mockIsTableNode.mockReturnValue(false);
    mockIsRangeSelection.mockReset();
    mockIsRangeSelection.mockReturnValue(false);
    mockRegisterCommand.mockClear();
    mockSetMarkdown.mockReset();
    mockSetSourceEditorMarkdown.mockReset();
    mockSetViewMode.mockReset();
    mockCurrentBlockType = "paragraph";
    mockCurrentListType = "";
    mockViewMode = "rich-text";
    mockSearchState.closeSearch.mockReset();
    mockSearchState.next.mockReset();
    mockSearchState.openSearch.mockReset();
    mockSearchState.prev.mockReset();
    mockSearchState.setSearch.mockReset();
    mockSearchState.cursor = 0;
    mockSearchState.isSearchOpen = false;
    mockSearchState.search = "";
    mockSearchState.total = 2;
    mockSearchState.closeSearch.mockImplementation(() => {
      mockSearchState.isSearchOpen = false;
    });
    mockSearchState.openSearch.mockImplementation(() => {
      mockSearchState.isSearchOpen = true;
    });
    mockSearchState.setSearch.mockImplementation((value: string | null) => {
      mockSearchState.search = value ?? "";
    });
  });

  it("renders a compact mobile toolbar with a More actions trigger", async () => {
    mockViewportWidth(320);
    mockMobileMode(true);

    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('[aria-label="More actions"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Bold (Ctrl+B)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Italic (Ctrl+I)"]')).toBeInTheDocument();
      expect(document.querySelector('[aria-label="Bulleted list"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Insert code block (Ctrl+Shift+E)"]')).not.toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Create link (Ctrl+K)"]')).not.toBeInTheDocument();
    });
  });

  it("promotes more primary actions as mobile width increases", async () => {
    mockViewportWidth(430);
    mockMobileMode(true);

    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('[aria-label="Bulleted list"]')).toBeInTheDocument();
      expect(document.querySelector('[aria-label="Create link (Ctrl+K)"]')).toBeInTheDocument();
      expect(document.querySelector('[aria-label="Inline code format (Ctrl+E)"]')).toBeInTheDocument();
    });
  });

  it("shows source mode but omits diff mode from the mobile overflow menu", async () => {
    mockViewportWidth(320);
    mockMobileMode(true);

    const { findByText } = renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const moreButton = document.querySelector('[aria-label="More actions"]');
    if (!(moreButton instanceof HTMLElement)) {
      throw new Error("Expected More actions button to exist");
    }

    moreButton.click();

    expect(await findByText("Insert code block")).toBeInTheDocument();
    expect(await findByText("Source mode")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Diff mode");

    act(() => {
      mockMdxEditorChangeHandlerRef.current?.("# Mobile source");
    });

    (await findByText("Source mode")).click();

    await waitFor(() => {
      expect(mockSetSourceEditorMarkdown).toHaveBeenCalledWith(normalizeMarkdownTableCellLineBreaks("# Mobile source"));
      expect(mockSetViewMode).toHaveBeenCalledWith("source");
    });
  });

  it("pushes canonical markdown back into the editor before entering source mode from the desktop toggle", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    act(() => {
      mockMdxEditorChangeHandlerRef.current?.("# Published before source mode");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Source mode" }));

    await waitFor(() => {
      expect(mockGetMarkdown).toHaveBeenLastCalledWith("# Published before source mode");
      expect(mockSetSourceEditorMarkdown).toHaveBeenCalledWith(
        normalizeMarkdownTableCellLineBreaks("# Published before source mode")
      );
      expect(mockSetViewMode).toHaveBeenCalledWith("source");
    });
  });

  it("canonicalizes consecutive in-cell line breaks before entering source mode", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const sourceMarkdown = "| A |\n| - |\n| foo&#10;&#xA;bar |";

    act(() => {
      mockMdxEditorChangeHandlerRef.current?.(sourceMarkdown);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Source mode" }));

    await waitFor(() => {
      expect(mockSetSourceEditorMarkdown).toHaveBeenCalledWith(normalizeMarkdownTableCellLineBreaks(sourceMarkdown));
      expect(mockSetViewMode).toHaveBeenCalledWith("source");
    });
  });

  it("strips trailing in-cell line breaks before entering source mode", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const sourceMarkdown = "| A |\n| - |\n| foo&#10;&#xA;<br /> |";

    act(() => {
      mockMdxEditorChangeHandlerRef.current?.(sourceMarkdown);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Source mode" }));

    await waitFor(() => {
      expect(mockSetSourceEditorMarkdown).toHaveBeenCalledWith(normalizeMarkdownTableCellLineBreaks(sourceMarkdown));
      expect(mockSetViewMode).toHaveBeenCalledWith("source");
    });
  });

  it("restores focus after a successful source-mode transition triggered through the toolbar", async () => {
    const ViewModeHarness = () => {
      const [, setRenderTick] = useState(0);

      useEffect(() => {
        mockSetViewMode.mockImplementation((nextViewMode: "rich-text" | "source" | "diff") => {
          mockViewMode = nextViewMode;
          setRenderTick((value) => value + 1);
        });

        return () => {
          mockSetViewMode.mockReset();
        };
      }, []);

      return <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />;
    };

    render(
      <SambeeThemeProvider>
        <ViewModeHarness />
      </SambeeThemeProvider>
    );

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');

    if (!(editorInput instanceof HTMLTextAreaElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    const sourceModeButton = await screen.findByRole("button", { name: "Source mode" });
    sourceModeButton.focus();
    fireEvent.click(sourceModeButton);

    await waitFor(() => {
      expect(mockSetViewMode).toHaveBeenCalledWith("source");
      expect(editorInput).toHaveFocus();
    });
  });

  it("restores the preserved selection when source-mode entry fails", async () => {
    mockGetMarkdown.mockImplementation(() => undefined);

    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');

    if (!(editorInput instanceof HTMLTextAreaElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    editorInput.focus();
    editorInput.setSelectionRange(1, 3);

    fireEvent.click(await screen.findByRole("button", { name: "Source mode" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Canonical markdown export is unavailable");
      expect(editorInput).toHaveFocus();
      expect(editorInput.selectionStart).toBe(1);
      expect(editorInput.selectionEnd).toBe(3);
    });
  });

  it("fails closed when canonical export is unavailable during source-mode entry", async () => {
    mockGetMarkdown.mockImplementation(() => undefined);

    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    fireEvent.click(await screen.findByRole("button", { name: "Source mode" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Canonical markdown export is unavailable");
    });

    expect(mockSetViewMode).not.toHaveBeenCalledWith("source");
  });

  it("routes mobile overflow insert actions through the existing command signals", async () => {
    mockViewportWidth(320);
    mockMobileMode(true);

    const { findByText } = renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const moreButton = document.querySelector('[aria-label="More actions"]');
    if (!(moreButton instanceof HTMLElement)) {
      throw new Error("Expected More actions button to exist");
    }

    moreButton.click();
    (await findByText("Insert code block")).click();

    expect(mockInsertCodeBlock).toHaveBeenCalledWith({});
  });

  it("activates the first search result when a new query has matches", async () => {
    const { rerender } = render(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).toHaveBeenCalledWith("alpha");
      expect(mockSearchState.openSearch).toHaveBeenCalled();
    });

    rerender(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.next).toHaveBeenCalledTimes(1);
    });
  });

  it("closes highlights while retaining the query when the panel closes", async () => {
    const { rerender } = render(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.openSearch).toHaveBeenCalled();
    });

    mockSearchState.closeSearch.mockClear();

    rerender(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={false} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).toHaveBeenLastCalledWith("alpha");
    });

    expect(mockSearchState.closeSearch).toHaveBeenCalledTimes(1);
  });

  it("does not reissue identical search state updates on rerender", async () => {
    mockSearchState.isSearchOpen = true;
    mockSearchState.search = "alpha";

    const { rerender } = render(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).not.toHaveBeenCalled();
      expect(mockSearchState.openSearch).not.toHaveBeenCalled();
    });

    rerender(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).not.toHaveBeenCalled();
      expect(mockSearchState.openSearch).not.toHaveBeenCalled();
    });
  });

  it("does not repeatedly request search activation before the editor state catches up", async () => {
    mockSearchState.openSearch.mockImplementation(() => {
      // Simulate the editor not reflecting isSearchOpen until a later render.
    });
    mockSearchState.setSearch.mockImplementation(() => {
      // Simulate the editor not reflecting the search query until a later render.
    });

    const { rerender } = render(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).toHaveBeenCalledTimes(1);
      expect(mockSearchState.openSearch).toHaveBeenCalledTimes(1);
    });

    rerender(
      <SambeeThemeProvider>
        <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(mockSearchState.setSearch).toHaveBeenCalledTimes(1);
      expect(mockSearchState.openSearch).toHaveBeenCalledTimes(1);
    });
  });

  it("passes native autofocus through to MDXEditor without forcing an immediate rerender", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor", autoFocus: true });

    await waitFor(() => {
      expect(mockMdxEditorAutoFocusHistory).toEqual([true]);
      expect(document.querySelector('textarea[aria-label="Mock editor input"]')).toHaveFocus();
    });
  });

  it("applies the shared markdown content class to the editor surface", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('textarea[aria-label="Mock editor input"]')).toHaveClass("sambee-markdown-editor-content");
    });
  });

  it("captures and restores textarea selection through the editor handle", async () => {
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(
      <SambeeThemeProvider>
        <MarkdownRichEditor ref={editorRef} markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />
      </SambeeThemeProvider>
    );

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');
    const scrollParent = document.querySelector('[data-testid="mock-editor-scroll-parent"]');

    if (!(editorInput instanceof HTMLTextAreaElement) || !(scrollParent instanceof HTMLDivElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    editorInput.focus();
    editorInput.setSelectionRange(2, 4);
    editorInput.scrollTop = 180;
    scrollParent.scrollTop = 90;

    if (!editorRef.current) {
      throw new Error("Expected markdown editor ref handle");
    }

    editorRef.current.preserveSelection();
    editorInput.setSelectionRange(0, 0);
    editorInput.scrollTop = 0;
    scrollParent.scrollTop = 0;

    expect(editorRef.current.restorePreservedSelection()).toBe(true);
    expect(editorInput.selectionStart).toBe(2);
    expect(editorInput.selectionEnd).toBe(4);
    expect(editorInput.scrollTop).toBe(180);
    expect(scrollParent.scrollTop).toBe(90);
  });

  it("restores preserved selection without allowing focus to scroll the editor viewport", async () => {
    const editorRef = createRef<MarkdownRichEditorHandle>();

    render(
      <SambeeThemeProvider>
        <MarkdownRichEditor ref={editorRef} markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />
      </SambeeThemeProvider>
    );

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');

    if (!(editorInput instanceof HTMLTextAreaElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    const focusSpy = vi.spyOn(editorInput, "focus");

    editorInput.focus();
    editorInput.setSelectionRange(1, 3);

    if (!editorRef.current) {
      throw new Error("Expected markdown editor ref handle");
    }

    editorRef.current.preserveSelection();
    editorRef.current.restorePreservedSelection();

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("resolves flushPendingEdits immediately when no nested publication work is pending", async () => {
    const editorRef = createRef<MarkdownRichEditorHandle>();
    const onChange = vi.fn();

    render(
      <SambeeThemeProvider>
        <MarkdownRichEditor ref={editorRef} markdown="# Alpha" onChange={onChange} ariaLabel="Markdown editor" />
      </SambeeThemeProvider>
    );

    if (!editorRef.current) {
      throw new Error("Expected markdown editor ref handle");
    }

    onChange.mockClear();

    await act(async () => {
      await editorRef.current?.flushPendingEdits();
    });

    expect(mockDispatchCommand).not.toHaveBeenCalledWith(mockNestedEditorUpdatedCommand, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns resolved flush promises without dispatching when no nested publication work is pending", async () => {
    const editorRef = createRef<MarkdownRichEditorHandle>();
    const onChange = vi.fn();

    render(
      <SambeeThemeProvider>
        <MarkdownRichEditor ref={editorRef} markdown="# Alpha" onChange={onChange} ariaLabel="Markdown editor" />
      </SambeeThemeProvider>
    );

    if (!editorRef.current) {
      throw new Error("Expected markdown editor ref handle");
    }

    onChange.mockClear();

    const firstFlushPromise = editorRef.current.flushPendingEdits();
    const secondFlushPromise = editorRef.current.flushPendingEdits();

    await act(async () => {
      await firstFlushPromise;
      await secondFlushPromise;
    });

    expect(mockDispatchCommand).not.toHaveBeenCalledWith(mockNestedEditorUpdatedCommand, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("publishes focused nested table-cell edits without an explicit flush and normalizes the reported markdown", async () => {
    const onChange = vi.fn();
    const publishedMarkdown = "| A |\n| - |\n| foo&#10;bar |";

    mockDispatchCommand.mockImplementation((command) => {
      if (command === mockNestedEditorUpdatedCommand) {
        mockMdxEditorChangeHandlerRef.current?.(publishedMarkdown);
      }

      return true;
    });

    renderEditor({ markdown: "# Alpha", onChange, ariaLabel: "Markdown editor" });

    const editorContainer = screen.getByTestId("mock-mdx-editor");

    if (!(editorContainer instanceof HTMLElement)) {
      throw new Error("Expected markdown editor container to exist");
    }

    const table = document.createElement("table");
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const nestedEditable = document.createElement("div");
    nestedEditable.setAttribute("contenteditable", "true");
    nestedEditable.setAttribute("data-lexical-editor", "true");
    cell.append(nestedEditable);
    row.append(cell);
    table.append(row);
    editorContainer.append(table);

    fireEvent.input(nestedEditable);

    await waitFor(() => {
      expect(mockDispatchCommand).toHaveBeenCalledWith(mockNestedEditorUpdatedCommand, undefined);
      expect(onChange).toHaveBeenCalledWith(normalizeMarkdownTableCellLineBreaks(publishedMarkdown));
    });
  });

  it("does not trigger nested publication from nested beforeinput events", async () => {
    const onChange = vi.fn();

    renderEditor({ markdown: "# Alpha", onChange, ariaLabel: "Markdown editor" });
    onChange.mockClear();

    const editorContainer = screen.getByTestId("mock-mdx-editor");

    if (!(editorContainer instanceof HTMLElement)) {
      throw new Error("Expected markdown editor container to exist");
    }

    const nestedEditable = appendNestedTableCellEditable(editorContainer);

    fireEvent(
      nestedEditable,
      new Event("beforeinput", {
        bubbles: true,
        cancelable: true,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDispatchCommand).not.toHaveBeenCalledWith(mockNestedEditorUpdatedCommand, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-publishes the latest nested table-cell markdown when another edit lands during an in-flight flush", async () => {
    const onChange = vi.fn();
    const firstPublishedMarkdown = "| A |\n| - |\n| foo&#10;bar |";
    const secondPublishedMarkdown = "| A |\n| - |\n| foo&#10;bar&#10;baz |";

    renderEditor({ markdown: "# Alpha", onChange, ariaLabel: "Markdown editor" });

    const editorContainer = screen.getByTestId("mock-mdx-editor");

    if (!(editorContainer instanceof HTMLElement)) {
      throw new Error("Expected markdown editor container to exist");
    }

    const nestedEditable = appendNestedTableCellEditable(editorContainer);
    let nestedDispatchCount = 0;

    mockDispatchCommand.mockImplementation((command) => {
      if (command !== mockNestedEditorUpdatedCommand) {
        return true;
      }

      nestedDispatchCount += 1;

      if (nestedDispatchCount === 1) {
        fireEvent.input(nestedEditable);
        mockMdxEditorChangeHandlerRef.current?.(firstPublishedMarkdown);
        return true;
      }

      if (nestedDispatchCount === 2) {
        mockMdxEditorChangeHandlerRef.current?.(secondPublishedMarkdown);
      }

      return true;
    });

    fireEvent.input(nestedEditable);

    await waitFor(() => {
      expect(nestedDispatchCount).toBe(2);
      expect(onChange).toHaveBeenLastCalledWith(normalizeMarkdownTableCellLineBreaks(secondPublishedMarkdown));
    });
  });

  it("does not trigger nested publication for ordinary root editor input", async () => {
    const onChange = vi.fn();

    renderEditor({ markdown: "# Alpha", onChange, ariaLabel: "Markdown editor" });

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');

    if (!(editorInput instanceof HTMLTextAreaElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    fireEvent.input(editorInput, { target: { value: "# Alpha\nBeta" } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("# Alpha\nBeta");
    });

    expect(mockDispatchCommand).not.toHaveBeenCalledWith(mockNestedEditorUpdatedCommand, undefined);
  });

  it("stops autofocus after the editor input is focused so toolbar interactions keep focus", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor", autoFocus: true });

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');
    const toolbarButton = document.querySelector(".mdxeditor-toolbar [data-toolbar-item]");
    const toolbarRoot = document.querySelector(".mdxeditor-toolbar");

    await waitFor(() => {
      expect(editorInput).toHaveFocus();
    });

    if (!(toolbarButton instanceof HTMLElement) || !(toolbarRoot instanceof HTMLElement)) {
      throw new Error("Expected mock toolbar elements to exist");
    }

    toolbarButton.focus();
    toolbarRoot.append(document.createElement("span"));

    await waitFor(() => {
      expect(toolbarButton).toHaveFocus();
    });
  });

  it("restores focus to the editor surface after a view mode change", async () => {
    const ViewModeHarness = () => {
      const [, setRenderTick] = useState(0);

      useEffect(() => {
        mockSetViewMode.mockImplementation((nextViewMode: "rich-text" | "source" | "diff") => {
          mockViewMode = nextViewMode;
          setRenderTick((value) => value + 1);
        });

        return () => {
          mockSetViewMode.mockReset();
        };
      }, []);

      return <MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />;
    };

    render(
      <SambeeThemeProvider>
        <ViewModeHarness />
      </SambeeThemeProvider>
    );

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');
    const toolbarButton = document.querySelector(".mdxeditor-toolbar [data-toolbar-item]");

    if (!(editorInput instanceof HTMLTextAreaElement) || !(toolbarButton instanceof HTMLButtonElement)) {
      throw new Error("Expected mock editor input and toolbar button to exist");
    }

    toolbarButton.focus();

    act(() => {
      mockSetViewMode("source");
    });

    await waitFor(() => {
      expect(editorInput).toHaveFocus();
    });
  });

  it("uses editor tooltip metadata instead of native title attributes", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('[data-editor-tooltip="Bold (Ctrl+B)"]')).toBeInTheDocument();
      expect(document.querySelector(".mdxeditor-toolbar [data-toolbar-item]")).not.toHaveAttribute("title");
    });
  });

  it("renders inline code and code block toolbar buttons with shortcut titles", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('[data-editor-tooltip="Create link (Ctrl+K)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Insert table (Ctrl+Alt+T)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Insert thematic break (Ctrl+Alt+H)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Inline code format (Ctrl+E)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Insert code block (Ctrl+Shift+E)"]')).toBeInTheDocument();
    });
  });

  it("opens the local link dialog and dispatches a link command on submit", async () => {
    const onUserEdit = vi.fn();

    renderEditor({ markdown: "# Alpha", onChange: () => {}, onUserEdit, ariaLabel: "Markdown editor" });

    const createLinkButton = document.querySelector('[data-editor-tooltip="Create link (Ctrl+K)"]');

    if (!(createLinkButton instanceof HTMLButtonElement)) {
      throw new Error("Expected create link button to exist");
    }

    createLinkButton.click();

    const urlInput = await screen.findByRole("textbox", { name: /Link URL/i });
    if (!(urlInput instanceof HTMLInputElement)) {
      throw new Error("Expected link URL input to be an input element");
    }

    urlInput.value = "https://example.com";
    fireEvent.input(urlInput, { target: { value: "https://example.com" } });
    fireEvent.change(urlInput, { target: { value: "https://example.com" } });
    await waitFor(() => {
      expect(urlInput.value).toBe("https://example.com");
    });

    const submitButton = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    submitButton.click();

    await waitFor(() => {
      expect(mockDispatchCommand).toHaveBeenCalledWith(mockToggleLinkCommand, {
        url: "https://example.com",
      });
      expect(onUserEdit).toHaveBeenCalledTimes(1);
    });
  });

  it("restores the previous selection when the link dialog is cancelled", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const editorInput = document.querySelector('textarea[aria-label="Mock editor input"]');
    if (!(editorInput instanceof HTMLTextAreaElement)) {
      throw new Error("Expected mock editor input to exist");
    }

    editorInput.focus();
    editorInput.setSelectionRange(2, 5);

    const createLinkButton = document.querySelector('[data-editor-tooltip="Create link (Ctrl+K)"]');
    if (!(createLinkButton instanceof HTMLButtonElement)) {
      throw new Error("Expected create link button to exist");
    }

    createLinkButton.click();

    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    cancelButton.click();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create link" })).not.toBeInTheDocument();
      expect(editorInput).toHaveFocus();
      expect(editorInput.selectionStart).toBe(2);
      expect(editorInput.selectionEnd).toBe(5);
    });
  });

  it("registers a Ctrl+K handler that opens the local link dialog", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const registerCommandCalls = mockRegisterCommand.mock.calls as unknown[][];
    const keyDownRegistrations = registerCommandCalls.filter((call) => call[0] === KEY_DOWN_COMMAND);
    const candidateHandlers = keyDownRegistrations.map(
      (call) =>
        call[1] as (event: {
          ctrlKey: boolean;
          key: string;
          metaKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => boolean
    );

    const event = {
      ctrlKey: true,
      key: "k",
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const handler = candidateHandlers.find((candidate) => candidate(event) === true);

    if (!handler) {
      throw new Error("Expected a Ctrl+K keydown command registration");
    }

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /Link URL/i })).toBeInTheDocument();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  it("moves ArrowDown and ArrowRight into an adjacent code block via the node selection API", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const rootElement = document.createElement("div");
    const paragraph = document.createElement("p");
    const textNode = document.createTextNode("Alpha");
    paragraph.append(textNode);
    rootElement.append(paragraph);

    const decorator = document.createElement("div");
    decorator.setAttribute("data-lexical-decorator", "true");

    const codeContent = document.createElement("div");
    codeContent.className = "cm-content cm-lineWrapping";
    codeContent.setAttribute("role", "textbox");
    const codeLine = document.createElement("div");
    codeLine.className = "cm-line";
    codeContent.append(codeLine);
    const codeText = document.createTextNode("some text");
    codeLine.append(codeText);
    decorator.append(codeContent);
    rootElement.append(decorator);

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    mockGetRootElement.mockReturnValue(rootElement);

    document.body.append(rootElement);

    const caretRange = document.createRange();
    caretRange.setStart(textNode, textNode.textContent?.length ?? 0);
    caretRange.collapse(true);

    const selectionSpy = vi.spyOn(window, "getSelection");
    selectionSpy.mockReturnValue({
      addRange: vi.fn(),
      anchorNode: textNode,
      getRangeAt: () => caretRange,
      isCollapsed: true,
      removeAllRanges: vi.fn(),
      rangeCount: 1,
    } as Selection);

    const adjacentCodeBlockNode = {
      select: vi.fn(),
    };

    mockGetSelection.mockReturnValue({
      anchor: {
        getNode: () => ({
          getTopLevelElementOrThrow: () => ({
            getNextSibling: () => adjacentCodeBlockNode,
          }),
        }),
      },
      isCollapsed: () => true,
    });
    mockIsRangeSelection.mockReturnValue(true);
    mockGetNearestNodeFromDOMNode.mockReturnValue(adjacentCodeBlockNode);
    mockIsCodeBlockNode.mockImplementation((node: unknown) => node === adjacentCodeBlockNode);
    mockIsTableNode.mockReturnValue(false);

    const registerCommandCalls = mockRegisterCommand.mock.calls as unknown[][];
    const keyDownRegistrations = registerCommandCalls.filter((call) => call[0] === KEY_DOWN_COMMAND);
    const candidateHandlers = keyDownRegistrations.map(
      (call) => call[1] as (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => boolean
    );

    const downEvent = {
      key: "ArrowDown",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const downHandler = candidateHandlers.find((candidate) => candidate(downEvent) === true);

    if (!downHandler) {
      throw new Error("Expected an ArrowDown key handler registration");
    }

    expect(downEvent.preventDefault).toHaveBeenCalled();
    expect(downEvent.stopPropagation).toHaveBeenCalled();
    expect(adjacentCodeBlockNode.select).toHaveBeenCalledTimes(1);

    adjacentCodeBlockNode.select.mockClear();

    const rightEvent = {
      key: "ArrowRight",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const rightHandler = candidateHandlers.find((candidate) => candidate(rightEvent) === true);

    if (!rightHandler) {
      throw new Error("Expected an ArrowRight key handler registration");
    }

    expect(rightEvent.preventDefault).toHaveBeenCalled();
    expect(rightEvent.stopPropagation).toHaveBeenCalled();
    expect(adjacentCodeBlockNode.select).toHaveBeenCalledTimes(1);

    window.requestAnimationFrame = originalRequestAnimationFrame;
    selectionSpy.mockRestore();
    rootElement.remove();
  });

  it("moves ArrowDown and ArrowRight into an adjacent table via the table selection API", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const rootElement = document.createElement("div");
    const paragraph = document.createElement("p");
    const textNode = document.createTextNode("Alpha");
    paragraph.append(textNode);
    rootElement.append(paragraph);

    const decorator = document.createElement("div");
    decorator.setAttribute("data-lexical-decorator", "true");
    decorator.append(document.createElement("table"));
    rootElement.append(decorator);

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    mockGetRootElement.mockReturnValue(rootElement);

    document.body.append(rootElement);

    const caretRange = document.createRange();
    caretRange.setStart(textNode, textNode.textContent?.length ?? 0);
    caretRange.collapse(true);

    const selectionSpy = vi.spyOn(window, "getSelection");
    selectionSpy.mockReturnValue({
      addRange: vi.fn(),
      anchorNode: textNode,
      getRangeAt: () => caretRange,
      isCollapsed: true,
      removeAllRanges: vi.fn(),
      rangeCount: 1,
    } as Selection);

    const adjacentTableNode = {
      getColCount: () => 2,
      getRowCount: () => 3,
      select: vi.fn(),
    };

    mockGetSelection.mockReturnValue({
      anchor: {
        getNode: () => ({
          getTopLevelElementOrThrow: () => ({
            getNextSibling: () => adjacentTableNode,
          }),
        }),
      },
      isCollapsed: () => true,
    });
    mockIsRangeSelection.mockReturnValue(true);
    mockIsCodeBlockNode.mockReturnValue(false);
    mockGetNearestNodeFromDOMNode.mockReturnValue(adjacentTableNode);
    mockIsTableNode.mockImplementation((node: unknown) => node === adjacentTableNode);

    const registerCommandCalls = mockRegisterCommand.mock.calls as unknown[][];
    const keyDownRegistrations = registerCommandCalls.filter((call) => call[0] === KEY_DOWN_COMMAND);
    const candidateHandlers = keyDownRegistrations.map(
      (call) => call[1] as (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => boolean
    );

    const downEvent = {
      key: "ArrowDown",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const downHandler = candidateHandlers.find((candidate) => candidate(downEvent) === true);

    if (!downHandler) {
      throw new Error("Expected an ArrowDown key handler registration");
    }

    expect(downEvent.preventDefault).toHaveBeenCalled();
    expect(downEvent.stopPropagation).toHaveBeenCalled();
    expect(adjacentTableNode.select).toHaveBeenCalledWith([0, 0]);

    adjacentTableNode.select.mockClear();

    const rightEvent = {
      key: "ArrowRight",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const rightHandler = candidateHandlers.find((candidate) => candidate(rightEvent) === true);

    if (!rightHandler) {
      throw new Error("Expected an ArrowRight key handler registration");
    }

    expect(rightEvent.preventDefault).toHaveBeenCalled();
    expect(rightEvent.stopPropagation).toHaveBeenCalled();
    expect(adjacentTableNode.select).toHaveBeenCalledWith([0, 0]);

    window.requestAnimationFrame = originalRequestAnimationFrame;
    selectionSpy.mockRestore();
    rootElement.remove();
  });

  it("registers a default plain-text code block editor for inserted code blocks", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(mockCodeBlockPlugin).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCodeBlockLanguage: "txt",
          codeBlockEditorDescriptors: [
            expect.objectContaining({
              priority: 2,
            }),
          ],
        })
      );
      expect(mockCodeMirrorPlugin).toHaveBeenCalledWith({
        codeBlockLanguages: {
          txt: "Plain text",
          css: "CSS",
          js: "JavaScript",
          jsx: "JavaScript (React)",
          ts: "TypeScript",
          tsx: "TypeScript (React)",
        },
      });
    });
  });

  it("formats undo redo and inline formatting tooltips consistently", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(document.querySelector('[data-editor-tooltip="Undo (Ctrl+Z)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Redo (Ctrl+Y)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Italic (Ctrl+I)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Underline (Ctrl+U)"]')).toBeInTheDocument();
    });
  });

  it("raises the markdown editor popup container above the viewer modal layer", async () => {
    const popupContainer = document.createElement("div");
    popupContainer.className = "mdxeditor-popup-container sambee-markdown-editor-popup";
    document.body.appendChild(popupContainer);

    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor", className: "sambee-markdown-editor" });

    await waitFor(() => {
      expect(popupContainer.style.zIndex).toBe("10000");
    });
  });
});
