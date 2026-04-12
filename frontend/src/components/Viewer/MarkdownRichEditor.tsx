import {
  activeEditor$,
  applyBlockType$,
  applyFormat$,
  applyListType$,
  BlockTypeSelect,
  ButtonWithTooltip,
  codeBlockPlugin,
  codeMirrorPlugin,
  currentBlockType$,
  currentFormat$,
  currentListType$,
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
import { Box, GlobalStyles, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, useMediaQuery, useTheme } from "@mui/material";
import {
  $createNodeSelection,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
  type NodeKey,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { forwardRef, type ReactNode, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MARKDOWN_EDITOR_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { useSambeeTheme } from "../../theme";
import {
  getSecondaryActionStripStyle,
  getSecondaryToolbarSelectedBackground,
  getSecondaryToolbarSurfaceColors,
} from "../../theme/commonStyles";
import { Z_INDEX } from "../../theme/constants";
import { getMarkdownEditorContentStyles, getViewerColors } from "../../theme/viewerStyles";
import { scheduleRetriableFocusRestore } from "./focusRestoration";
import { MARKDOWN_EDITOR_AUTOFOCUS_RETRY_DELAYS_MS } from "./markdownEditorConstants";
import { mdxEditorSearchPlugin } from "./mdxEditorSearchPlugin";

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
  focusCurrentSearchResult: () => boolean;
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
  onCurrentRangeChange: (range: Range | null) => void;
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

const MarkdownInlineFormattingToggles = ({ includeUnderline = true }: { includeUnderline?: boolean }) => {
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
  ].filter((definition) => includeUnderline || definition.formatName !== "underline");

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

type MarkdownEditorViewMode = "rich-text" | "source" | "diff";
type MarkdownEditorListType = "" | "bullet" | "number" | "check";
type MarkdownEditorBlockType = "paragraph" | "quote" | "h1" | "h2" | "h3";
type MarkdownMobileExtraActionKey = "list" | "link" | "inline-code" | "underline";

const MARKDOWN_MOBILE_TOOLBAR_CLASS = "sambee-markdown-editor-mobile-toolbar";
const MOBILE_TOOLBAR_ACTION_SIZE_PX = 44;
const MOBILE_TOOLBAR_ACTION_GAP_PX = 4;
const MOBILE_TOOLBAR_HORIZONTAL_PADDING_PX = 16;
const MOBILE_TOOLBAR_GROUP_GAP_PX = 8;
const MOBILE_TOOLBAR_DEFAULT_WIDTH_PX = 320;
const MOBILE_TOOLBAR_BASE_ACTIONS_COUNT = 4;
const MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY: readonly MarkdownMobileExtraActionKey[] = ["list", "link", "inline-code", "underline"];

function getVisibleMobileExtraActionCount(toolbarWidth: number): number {
  const availableLeftGroupWidth =
    toolbarWidth - MOBILE_TOOLBAR_HORIZONTAL_PADDING_PX - MOBILE_TOOLBAR_ACTION_SIZE_PX - MOBILE_TOOLBAR_GROUP_GAP_PX;
  const baseActionsWidth =
    MOBILE_TOOLBAR_BASE_ACTIONS_COUNT * MOBILE_TOOLBAR_ACTION_SIZE_PX +
    (MOBILE_TOOLBAR_BASE_ACTIONS_COUNT - 1) * MOBILE_TOOLBAR_ACTION_GAP_PX;
  const remainingWidth = availableLeftGroupWidth - baseActionsWidth;

  if (remainingWidth <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY.length,
      Math.floor(remainingWidth / (MOBILE_TOOLBAR_ACTION_SIZE_PX + MOBILE_TOOLBAR_ACTION_GAP_PX))
    )
  );
}

const MarkdownMobileToolbarButton = ({
  active = false,
  activeBackground,
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  active?: boolean;
  activeBackground: string;
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) => {
  return (
    <IconButton
      aria-label={ariaLabel}
      color="inherit"
      data-toolbar-item
      data-editor-tooltip={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      size="medium"
      sx={{
        flexShrink: 0,
        width: MOBILE_TOOLBAR_ACTION_SIZE_PX,
        height: MOBILE_TOOLBAR_ACTION_SIZE_PX,
        borderRadius: 1,
        bgcolor: active ? activeBackground : "transparent",
      }}
    >
      {children}
    </IconButton>
  );
};

const MarkdownMobileUndoRedoButtons = ({ activeBackground }: { activeBackground: string }) => {
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
    <>
      <MarkdownMobileToolbarButton
        activeBackground={activeBackground}
        ariaLabel={formatEditorTooltip(t("viewer.edit.undo", { defaultValue: "Undo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.undo)}
        disabled={!canUndo}
        onClick={() => {
          activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
        }}
      >
        {iconComponentFor("undo")}
      </MarkdownMobileToolbarButton>
      <MarkdownMobileToolbarButton
        activeBackground={activeBackground}
        ariaLabel={formatEditorTooltip(t("viewer.edit.redo", { defaultValue: "Redo" }), MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.redo)}
        disabled={!canRedo}
        onClick={() => {
          activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
        }}
      >
        {iconComponentFor("redo")}
      </MarkdownMobileToolbarButton>
    </>
  );
};

const MarkdownMobileFormatButton = ({
  activeLabel,
  activeBackground,
  format,
  formatName,
  icon,
  inactiveLabel,
  shortcutLabel,
}: {
  activeLabel: string;
  activeBackground: string;
  format: number;
  formatName: "bold" | "italic" | "underline" | "code";
  icon: string;
  inactiveLabel: string;
  shortcutLabel: string;
}) => {
  const [currentFormat, iconComponentFor] = useCellValues(currentFormat$, iconComponentFor$);
  const applyFormat = usePublisher(applyFormat$);
  const isActive = (currentFormat & format) !== 0;

  return (
    <MarkdownMobileToolbarButton
      active={isActive}
      activeBackground={activeBackground}
      ariaLabel={formatEditorTooltip(isActive ? activeLabel : inactiveLabel, shortcutLabel)}
      onClick={() => {
        applyFormat(formatName);
      }}
    >
      {iconComponentFor(icon)}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileBulletListButton = ({ activeBackground }: { activeBackground: string }) => {
  const { t } = useTranslation();
  const [currentListType, iconComponentFor, isInTable] = useCellValues(currentListType$, iconComponentFor$, editorInTable$);
  const applyListType = usePublisher(applyListType$);

  return (
    <MarkdownMobileToolbarButton
      active={currentListType === "bullet"}
      activeBackground={activeBackground}
      ariaLabel={t("viewer.edit.bulletedList", { defaultValue: "Bulleted list" })}
      disabled={isInTable}
      onClick={() => {
        applyListType(currentListType === "bullet" ? "" : "bullet");
      }}
    >
      {iconComponentFor("format_list_bulleted")}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileLinkButton = ({ activeBackground }: { activeBackground: string }) => {
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);
  const title = withShortcut(MARKDOWN_EDITOR_SHORTCUTS.CREATE_LINK);

  return (
    <MarkdownMobileToolbarButton
      activeBackground={activeBackground}
      ariaLabel={title}
      onClick={() => {
        openLinkDialog();
      }}
    >
      {iconComponentFor("link")}
    </MarkdownMobileToolbarButton>
  );
};

const MarkdownMobileMoreActionsMenu = () => {
  const { t } = useTranslation();
  const iconComponentFor = useGurxCellValue(iconComponentFor$);
  const currentBlockType = useCellValue(currentBlockType$) as MarkdownEditorBlockType;
  const currentListType = useCellValue(currentListType$) as MarkdownEditorListType;
  const isInTable = useCellValue(editorInTable$);
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const applyBlockType = usePublisher(applyBlockType$);
  const applyFormat = usePublisher(applyFormat$);
  const applyListType = usePublisher(applyListType$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertTable = usePublisher(insertTable$);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);
  const setViewMode = usePublisher(viewMode$);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const isOpen = Boolean(anchorEl);
  const menuId = "markdown-mobile-more-actions-menu";
  const menuLabel = t("viewer.edit.moreActions", { defaultValue: "More actions" });

  const closeMenu = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const runMenuAction = useCallback(
    (action: () => void) => {
      action();
      closeMenu();
    },
    [closeMenu]
  );

  const handleListAction = useCallback(
    (listType: Exclude<MarkdownEditorListType, "">) => {
      runMenuAction(() => {
        applyListType(currentListType === listType ? "" : listType);
      });
    },
    [applyListType, currentListType, runMenuAction]
  );

  const handleBlockTypeAction = useCallback(
    (blockType: MarkdownEditorBlockType) => {
      runMenuAction(() => {
        applyBlockType(blockType);
      });
    },
    [applyBlockType, runMenuAction]
  );

  const handleModeAction = useCallback(
    (nextViewMode: MarkdownEditorViewMode) => {
      runMenuAction(() => {
        setViewMode(nextViewMode);
      });
    },
    [runMenuAction, setViewMode]
  );

  return (
    <>
      <IconButton
        aria-label={menuLabel}
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen ? "true" : undefined}
        aria-haspopup="menu"
        color="inherit"
        data-toolbar-item
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        size="medium"
        sx={{ flexShrink: 0, width: 44, height: 44 }}
      >
        {iconComponentFor("more_vert")}
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={isOpen}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 220,
              maxWidth: "min(280px, calc(100vw - 16px))",
            },
          },
        }}
      >
        {viewMode === "rich-text" && [
          <MenuItem
            key="list-bullet"
            selected={currentListType === "bullet"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("bullet");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_bulleted")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.bulletedList", { defaultValue: "Bulleted list" })} />
          </MenuItem>,
          <MenuItem
            key="list-number"
            selected={currentListType === "number"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("number");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_numbered")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.numberedList", { defaultValue: "Numbered list" })} />
          </MenuItem>,
          <MenuItem
            key="list-check"
            selected={currentListType === "check"}
            disabled={isInTable}
            onClick={() => {
              handleListAction("check");
            }}
          >
            <ListItemIcon>{iconComponentFor("format_list_checked")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.checkList", { defaultValue: "Checklist" })} />
          </MenuItem>,
          <MenuItem
            key="block-paragraph"
            selected={currentBlockType === "paragraph"}
            onClick={() => {
              handleBlockTypeAction("paragraph");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.paragraph", { defaultValue: "Paragraph" })} />
          </MenuItem>,
          <MenuItem
            key="block-h1"
            selected={currentBlockType === "h1"}
            onClick={() => {
              handleBlockTypeAction("h1");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading1", { defaultValue: "Heading 1" })} />
          </MenuItem>,
          <MenuItem
            key="block-h2"
            selected={currentBlockType === "h2"}
            onClick={() => {
              handleBlockTypeAction("h2");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading2", { defaultValue: "Heading 2" })} />
          </MenuItem>,
          <MenuItem
            key="block-h3"
            selected={currentBlockType === "h3"}
            onClick={() => {
              handleBlockTypeAction("h3");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.heading3", { defaultValue: "Heading 3" })} />
          </MenuItem>,
          <MenuItem
            key="block-quote"
            selected={currentBlockType === "quote"}
            onClick={() => {
              handleBlockTypeAction("quote");
            }}
          >
            <ListItemText inset primary={t("viewer.edit.quote", { defaultValue: "Quote" })} />
          </MenuItem>,
          <MenuItem
            key="link"
            onClick={() => {
              runMenuAction(() => {
                openLinkDialog();
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("link")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.createLink", { defaultValue: "Create link" })} />
          </MenuItem>,
          <MenuItem
            key="inline-code"
            onClick={() => {
              runMenuAction(() => {
                applyFormat("code");
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("code")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.inlineCode", { defaultValue: "Inline code format" })} />
          </MenuItem>,
          <MenuItem
            key="table"
            disabled={isInTable}
            onClick={() => {
              runMenuAction(() => {
                insertTable({ rows: 3, columns: 3 });
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("table")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertTable", { defaultValue: "Insert table" })} />
          </MenuItem>,
          <MenuItem
            key="thematic-break"
            onClick={() => {
              runMenuAction(() => {
                insertThematicBreak();
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("horizontal_rule")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertThematicBreak", { defaultValue: "Insert thematic break" })} />
          </MenuItem>,
          <MenuItem
            key="code-block"
            onClick={() => {
              runMenuAction(() => {
                insertCodeBlock({});
              });
            }}
          >
            <ListItemIcon>{iconComponentFor("frame_source")}</ListItemIcon>
            <ListItemText primary={t("viewer.edit.insertCodeBlock", { defaultValue: "Insert code block" })} />
          </MenuItem>,
        ]}
        <MenuItem
          selected={viewMode === "rich-text"}
          onClick={() => {
            handleModeAction("rich-text");
          }}
        >
          <ListItemIcon>{iconComponentFor("rich_text")}</ListItemIcon>
          <ListItemText primary={t("viewer.edit.richTextMode", { defaultValue: "Rich-text mode" })} />
        </MenuItem>
        <MenuItem
          selected={viewMode === "diff"}
          onClick={() => {
            handleModeAction("diff");
          }}
        >
          <ListItemIcon>{iconComponentFor("difference")}</ListItemIcon>
          <ListItemText primary={t("viewer.edit.diffMode", { defaultValue: "Diff mode" })} />
        </MenuItem>
        <MenuItem
          selected={viewMode === "source"}
          onClick={() => {
            handleModeAction("source");
          }}
        >
          <ListItemIcon>{iconComponentFor("markdown")}</ListItemIcon>
          <ListItemText primary={t("viewer.edit.sourceMode", { defaultValue: "Source mode" })} />
        </MenuItem>
      </Menu>
    </>
  );
};

const MarkdownMobileToolbar = ({ activeBackground }: { activeBackground: string }) => {
  const { t } = useTranslation();
  const viewMode = useCellValue(viewMode$) as MarkdownEditorViewMode;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(MOBILE_TOOLBAR_DEFAULT_WIDTH_PX);

  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) {
      return;
    }

    const measureWidth = () => {
      const measuredWidth = element.offsetWidth || window.innerWidth || MOBILE_TOOLBAR_DEFAULT_WIDTH_PX;
      if (measuredWidth > 0) {
        setToolbarWidth(measuredWidth);
      }
    };

    measureWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
          if (width > 0) {
            setToolbarWidth(width);
          }
        }
      });

      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measureWidth);
    return () => {
      window.removeEventListener("resize", measureWidth);
    };
  }, []);

  const visibleExtraActions =
    viewMode === "rich-text" ? MOBILE_TOOLBAR_EXTRA_ACTION_PRIORITY.slice(0, getVisibleMobileExtraActionCount(toolbarWidth)) : [];

  return (
    <Box
      ref={toolbarRef}
      className={MARKDOWN_MOBILE_TOOLBAR_CLASS}
      sx={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
          flexShrink: 1,
          overflow: "hidden",
        }}
      >
        {viewMode === "rich-text" && (
          <>
            <MarkdownMobileUndoRedoButtons activeBackground={activeBackground} />
            <MarkdownMobileFormatButton
              activeLabel={t("viewer.edit.removeBold", { defaultValue: "Remove bold" })}
              activeBackground={activeBackground}
              format={IS_BOLD}
              formatName="bold"
              icon="format_bold"
              inactiveLabel={t("viewer.edit.bold", { defaultValue: "Bold" })}
              shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.bold}
            />
            <MarkdownMobileFormatButton
              activeLabel={t("viewer.edit.removeItalic", { defaultValue: "Remove italic" })}
              activeBackground={activeBackground}
              format={IS_ITALIC}
              formatName="italic"
              icon="format_italic"
              inactiveLabel={t("viewer.edit.italic", { defaultValue: "Italic" })}
              shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.italic}
            />
            {visibleExtraActions.includes("list") ? <MarkdownMobileBulletListButton activeBackground={activeBackground} /> : null}
            {visibleExtraActions.includes("link") ? <MarkdownMobileLinkButton activeBackground={activeBackground} /> : null}
            {visibleExtraActions.includes("inline-code") ? (
              <MarkdownMobileFormatButton
                activeLabel={t("viewer.edit.removeInlineCode", { defaultValue: "Remove code format" })}
                activeBackground={activeBackground}
                format={IS_CODE}
                formatName="code"
                icon="code"
                inactiveLabel={t("viewer.edit.inlineCode", { defaultValue: "Inline code format" })}
                shortcutLabel={MARKDOWN_EDITOR_SHORTCUTS.INLINE_CODE.label}
              />
            ) : null}
            {visibleExtraActions.includes("underline") ? (
              <MarkdownMobileFormatButton
                activeLabel={t("viewer.edit.removeUnderline", { defaultValue: "Remove underline" })}
                activeBackground={activeBackground}
                format={IS_UNDERLINE}
                formatName="underline"
                icon="format_underlined"
                inactiveLabel={t("viewer.edit.underline", { defaultValue: "Underline" })}
                shortcutLabel={MARKDOWN_EDITOR_TOOLTIP_SHORTCUTS.underline}
              />
            ) : null}
          </>
        )}
      </Box>
      <MarkdownMobileMoreActionsMenu />
    </Box>
  );
};

const MarkdownDesktopToolbar = () => {
  return (
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
  );
};

const MarkdownResponsiveToolbar = ({
  activeBackground,
  isMobile,
  onSearchStateChange,
  onCurrentRangeChange,
  onSearchCommandsChange,
  onActiveEditorChange,
  onEditorCommandsChange,
  searchOpen,
  searchText,
}: {
  activeBackground: string;
  isMobile: boolean;
  onSearchStateChange?: (state: MarkdownRichEditorSearchState) => void;
  onCurrentRangeChange: (range: Range | null) => void;
  onSearchCommandsChange: (commands: MarkdownRichEditorSearchCommands | null) => void;
  onActiveEditorChange: (editor: LexicalEditor | null) => void;
  onEditorCommandsChange: (commands: MarkdownRichEditorCommands | null) => void;
  searchOpen: boolean;
  searchText: string;
}) => {
  return (
    <>
      <MarkdownRichEditorSearchBridge
        searchText={searchText}
        searchOpen={searchOpen}
        onSearchStateChange={onSearchStateChange}
        onCurrentRangeChange={onCurrentRangeChange}
        onCommandsChange={onSearchCommandsChange}
      />
      <MarkdownActiveEditorBridge onActiveEditorChange={onActiveEditorChange} />
      <MarkdownRichEditorCommandBridge onCommandsChange={onEditorCommandsChange} />
      {isMobile ? <MarkdownMobileToolbar activeBackground={activeBackground} /> : <MarkdownDesktopToolbar />}
    </>
  );
};

const MarkdownRichEditorSearchBridge = ({
  searchText,
  searchOpen,
  onSearchStateChange,
  onCurrentRangeChange,
  onCommandsChange,
}: MarkdownRichEditorSearchBridgeProps) => {
  const { closeSearch, currentRange, cursor, isSearchOpen, next, openSearch, prev, search, setSearch, total } = useEditorSearch();
  const viewMode = useCellValue(viewMode$);
  const isSearchable = viewMode === "rich-text";
  const lastReportedSearchStateRef = useRef<MarkdownRichEditorSearchState | null>(null);
  const requestedSearchValueRef = useRef<string | null | undefined>(undefined);
  const requestedSearchOpenRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    onCommandsChange(isSearchable ? { nextSearchResult: next, previousSearchResult: prev } : NOOP_SEARCH_COMMANDS);

    return () => {
      onCommandsChange(null);
    };
  }, [isSearchable, next, onCommandsChange, prev]);

  useLayoutEffect(() => {
    const nextSearchValue = searchText.trim().length > 0 ? searchText : null;

    if (!isSearchable) {
      if (search === null) {
        requestedSearchValueRef.current = null;
      } else if (requestedSearchValueRef.current !== null) {
        setSearch(null);
        requestedSearchValueRef.current = null;
      }

      if (isSearchOpen) {
        closeSearch();
        requestedSearchOpenRef.current = false;
      } else {
        requestedSearchOpenRef.current = false;
      }

      return;
    }

    if (search === nextSearchValue) {
      requestedSearchValueRef.current = nextSearchValue;
      return;
    }

    if (requestedSearchValueRef.current !== nextSearchValue) {
      setSearch(nextSearchValue);
      requestedSearchValueRef.current = nextSearchValue;
    }
  }, [closeSearch, isSearchOpen, isSearchable, search, searchText, setSearch]);

  useLayoutEffect(() => {
    if (!isSearchable) {
      onCurrentRangeChange(null);
      return;
    }

    if (searchOpen) {
      if (isSearchOpen) {
        requestedSearchOpenRef.current = true;
      } else if (requestedSearchOpenRef.current !== true) {
        openSearch();
        requestedSearchOpenRef.current = true;
      }

      return;
    }

    onCurrentRangeChange(null);

    if (isSearchOpen) {
      closeSearch();
      requestedSearchOpenRef.current = false;
    } else {
      requestedSearchOpenRef.current = false;
    }
  }, [closeSearch, isSearchOpen, isSearchable, onCurrentRangeChange, openSearch, searchOpen]);

  useEffect(() => {
    onCurrentRangeChange(isSearchable ? currentRange : null);
  }, [currentRange, isSearchable, onCurrentRangeChange]);

  useEffect(() => {
    if (!isSearchable || !searchOpen || !search.trim() || total === 0 || cursor !== 0) {
      return;
    }

    next();
  }, [cursor, isSearchable, next, search, searchOpen, total]);

  useEffect(() => {
    const nextSearchState: MarkdownRichEditorSearchState = {
      searchText: search,
      searchMatches: total,
      currentMatch: total > 0 ? Math.max(cursor, 1) : 0,
      isSearchOpen,
      isSearchable,
      viewMode,
    };

    const lastSearchState = lastReportedSearchStateRef.current;
    if (
      lastSearchState &&
      lastSearchState.searchText === nextSearchState.searchText &&
      lastSearchState.searchMatches === nextSearchState.searchMatches &&
      lastSearchState.currentMatch === nextSearchState.currentMatch &&
      lastSearchState.isSearchOpen === nextSearchState.isSearchOpen &&
      lastSearchState.isSearchable === nextSearchState.isSearchable &&
      lastSearchState.viewMode === nextSearchState.viewMode
    ) {
      return;
    }

    lastReportedSearchStateRef.current = nextSearchState;
    onSearchStateChange?.(nextSearchState);
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
    const activeSearchRangeRef = useRef<Range | null>(null);
    const preservedSelectionRef = useRef<MarkdownRichEditorSelectionSnapshot | null>(null);
    const searchCommandsRef = useRef<MarkdownRichEditorSearchCommands>(NOOP_SEARCH_COMMANDS);
    const commandsRef = useRef<MarkdownRichEditorCommands>(NOOP_EDITOR_COMMANDS);
    const [shouldAutoFocus, setShouldAutoFocus] = useState(autoFocus);
    const { currentTheme } = useSambeeTheme();
    const muiTheme = useTheme();
    const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));
    const {
      toolbarBg: _toolbarBg,
      toolbarText: _toolbarText,
      viewerText,
      linkColor,
      linkHoverColor,
    } = getViewerColors(currentTheme, "markdown");
    const secondaryToolbarSelectedBackground = getSecondaryToolbarSelectedBackground(muiTheme, currentTheme);
    const secondaryToolbarColors = getSecondaryToolbarSurfaceColors(muiTheme, {
      pillBackground: secondaryToolbarSelectedBackground,
      activeBackground: secondaryToolbarSelectedBackground,
    });
    const secondaryToolbarCssVars = {
      "--basePageBg": secondaryToolbarColors.popupBackground,
      "--baseBg": secondaryToolbarColors.stripBackground,
      "--baseBgSubtle": secondaryToolbarColors.pillBackground,
      "--baseBgHover": secondaryToolbarColors.hoverBackground,
      "--baseBgActive": secondaryToolbarColors.pillBackground,
      "--baseBorder": secondaryToolbarColors.borderColor,
      "--baseBase": secondaryToolbarColors.groupedBackground,
      "--baseTextContrast": secondaryToolbarColors.textColor,
    };
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

    const focusCurrentSearchRange = useCallback((): boolean => {
      const currentRange = activeSearchRangeRef.current;

      if (!currentRange) {
        return focusEditableArea(true);
      }

      const editable = containerRef.current?.querySelector('[contenteditable="true"], textarea');
      const activeEditor = activeEditorRef.current;

      if (!(editable instanceof HTMLElement) || !activeEditor) {
        return focusEditableArea(true);
      }

      let restored = false;

      editable.focus({ preventScroll: true });
      activeEditor.update(
        () => {
          const startNode = $getNearestNodeFromDOMNode(currentRange.startContainer);
          const endNode = $getNearestNodeFromDOMNode(currentRange.endContainer);

          if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
            return;
          }

          const rangeSelection = $createRangeSelection();
          rangeSelection.anchor.set(startNode.getKey(), currentRange.startOffset, "text");
          rangeSelection.focus.set(endNode.getKey(), currentRange.endOffset, "text");
          $setSelection(rangeSelection);
          restored = true;
        },
        { discrete: true }
      );

      return restored || focusEditableArea(true);
    }, [focusEditableArea]);

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
        focusCurrentSearchResult: () => focusCurrentSearchRange(),
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
      [captureSelection, focusCurrentSearchRange, focusEditableArea, restoreSelection]
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
        mdxEditorSearchPlugin(),
        diffSourcePlugin({ viewMode: "rich-text", diffMarkdown }),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <MarkdownResponsiveToolbar
                activeBackground={secondaryToolbarColors.pillBackground}
                isMobile={isMobile}
                searchText={searchText}
                searchOpen={searchOpen}
                onSearchStateChange={onSearchStateChange}
                onCurrentRangeChange={(range) => {
                  activeSearchRangeRef.current = range;
                }}
                onSearchCommandsChange={(commands) => {
                  searchCommandsRef.current = commands ?? NOOP_SEARCH_COMMANDS;
                }}
                onActiveEditorChange={(editor) => {
                  activeEditorRef.current = editor;
                }}
                onEditorCommandsChange={(commands) => {
                  commandsRef.current = commands ?? NOOP_EDITOR_COMMANDS;
                }}
              />
            </>
          ),
        }),
      ],
      [diffMarkdown, isMobile, onSearchStateChange, searchOpen, searchText, secondaryToolbarColors.pillBackground]
    );

    return (
      <>
        <GlobalStyles
          styles={{
            [`.${MARKDOWN_EDITOR_POPUP_CLASS}`]: {
              ...secondaryToolbarCssVars,
              color: secondaryToolbarColors.textColor,
            },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectContainer'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarButtonDropdownContainer'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectContainer']`]:
              {
                backgroundColor: secondaryToolbarColors.popupBackground,
                color: secondaryToolbarColors.textColor,
                boxShadow: secondaryToolbarColors.shadow,
              },
            [`.${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectItem'][data-highlighted], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='toolbarNodeKindSelectItem'][data-state='checked'], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectItem'][data-highlighted], .${MARKDOWN_EDITOR_POPUP_CLASS} [class*='selectItem'][data-state='checked']`]:
              {
                backgroundColor: secondaryToolbarColors.pillBackground,
              },
          }}
        />
        <Box
          ref={containerRef}
          className={className}
          sx={{
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            ...secondaryToolbarCssVars,
            "& .mdxeditor": {
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr)",
              overflow: "hidden",
              color: viewerText,
            },
            "& .mdxeditor-toolbar": {
              ...getSecondaryActionStripStyle(muiTheme),
              position: "relative",
              top: "auto",
              width: "100%",
              flexShrink: 0,
              boxSizing: "border-box",
              overflowX: isMobile ? "hidden" : "auto",
              overflowY: "hidden",
              borderRadius: 0,
            },
            "& .mdxeditor-toolbar svg": {
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar div[role='separator']": {
              borderLeftColor: secondaryToolbarColors.borderColor,
              borderRightColor: secondaryToolbarColors.separatorColor,
            },
            "& .mdxeditor-toolbar [data-toolbar-item]": {
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarToggleSingleGroup'], & .mdxeditor-toolbar [class*='toolbarGroupOfGroups']": {
              backgroundColor: "transparent",
            },
            "& .mdxeditor-toolbar [class*='toolbarToggleItem'][data-state='on']": {
              backgroundColor: secondaryToolbarColors.pillBackground,
              color: secondaryToolbarColors.textColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarNodeKindSelectTrigger'], & .mdxeditor-toolbar [class*='toolbarButtonSelectTrigger'], & .mdxeditor-toolbar [class*='selectTrigger']":
              {
                backgroundColor: secondaryToolbarColors.popupBackground,
                color: secondaryToolbarColors.textColor,
                borderColor: secondaryToolbarColors.borderColor,
              },
            "& .mdxeditor-toolbar [class*='toolbarModeSwitch'], & .mdxeditor-toolbar [class*='diffSourceToggle']": {
              backgroundColor: "transparent",
              borderColor: secondaryToolbarColors.borderColor,
            },
            "& .mdxeditor-toolbar [class*='toolbarModeSwitch'] [data-state='on'], & .mdxeditor-toolbar [class*='diffSourceToggle'] [data-state='on']":
              {
                backgroundColor: secondaryToolbarColors.pillBackground,
              },
            [`& .${MARKDOWN_MOBILE_TOOLBAR_CLASS}`]: {
              minHeight: 44,
            },
            "& .mdxeditor > :not(.mdxeditor-toolbar)": {
              minHeight: 0,
              boxSizing: "border-box",
              padding: muiTheme.spacing(2),
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
              backgroundColor: secondaryToolbarColors.stripBackground,
            },
            "& .cm-editor": {
              minHeight: 0,
              height: "100%",
              backgroundColor: secondaryToolbarColors.stripBackground,
            },
            "& .cm-scroller, & .cm-content, & .cm-gutters": {
              backgroundColor: secondaryToolbarColors.stripBackground,
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
      </>
    );
  }
);

MarkdownRichEditor.displayName = "MarkdownRichEditor";

export default MarkdownRichEditor;
