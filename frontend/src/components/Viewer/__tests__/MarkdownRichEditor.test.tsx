import { render, waitFor } from "@testing-library/react";
import { type ComponentProps, createRef, type ForwardedRef, forwardRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import MarkdownRichEditor from "../MarkdownRichEditor";

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

const { mockCodeBlockPlugin, mockCodeMirrorPlugin, mockMdxEditorAutoFocusHistory } = vi.hoisted(() => ({
  mockCodeBlockPlugin: vi.fn((params?: unknown) => ({ type: "codeBlockPlugin", params })),
  mockCodeMirrorPlugin: vi.fn((params?: unknown) => ({ type: "codeMirrorPlugin", params })),
  mockMdxEditorAutoFocusHistory: [] as boolean[],
}));

const mockApplyFormat = vi.fn();
const mockLexicalFocus = vi.fn((callback?: () => void) => {
  callback?.();
});
const mockLexicalUpdate = vi.fn((updateFn: () => void) => {
  updateFn();
});
const mockLexicalRead = vi.fn(<T,>(callback: () => T) => callback());
const mockCreateLink = vi.fn();
const mockInsertCodeBlock = vi.fn();
const mockInsertTable = vi.fn();
const mockInsertThematicBreak = vi.fn();
const mockApplyBlockType = vi.fn();
const mockApplyListType = vi.fn();
const mockDispatchCommand = vi.fn();
const mockRegisterCommand = vi.fn(() => vi.fn());
const mockSetViewMode = vi.fn();
let mockCurrentBlockType: "paragraph" | "quote" | "h1" | "h2" | "h3" = "paragraph";
let mockCurrentListType: "" | "bullet" | "number" | "check" = "";
let mockViewMode: "rich-text" | "source" | "diff" = "rich-text";

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
    if (String(signal).includes("openLinkEditDialog")) {
      return mockCreateLink;
    }

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
  const passthroughComponent = ({ children }: { children?: unknown }) => <>{children}</>;

  return {
    BlockTypeSelect: passthroughComponent,
    BoldItalicUnderlineToggles: passthroughComponent,
    CreateLink: passthroughComponent,
    DiffSourceToggleWrapper: passthroughComponent,
    InsertTable: passthroughComponent,
    InsertThematicBreak: passthroughComponent,
    ListsToggle: passthroughComponent,
    MDXEditor: forwardRef(
      (
        props: {
          plugins?: Array<{ type?: string; params?: { toolbarContents?: () => unknown } }>;
          autoFocus?: boolean | object;
          contentEditableClassName?: string;
          markdown?: string;
        },
        _ref: ForwardedRef<unknown>
      ) => {
        mockMdxEditorAutoFocusHistory.push(Boolean(props.autoFocus));

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
                defaultValue={props.markdown ?? ""}
                ref={(element) => {
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
    linkDialogPlugin: () => ({ type: "linkDialogPlugin" }),
    linkPlugin: () => ({ type: "linkPlugin" }),
    listsPlugin: () => ({ type: "listsPlugin" }),
    markdownShortcutPlugin: () => ({ type: "markdownShortcutPlugin" }),
    quotePlugin: () => ({ type: "quotePlugin" }),
    searchPlugin: () => ({ type: "searchPlugin" }),
    codeBlockPlugin: mockCodeBlockPlugin,
    codeMirrorPlugin: mockCodeMirrorPlugin,
    tablePlugin: () => ({ type: "tablePlugin" }),
    thematicBreakPlugin: () => ({ type: "thematicBreakPlugin" }),
    toolbarPlugin: (params: { toolbarContents: () => unknown }) => ({ type: "toolbarPlugin", params }),
    activeEditor$: Symbol("activeEditor"),
    applyFormat$: Symbol("applyFormat"),
    ButtonWithTooltip: ({ title, children, ...props }: { title: string; children?: unknown; [key: string]: unknown }) => (
      <button type="button" data-toolbar-item data-editor-tooltip={title} aria-label={String(props["aria-label"] ?? title)}>
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
        return {
          focus: mockLexicalFocus,
          getEditorState: () => ({ read: mockLexicalRead }),
          update: mockLexicalUpdate,
        };
      }

      return "rich-text";
    },
    useEditorSearch: () => mockSearchState,
    currentFormat$: Symbol("currentFormat"),
    MDX_FOCUS_SEARCH_NAME: "MdxFocusSearch",
    MDX_SEARCH_NAME: "MdxSearch",
    iconComponentFor$: Symbol("iconComponentFor"),
    insertCodeBlock$: Symbol("insertCodeBlock"),
    insertTable$: Symbol("insertTable"),
    insertThematicBreak$: Symbol("insertThematicBreak"),
    IS_APPLE: false,
    IS_BOLD: 1,
    IS_CODE: 16,
    IS_ITALIC: 2,
    IS_UNDERLINE: 8,
    MultipleChoiceToggleGroup: ({ items }: { items: Array<{ title: string; contents: unknown }> }) => (
      <div className="mdxeditor-toolbar-mock-group">
        {items.map((item) => (
          <button key={item.title} type="button" data-toolbar-item data-editor-tooltip={item.title} aria-label={item.title}>
            {item.contents}
          </button>
        ))}
      </div>
    ),
    rangeSearchScan: vi.fn(),
    realmPlugin: (plugin: unknown) => () => ({ type: "searchPlugin", plugin }),
    viewMode$: Symbol("viewMode"),
    openLinkEditDialog$: Symbol("openLinkEditDialog"),
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

  beforeEach(() => {
    mockViewportWidth(1280);
    mockMobileMode(false);
    mockApplyFormat.mockReset();
    mockApplyBlockType.mockReset();
    mockApplyListType.mockReset();
    mockLexicalFocus.mockClear();
    mockLexicalRead.mockClear();
    mockLexicalUpdate.mockClear();
    mockCreateLink.mockReset();
    mockCodeBlockPlugin.mockClear();
    mockCodeMirrorPlugin.mockClear();
    mockMdxEditorAutoFocusHistory.length = 0;
    mockInsertCodeBlock.mockReset();
    mockInsertTable.mockReset();
    mockInsertThematicBreak.mockReset();
    mockDispatchCommand.mockReset();
    mockRegisterCommand.mockClear();
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

  it("opens mobile overflow actions and routes mode changes through the view mode signal", async () => {
    mockViewportWidth(320);
    mockMobileMode(true);

    const { findByText } = renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    const moreButton = document.querySelector('[aria-label="More actions"]');
    if (!(moreButton instanceof HTMLElement)) {
      throw new Error("Expected More actions button to exist");
    }

    moreButton.click();

    expect(await findByText("Source mode")).toBeInTheDocument();
    expect(await findByText("Insert code block")).toBeInTheDocument();

    (await findByText("Source mode")).click();

    expect(mockSetViewMode).toHaveBeenCalledWith("source");
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

  it("uses effect-driven autofocus without remounting MDXEditor to disable native autofocus", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor", autoFocus: true });

    await waitFor(() => {
      expect(mockMdxEditorAutoFocusHistory).toEqual([false]);
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
    const editorRef = createRef<{
      preserveSelection: () => void;
      restorePreservedSelection: () => boolean;
    }>();

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
    const editorRef = createRef<{
      preserveSelection: () => void;
      restorePreservedSelection: () => boolean;
    }>();

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

  it("registers a default plain-text code block editor for inserted code blocks", async () => {
    renderEditor({ markdown: "# Alpha", onChange: () => {}, ariaLabel: "Markdown editor" });

    await waitFor(() => {
      expect(mockCodeBlockPlugin).toHaveBeenCalledWith({ defaultCodeBlockLanguage: "txt" });
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
