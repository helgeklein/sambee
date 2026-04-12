import {
  activeEditor$,
  applyFormat$,
  BlockTypeSelect,
  ButtonWithTooltip,
  codeBlockPlugin,
  codeMirrorPlugin,
  currentFormat$,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  editorInTable$,
  headingsPlugin,
  IS_APPLE,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_UNDERLINE,
  iconComponentFor$,
  insertCodeBlock$,
  insertTable$,
  insertThematicBreak$,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  MultipleChoiceToggleGroup,
  markdownShortcutPlugin,
  openLinkEditDialog$,
  quotePlugin,
  Separator,
  searchPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCellValue,
  useEditorSearch,
  viewMode$,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { mergeRegister } from "@lexical/utils";
import { useCellValues, useCellValue as useGurxCellValue, usePublisher } from "@mdxeditor/gurx";
import { Box } from "@mui/material";
import {
  $createNodeSelection,
  $createRangeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
  type NodeKey,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MARKDOWN_EDITOR_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { useSambeeTheme } from "../../theme";
import { Z_INDEX } from "../../theme/constants";
import { getMarkdownEditorContentStyles, getViewerColors } from "../../theme/viewerStyles";
import { scheduleRetriableFocusRestore } from "./focusRestoration";
import { MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS } from "./markdownEditorConstants";

const MARKDOWN_EDITOR_POPUP_CLASS = "sambee-markdown-editor-popup";
const MARKDOWN_EDITOR_POPUP_Z_INDEX = Z_INDEX.VIEWER_TOOLBAR + 1;
const MARKDOWN_EDITOR_CONTENT_CLASS = "sambee-markdown-editor-content";
const MARKDOWN_CODE_BLOCK_DEFAULT_LANGUAGE = "txt";
const MARKDOWN_CODE_BLOCK_LANGUAGES = {
  txt: "Plain text",
  css: "CSS",
  js: "JavaScript",
  jsx: "JavaScript (React)",
  ts: "TypeScript",
  tsx: "TypeScript (React)",
} as const;

export interface MarkdownRichEditorHandle {
  focus: () => void;
  preserveSelection: () => void;
  restorePreservedSelection: () => boolean;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

interface MarkdownRichEditorViewportAnchor {
  element: HTMLElement;
  scrollTop: number;
  scrollLeft: number;
}

interface MarkdownRichEditorViewportSnapshot {
  anchors: MarkdownRichEditorViewportAnchor[];
}

type MarkdownRichEditorSelectionSnapshot =
  | {
      type: "textarea";
      start: number;
      end: number;
      direction: "forward" | "backward" | "none";
      viewport: MarkdownRichEditorViewportSnapshot;
    }
  | {
      type: "lexical-range";
      anchor: {
        key: NodeKey;
        offset: number;
        type: "text" | "element";
      };
      focus: {
        key: NodeKey;
        offset: number;
        type: "text" | "element";
      };
      format: number;
      style: string;
      viewport: MarkdownRichEditorViewportSnapshot;
    }
  | {
      type: "lexical-node";
      keys: NodeKey[];
      viewport: MarkdownRichEditorViewportSnapshot;
    };

export interface MarkdownRichEditorSearchState {
  searchText: string;
  searchMatches: number;
  currentMatch: number;
  isSearchOpen: boolean;
  isSearchable: boolean;
  viewMode: "rich-text" | "source" | "diff";
}

export interface MarkdownRichEditorProps {
  markdown: string;
  diffMarkdown?: string;
  onChange: (markdown: string) => void;
  onUserEdit?: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  searchText?: string;
  searchOpen?: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
}

interface MarkdownRichEditorSearchCommands {
  nextSearchResult: () => void;
  previousSearchResult: () => void;
}

interface MarkdownRichEditorCommands {
  createLink: () => void;
  insertTable: () => void;
  insertThematicBreak: () => void;
  toggleInlineCode: () => void;
  insertCodeBlock: () => void;
}

interface MarkdownRichEditorSearchBridgeProps {
  searchText: string;
  searchOpen: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
  onCommandsChange: (commands: MarkdownRichEditorSearchCommands | null) => void;
}

const NOOP_SEARCH_COMMANDS: MarkdownRichEditorSearchCommands = {
  nextSearchResult: () => {},
  previousSearchResult: () => {},
};

const NOOP_EDITOR_COMMANDS: MarkdownRichEditorCommands = {
  createLink: () => {},
  insertTable: () => {},
  insertThematicBreak: () => {},
  toggleInlineCode: () => {},
  insertCodeBlock: () => {},
};

const MarkdownActiveEditorBridge = ({ onActiveEditorChange }: { onActiveEditorChange: (editor: LexicalEditor | null) => void }) => {
  const activeEditor = useCellValue(activeEditor$);

  useEffect(() => {
    onActiveEditorChange(activeEditor);

    return () => {
      onActiveEditorChange(null);
    };
  }, [activeEditor, onActiveEditorChange]);

  return null;
};

const MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS = {
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  underline: "Ctrl+U",
  undo: IS_APPLE ? "Cmd+Z" : "Ctrl+Z",
  redo: IS_APPLE ? "Cmd+Y" : "Ctrl+Y",
} as const;

function formatEditorTooltip(label: string, shortcutLabel?: string): string {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

const MarkdownRichEditorCommandBridge = ({
  onCommandsChange,
}: {
  onCommandsChange: (commands: MarkdownRichEditorCommands | null) => void;
}) => {
  const applyFormat = usePublisher(applyFormat$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertTable = usePublisher(insertTable$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);

  useEffect(() => {
    onCommandsChange({
      createLink: () => {
        openLinkDialog();
      },
      insertTable: () => {
        insertTable({ rows: 3, columns: 3 });
      },
      insertThematicBreak: () => {
        insertThematicBreak();
      },
      toggleInlineCode: () => {
        applyFormat("code");
      },
      insertCodeBlock: () => {
        insertCodeBlock({});
      },
    });

    return () => {
      onCommandsChange(null);
    };
  }, [applyFormat, insertCodeBlock, insertTable, insertThematicBreak, onCommandsChange, openLinkDialog]);

  return null;
};

interface MarkdownFormattingToggleDefinition {
  format: number;
  formatName: "bold" | "italic" | "underline";
  icon: string;
  shortcutLabel: string;
  addLabel: string;
  removeLabel: string;
}

const MarkdownInlineFormattingToggles = () => {
  const { t } = useTranslation();
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const toggleDefinitions: MarkdownFormattingToggleDefinition[] = [
    {
      format: IS_BOLD,
      formatName: "bold",
      icon: "format_bold",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.bold,
      addLabel: t("viewer.edit.bold", { defaultValue: "Bold" }),
      removeLabel: t("viewer.edit.removeBold", { defaultValue: "Remove bold" }),
    },
    {
      format: IS_ITALIC,
      formatName: "italic",
      icon: "format_italic",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.italic,
      addLabel: t("viewer.edit.italic", { defaultValue: "Italic" }),
      removeLabel: t("viewer.edit.removeItalic", { defaultValue: "Remove italic" }),
    },
    {
      format: IS_UNDERLINE,
      formatName: "underline",
      icon: "format_underlined",
      shortcutLabel: MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.underline,
      addLabel: t("viewer.edit.underline", { defaultValue: "Underline" }),
      removeLabel: t("viewer.edit.removeUnderline", { defaultValue: "Remove underline" }),
    },
  ];

  return (
    <MultipleChoiceToggleGroup
      items={toggleDefinitions.map(({ addLabel, format, formatName, icon, removeLabel, shortcutLabel }) => {
        const active = (currentFormat & format) !== 0;

        return {
          title: formatEditorTooltip(active ? removeLabel : addLabel, shortcutLabel),
          contents: iconComponentFor(icon),
          active,
          onChange: () => {
            applyFormat(formatName);
          },
        };
      })}
    />
  );
};

const MarkdownUndoRedoControls = () => {
  const { t } = useTranslation();
  const [iconComponentFor, activeEditor] = useCellValues(iconComponentFor$, activeEditor$);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!activeEditor) {
      return;
    }

    return mergeRegister(
      activeEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      activeEditor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }, [activeEditor]);

  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title: formatEditorTooltip(t("viewer.edit.undo", { defaultValue: "Undo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.undo),
          disabled: !canUndo,
          contents: iconComponentFor("undo"),
          active: false,
          onChange: () => {
            activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
          },
        },
        {
          title: formatEditorTooltip(t("viewer.edit.redo", { defaultValue: "Redo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.redo),
          disabled: !canRedo,
          contents: iconComponentFor("redo"),
          active: false,
          onChange: () => {
            activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
          },
        },
      ]}
    />
  );
};

const InlineCodeToggle = () => {
  const { t } = useTranslation();
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const codeIsOn = (currentFormat & IS_CODE) !== 0;
  const label = codeIsOn
    ? t("viewer.edit.removeInlineCode", { defaultValue: "Remove code format" })
    : t("viewer.edit.inlineCode", { defaultValue: "Inline code format" });
  const title = formatEditorTooltip(label, MARKDOWN_EDITOR_SHORTCUTS.INLINE_CODE.label);

  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title,
          contents: iconComponentFor("code"),
          active: codeIsOn,
          onChange: () => {
            applyFormat("code");
          },
        },
      ]}
    />
  );
};

const InsertCodeBlockButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CODE_BLOCK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertCodeBlock({});
      }}
    >
      {iconComponentFor("frame_source")}
    </ButtonWithTooltip>
  );
};

const CreateLinkButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CREATE_LINK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        openLinkDialog();
      }}
    >
      {iconComponentFor("link")}
    </ButtonWithTooltip>
  );
};

const InsertTableButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertTable = usePublisher(insertTable$);
  const isDisabled = useCellValue(editorInTable$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.INSERT_TABLE);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertTable({ rows: 3, columns: 3 });
      }}
      {...(isDisabled ? { "aria-disabled": true, "data-disabled": true, disabled: true } : {})}
    >
      {iconComponentFor("table")}
    </ButtonWithTooltip>
  );
};

const InsertThematicBreakButton = () => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.INSERT_THEMATIC_BREAK);

  return (
    <ButtonWithTooltip
      title={title}
      aria-label={title}
      onClick={() => {
        insertThematicBreak();
      }}
    >
      {iconComponentFor("horizontal_rule")}
    </ButtonWithTooltip>
  );
};

const MarkdownRichEditorSearchBridge = ({
  searchText,
  searchOpen,
  onSearchStateChange,
  onCommandsChange,
}: MarkdownRichEditorSearchBridgeProps) => {
  const { closeSearch, cursor, isSearchOpen, next, openSearch, prev, search, setSearch, total } = useEditorSearch();
  const viewMode = useCellValue(viewMode$);
  const isSearchable = viewMode === "rich-text";

  useEffect(() => {
    onCommandsChange(isSearchable ? { nextSearchResult: next, previousSearchResult: prev } : NOOP_SEARCH_COMMANDS);

    return () => {
      onCommandsChange(null);
    };
  }, [isSearchable, next, onCommandsChange, prev]);

  useEffect(() => {
    if (!isSearchable) {
      closeSearch();
      setSearch(null);
      return;
    }

    setSearch(searchText || null);
  }, [closeSearch, isSearchable, searchText, setSearch]);

  useEffect(() => {
    if (!isSearchable) {
      return;
    }

    if (searchOpen) {
      openSearch();
      return;
    }

    closeSearch();
  }, [closeSearch, isSearchable, openSearch, searchOpen]);

  useEffect(() => {
    if (!isSearchable || !searchOpen || !search.trim() || total === 0 || cursor !== 0) {
      return;
    }

    next();
  }, [cursor, isSearchable, next, search, searchOpen, total]);

  useEffect(() => {
    onSearchStateChange?.({
      searchText: search,
      searchMatches: total,
      currentMatch: total > 0 ? Math.max(cursor, 1) : 0,
      isSearchOpen,
      isSearchable,
      viewMode,
    });
  }, [cursor, isSearchOpen, isSearchable, onSearchStateChange, search, total, viewMode]);

  return null;
};

const MarkdownRichEditor = forwardRef<MarkdownRichEditorHandle, MarkdownRichEditorProps>(
  (
    {
      markdown,
      diffMarkdown = markdown,
      onChange,
      onUserEdit,
      ariaLabel,
      autoFocus = false,
      readOnly = false,
      className,
      searchText = "",
      searchOpen = false,
      onSearchStateChange,
    },
    ref
  ) => {
    const editorRef = useRef<MDXEditorMethods>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const activeEditorRef = useRef<LexicalEditor | null>(null);
    const preservedSelectionRef = useRef<MarkdownRichEditorSelectionSnapshot | null>(null);
    const searchCommandsRef = useRef<MarkdownRichEditorSearchCommands>(NOOP_SEARCH_COMMANDS);
    const commandsRef = useRef<MarkdownRichEditorCommands>(NOOP_EDITOR_COMMANDS);
    const [shouldAutoFocus, setShouldAutoFocus] = useState(autoFocus);
    const { currentTheme } = useSambeeTheme();
    const { viewerText, linkColor, linkHoverColor } = getViewerColors(currentTheme, "markdown");
    const editorRootClassName = [className, MARKDOWN_EDITOR_POPUP_CLASS].filter(Boolean).join(" ");

    const syncPopupContainerLayering = useCallback(() => {
      const popupContainers = document.querySelectorAll<HTMLElement>(`.mdxeditor-popup-container.${MARKDOWN_EDITOR_POPUP_CLASS}`);

      popupContainers.forEach((popupContainer) => {
        const zIndex = String(MARKDOWN_EDITOR_POPUP_Z_INDEX);
        if (popupContainer.style.zIndex !== zIndex) {
          popupContainer.style.zIndex = zIndex;
        }
      });
    }, []);

    const focusEditableArea = useCallback((preventScroll = false) => {
      const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');

      if (!(editable instanceof HTMLElement)) {
        return false;
      }

      editable.focus({ preventScroll });
      return document.activeElement === editable;
    }, []);

    const captureViewport = useCallback((editable: HTMLElement): MarkdownRichEditorViewportSnapshot => {
      const anchors: MarkdownRichEditorViewportAnchor[] = [];
      let element: HTMLElement | null = editable;

      while (element) {
        if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
          anchors.push({
            element,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft,
          });
        }

        element = element.parentElement;
      }

      return { anchors };
    }, []);

    const restoreViewport = useCallback((viewport: MarkdownRichEditorViewportSnapshot) => {
      const applyViewport = () => {
        for (const anchor of [...viewport.anchors].reverse()) {
          if (!anchor.element.isConnected) {
            continue;
          }

          anchor.element.scrollTop = anchor.scrollTop;
          anchor.element.scrollLeft = anchor.scrollLeft;
        }
      };

      applyViewport();
      requestAnimationFrame(applyViewport);
    }, []);

    const captureSelection = useCallback((): MarkdownRichEditorSelectionSnapshot | null => {
      const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');

      if (editable instanceof HTMLTextAreaElement) {
        return {
          type: "textarea",
          start: editable.selectionStart ?? 0,
          end: editable.selectionEnd ?? 0,
          direction: editable.selectionDirection ?? "none",
          viewport: captureViewport(editable),
        };
      }

      if (!(editable instanceof HTMLElement)) {
        return null;
      }

      const activeEditor = activeEditorRef.current;

      if (!activeEditor) {
        return null;
      }

      return activeEditor.getEditorState().read(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          return {
            type: "lexical-range",
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
            format: selection.format,
            style: selection.style,
            viewport: captureViewport(editable),
          };
        }

        if ($isNodeSelection(selection)) {
          return {
            type: "lexical-node",
            keys: selection.getNodes().map((node) => node.getKey()),
            viewport: captureViewport(editable),
          };
        }

        return null;
      });
    }, [captureViewport]);

    const restoreSelection = useCallback(
      (selectionSnapshot: MarkdownRichEditorSelectionSnapshot | null): boolean => {
        if (!selectionSnapshot) {
          return focusEditableArea();
        }

        const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');

        if (selectionSnapshot.type === "textarea") {
          if (!(editable instanceof HTMLTextAreaElement)) {
            return focusEditableArea();
          }

          editable.focus({ preventScroll: true });
          editable.setSelectionRange(selectionSnapshot.start, selectionSnapshot.end, selectionSnapshot.direction);
          restoreViewport(selectionSnapshot.viewport);
          return document.activeElement === editable;
        }

        const activeEditor = activeEditorRef.current;

        if (!(editable instanceof HTMLElement) || !activeEditor) {
          return focusEditableArea();
        }

        let restored = false;

        editable.focus({ preventScroll: true });
        activeEditor.update(
          () => {
            if (selectionSnapshot.type === "lexical-range") {
              if (!$getNodeByKey(selectionSnapshot.anchor.key) || !$getNodeByKey(selectionSnapshot.focus.key)) {
                return;
              }

              const rangeSelection = $createRangeSelection();
              rangeSelection.anchor.set(selectionSnapshot.anchor.key, selectionSnapshot.anchor.offset, selectionSnapshot.anchor.type);
              rangeSelection.focus.set(selectionSnapshot.focus.key, selectionSnapshot.focus.offset, selectionSnapshot.focus.type);
              rangeSelection.format = selectionSnapshot.format;
              rangeSelection.style = selectionSnapshot.style;
              $setSelection(rangeSelection);
              restored = true;
              return;
            }

            const restoredNodeKeys = selectionSnapshot.keys.filter((key) => $getNodeByKey(key) !== null);

            if (restoredNodeKeys.length === 0) {
              return;
            }

            const nodeSelection = $createNodeSelection();

            for (const key of restoredNodeKeys) {
              nodeSelection.add(key);
            }

            $setSelection(nodeSelection);
            restored = true;
          },
          { discrete: true }
        );

        if (restored) {
          restoreViewport(selectionSnapshot.viewport);
        }

        return restored || focusEditableArea();
      },
      [focusEditableArea, restoreViewport]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
          requestAnimationFrame(() => {
            focusEditableArea();
          });
        },
        preserveSelection: () => {
          preservedSelectionRef.current = captureSelection();
        },
        restorePreservedSelection: () => {
          const restored = restoreSelection(preservedSelectionRef.current);

          if (restored) {
            preservedSelectionRef.current = null;
          }

          return restored;
        },
        nextSearchResult: () => {
          searchCommandsRef.current.nextSearchResult();
        },
        previousSearchResult: () => {
          searchCommandsRef.current.previousSearchResult();
        },
        createLink: () => {
          commandsRef.current.createLink();
        },
        insertTable: () => {
          commandsRef.current.insertTable();
        },
        insertThematicBreak: () => {
          commandsRef.current.insertThematicBreak();
        },
        toggleInlineCode: () => {
          commandsRef.current.toggleInlineCode();
        },
        insertCodeBlock: () => {
          commandsRef.current.insertCodeBlock();
        },
      }),
      [captureSelection, focusEditableArea, restoreSelection]
    );

    useEffect(() => {
      syncPopupContainerLayering();

      const observer = new MutationObserver(() => {
        syncPopupContainerLayering();
      });

      observer.observe(document.body, { childList: true, subtree: true });

      return () => {
        observer.disconnect();
      };
    }, [syncPopupContainerLayering]);

    useEffect(() => {
      if (!shouldAutoFocus || readOnly) {
        return;
      }

      setShouldAutoFocus(false);

      let autofocusComplete = false;
      let cleanupRetryFocus: (() => void) | null = null;
      const interactionRoot = containerRef.current;

      const handleFocusIn = (event: FocusEvent) => {
        const target = event.target;

        if (target instanceof HTMLElement && target.matches('[contenteditable="true"], textarea')) {
          stopAutoFocus();
        }
      };

      const observer = new MutationObserver(() => {
        attemptFocus();
      });

      const stopAutoFocus = () => {
        if (autofocusComplete) {
          return;
        }

        autofocusComplete = true;
        observer.disconnect();
        interactionRoot?.removeEventListener("focusin", handleFocusIn);
        cleanupRetryFocus?.();
      };

      const attemptFocus = () => {
        if (autofocusComplete) {
          return;
        }

        if (focusEditableArea()) {
          stopAutoFocus();
        }
      };

      cleanupRetryFocus = scheduleRetriableFocusRestore({
        delaysMs: MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS,
        attemptRestore: () => {
          attemptFocus();
          return autofocusComplete;
        },
      });

      if (interactionRoot) {
        interactionRoot.addEventListener("focusin", handleFocusIn);
        observer.observe(interactionRoot, { childList: true, subtree: true });
      }

      return () => {
        stopAutoFocus();
      };
    }, [focusEditableArea, readOnly, shouldAutoFocus]);

    useEffect(() => {
      if (readOnly || !onUserEdit) {
        return;
      }

      const interactionRoot = containerRef.current;

      if (!interactionRoot) {
        return;
      }

      const handleUserEdit = () => {
        onUserEdit();
      };

      const eventNames = ["beforeinput", "input", "paste", "cut", "drop"];
      for (const eventName of eventNames) {
        interactionRoot.addEventListener(eventName, handleUserEdit);
      }

      return () => {
        for (const eventName of eventNames) {
          interactionRoot.removeEventListener(eventName, handleUserEdit);
        }
      };
    }, [onUserEdit, readOnly]);

    useEffect(() => {
      const currentMarkdown = editorRef.current?.getMarkdown();
      if (editorRef.current && currentMarkdown !== markdown) {
        editorRef.current.setMarkdown(markdown);
      }
    }, [markdown]);

    useEffect(() => {
      const editable = containerRef.current?.querySelector('[contenteditable="true"]');
      if (editable instanceof HTMLElement) {
        editable.setAttribute("aria-label", ariaLabel);
      }
    }, [ariaLabel]);

    const plugins = useMemo(
      () => [
        headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: MARKDOWN_CODE_BLOCK_DEFAULT_LANGUAGE }),
        codeMirrorPlugin({ codeBlockLanguages: MARKDOWN_CODE_BLOCK_LANGUAGES }),
        linkPlugin(),
        linkDialogPlugin(),
        markdownShortcutPlugin(),
        searchPlugin(),
        diffSourcePlugin({ viewMode: "rich-text", diffMarkdown }),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <MarkdownRichEditorSearchBridge
                searchText={searchText}
                searchOpen={searchOpen}
                onSearchStateChange={onSearchStateChange}
                onCommandsChange={(commands) => {
                  searchCommandsRef.current = commands ?? NOOP_SEARCH_COMMANDS;
                }}
              />
              <MarkdownActiveEditorBridge
                onActiveEditorChange={(editor) => {
                  activeEditorRef.current = editor;
                }}
              />
              <MarkdownRichEditorCommandBridge
                onCommandsChange={(commands) => {
                  commandsRef.current = commands ?? NOOP_EDITOR_COMMANDS;
                }}
              />
              <DiffSourceToggleWrapper>
                <MarkdownUndoRedoControls />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <MarkdownInlineFormattingToggles />
                <InlineCodeToggle />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLinkButton />
                <InsertTableButton />
                <InsertThematicBreakButton />
                <Separator />
                <InsertCodeBlockButton />
              </DiffSourceToggleWrapper>
            </>
          ),
        }),
      ],
      [diffMarkdown, onSearchStateChange, searchOpen, searchText]
    );

    return (
      <Box
        ref={containerRef}
        className={className}
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          "& .mdxeditor": {
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            overflow: "hidden",
          },
          "& .mdxeditor-toolbar": {
            position: "relative",
            top: "auto",
            width: "auto",
            flexShrink: 0,
            overflowX: "auto",
            overflowY: "hidden",
          },
          "& .mdxeditor > :not(.mdxeditor-toolbar)": {
            minHeight: 0,
          },
          "& [contenteditable='true']": {
            minHeight: 320,
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
          },
          "& .cm-sourceView, & .cm-mergeView": {
            minHeight: 0,
            height: "100%",
          },
          "& .cm-editor": {
            minHeight: 0,
            height: "100%",
          },
          [`& .${MARKDOWN_EDITOR_CONTENT_CLASS}`]: getMarkdownEditorContentStyles(viewerText, linkColor, linkHoverColor),
        }}
      >
        <MDXEditor
          ref={editorRef}
          className={editorRootClassName}
          contentEditableClassName={MARKDOWN_EDITOR_CONTENT_CLASS}
          markdown={markdown}
          onChange={onChange}
          autoFocus={shouldAutoFocus ? { defaultSelection: "rootStart", preventScroll: true } : false}
          readOnly={readOnly}
          plugins={plugins}
        />
      </Box>
    );
  }
);

MarkdownRichEditor.displayName = "MarkdownRichEditor";

export default MarkdownRichEditor;
