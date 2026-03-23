import { render, waitFor } from "@testing-library/react";
import { type ForwardedRef, forwardRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRichEditor from "../MarkdownRichEditor";

const { mockCodeBlockPlugin, mockCodeMirrorPlugin } = vi.hoisted(() => ({
  mockCodeBlockPlugin: vi.fn((params?: unknown) => ({ type: "codeBlockPlugin", params })),
  mockCodeMirrorPlugin: vi.fn((params?: unknown) => ({ type: "codeMirrorPlugin", params })),
}));

const mockApplyFormat = vi.fn();
const mockInsertCodeBlock = vi.fn();
const mockDispatchCommand = vi.fn();
const mockRegisterCommand = vi.fn(() => vi.fn());

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

    return mockApplyFormat;
  },
}));

const mockSearchState = {
  closeSearch: vi.fn(),
  cursor: 0,
  isSearchOpen: true,
  next: vi.fn(),
  openSearch: vi.fn(),
  prev: vi.fn(),
  search: "alpha",
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
        props: { plugins?: Array<{ type?: string; params?: { toolbarContents?: () => unknown } }>; autoFocus?: boolean | object },
        _ref: ForwardedRef<unknown>
      ) => (
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
          <textarea aria-label="Mock editor input" defaultValue="" />
        </div>
      )
    ),
    Separator: passthroughComponent,
    UndoRedo: passthroughComponent,
    diffSourcePlugin: (params?: unknown) => ({ type: "diffSourcePlugin", params }),
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
    useCellValue: () => "rich-text",
    useEditorSearch: () => mockSearchState,
    currentFormat$: Symbol("currentFormat"),
    iconComponentFor$: Symbol("iconComponentFor"),
    insertCodeBlock$: Symbol("insertCodeBlock"),
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
    viewMode$: Symbol("viewMode"),
  };
});

describe("MarkdownRichEditor", () => {
  beforeEach(() => {
    mockApplyFormat.mockReset();
    mockCodeBlockPlugin.mockClear();
    mockCodeMirrorPlugin.mockClear();
    mockInsertCodeBlock.mockReset();
    mockDispatchCommand.mockReset();
    mockRegisterCommand.mockClear();
    mockSearchState.closeSearch.mockReset();
    mockSearchState.next.mockReset();
    mockSearchState.openSearch.mockReset();
    mockSearchState.prev.mockReset();
    mockSearchState.setSearch.mockReset();
    mockSearchState.cursor = 0;
    mockSearchState.isSearchOpen = true;
    mockSearchState.search = "alpha";
    mockSearchState.total = 2;
  });

  it("activates the first search result when a new query has matches", async () => {
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" searchText="alpha" searchOpen={true} />);

    await waitFor(() => {
      expect(mockSearchState.setSearch).toHaveBeenCalledWith("alpha");
      expect(mockSearchState.openSearch).toHaveBeenCalled();
      expect(mockSearchState.next).toHaveBeenCalledTimes(1);
    });
  });

  it("passes native autofocus through to MDXEditor when requested", async () => {
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" autoFocus={true} />);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="mock-mdx-editor-autofocus"]')).toHaveTextContent("true");
    });
  });

  it("stops autofocus after the editor input is focused so toolbar interactions keep focus", async () => {
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" autoFocus={true} />);

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
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />);

    await waitFor(() => {
      expect(document.querySelector('[data-editor-tooltip="Bold (Ctrl+B)"]')).toBeInTheDocument();
      expect(document.querySelector(".mdxeditor-toolbar [data-toolbar-item]")).not.toHaveAttribute("title");
    });
  });

  it("renders inline code and code block toolbar buttons with shortcut titles", async () => {
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />);

    await waitFor(() => {
      expect(document.querySelector('[data-editor-tooltip="Inline code format (Ctrl+E)"]')).toBeInTheDocument();
      expect(document.querySelector('[data-editor-tooltip="Insert code block (Ctrl+Shift+E)"]')).toBeInTheDocument();
    });
  });

  it("registers a default plain-text code block editor for inserted code blocks", async () => {
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />);

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
    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" />);

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

    render(<MarkdownRichEditor markdown="# Alpha" onChange={() => {}} ariaLabel="Markdown editor" className="sambee-markdown-editor" />);

    await waitFor(() => {
      expect(popupContainer.style.zIndex).toBe("10000");
    });
  });
});
