import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { type ErrorInfo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, MARKDOWN_EDITOR_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../../hooks/useApiRetry";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import { getMarkdownContentStyles, getViewerColors } from "../../theme/viewerStyles";
import { isApiError } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  activateDomTextSearchMatch,
  applyDomTextSearchHighlights,
  clearDomTextSearchHighlights,
  DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE,
  DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR,
  type DomTextSearchMatch,
} from "../../utils/domTextSearch";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { blurActiveToolbarControl } from "../../utils/keyboardUtils";
import { createShareFile, shareNativeContent, shouldWarmNativeSharePayload, supportsNativeShare } from "../../utils/nativeShare";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import MarkdownEditorErrorBoundary from "./MarkdownEditorErrorBoundary";
import MarkdownRichEditor, { type MarkdownRichEditorHandle, type MarkdownRichEditorSearchState } from "./MarkdownRichEditor";
import { VIEWER_SEARCH_INPUT_ATTRIBUTE, ViewerControls } from "./ViewerControls";
import { createCancelToolbarAction, createEditToolbarAction, createSaveToolbarAction } from "./viewerToolbarActions";
import "highlight.js/styles/github.css";

const MARKDOWN_SEARCH_ROOT_SELECTOR = '[data-markdown-search-root="true"]';
const MARKDOWN_SEARCH_MATCH_COLOR = "rgba(255, 255, 0, 0.4)";
const MARKDOWN_SEARCH_CURRENT_MATCH_COLOR = "rgba(255, 152, 0, 0.4)";
const MDX_EDITOR_SEARCH_MATCH_SELECTOR = "& .sambee-markdown-editor ::highlight(MdxSearch)";
const MDX_EDITOR_CURRENT_SEARCH_MATCH_SELECTOR = "& .sambee-markdown-editor ::highlight(MdxFocusSearch)";

function isViewerSearchInputFocused(): boolean {
  return document.activeElement instanceof HTMLElement && document.activeElement.getAttribute(VIEWER_SEARCH_INPUT_ATTRIBUTE) === "true";
}

function isMarkdownEditorTextInputFocused(): boolean {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (!activeElement.closest(".sambee-markdown-editor")) {
    return false;
  }

  return activeElement.matches('textarea, [contenteditable="true"]');
}

function getEditorErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

type PendingUnsavedChangesAction = "cancel-edit" | "close-viewer";

/**
 * Markdown Viewer Component
 * Displays markdown files with syntax highlighting and GitHub-flavored markdown support.
 * Integrated with ViewerControls and keyboard shortcuts system.
 */
export const MarkdownViewer: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>("");
  const [draftContent, setDraftContent] = useState<string>("");
  const [editBaselineContent, setEditBaselineContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lockHeld, setLockHeld] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchMatches, setSearchMatches] = useState(0);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [editorBoundaryKey, setEditorBoundaryKey] = useState(0);
  const [editorFailed, setEditorFailed] = useState(false);
  const [pendingUnsavedChangesAction, setPendingUnsavedChangesAction] = useState<PendingUnsavedChangesAction | null>(null);
  const [editorSearchState, setEditorSearchState] = useState<MarkdownRichEditorSearchState>({
    searchText: "",
    searchMatches: 0,
    currentMatch: 0,
    isSearchOpen: false,
    isSearchable: true,
    viewMode: "rich-text",
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownRichEditorHandle | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lockHeldRef = useRef(false);
  const hasUserEditedRef = useRef(false);
  const pendingBaselineSyncTimeoutRef = useRef<number | null>(null);
  const searchHighlightsRef = useRef<DomTextSearchMatch[]>([]);
  const prefetchedShareFileRef = useRef<File | null>(null);
  const sharePrefetchPromiseRef = useRef<Promise<File> | null>(null);
  const editSessionIdRef = useRef(typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const fetchWithRetry = useApiRetry();

  const { currentTheme } = useSambeeTheme();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));
  const shareEnabled = isMobile && supportsNativeShare();
  const shareWarmEnabled = shareEnabled && shouldWarmNativeSharePayload();
  const supportsEditLocks = apiService.supportsEditLocks(connectionId);
  const { viewerBg, toolbarBg, toolbarText, viewerText } = getViewerColors(currentTheme, "markdown");

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  // Load markdown content
  useEffect(() => {
    const abortController = new AbortController();

    const loadContent = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchWithRetry(() => apiService.getFileContent(connectionId, path), {
          signal: abortController.signal,
          maxRetries: 1,
          retryDelay: 1000,
        });
        setContent(data);
        if (!isEditing) {
          setDraftContent(data);
          setEditBaselineContent(data);
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          return;
        }

        // Show "server busy" only for actual transient/network errors
        const errorMessage = checkIsTransientError(err)
          ? getTransientErrorMessage()
          : getApiErrorMessage(err, "Failed to load markdown file", { includeOriginalMessage: true });

        setError(errorMessage);
        logError("Error loading markdown:", {
          error: err,
          path,
          connectionId,
          detail: isApiError(err) ? err.response?.data?.detail : undefined,
        });
      } finally {
        setLoading(false);
      }
    };

    loadContent();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, path, fetchWithRetry, isEditing]);

  // Auto-focus the content when loaded so keyboard scrolling works
  useEffect(() => {
    if (!loading && !error && !isEditing && contentRef.current) {
      // Small delay to ensure dialog transition is complete
      setTimeout(() => {
        contentRef.current?.focus();
      }, 100);
    }
  }, [loading, error, isEditing]);

  useEffect(() => {
    if (!isEditing || !editorRef.current) {
      return;
    }

    const focusDelaysMs = [0, 16, 48];
    const timeoutIds = focusDelaysMs.map((delayMs) =>
      window.setTimeout(() => {
        editorRef.current?.focus();
      }, delayMs)
    );

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isEditing]);

  const hasUnsavedChanges = isEditing && hasUserEditedRef.current && draftContent !== editBaselineContent;
  const unsavedChangesDialogOpen = pendingUnsavedChangesAction !== null;

  const clearPendingBaselineSync = useCallback(() => {
    if (pendingBaselineSyncTimeoutRef.current !== null) {
      window.clearTimeout(pendingBaselineSyncTimeoutRef.current);
      pendingBaselineSyncTimeoutRef.current = null;
    }
  }, []);

  const releaseEditLock = useCallback(async () => {
    if (!lockHeld) {
      return;
    }

    try {
      await apiService.releaseEditLock(connectionId, path);
    } catch (err) {
      logError("Failed to release markdown edit lock", { error: err, path, connectionId });
    } finally {
      setLockHeld(false);
    }
  }, [connectionId, lockHeld, path]);

  useEffect(() => {
    lockHeldRef.current = lockHeld;
  }, [lockHeld]);

  useEffect(() => {
    if (!isEditing || !lockHeld) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void apiService.heartbeatEditLock(connectionId, path).catch((err) => {
        logError("Failed to refresh markdown edit lock", { error: err, path, connectionId });
      });
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connectionId, isEditing, lockHeld, path]);

  useEffect(() => {
    return () => {
      if (lockHeldRef.current) {
        void apiService.releaseEditLock(connectionId, path).catch((err) => {
          logError("Failed to release markdown edit lock during cleanup", { error: err, path, connectionId });
        });
      }
    };
  }, [connectionId, path]);

  // Download handler
  const handleDownload = useCallback(
    async (_event?: KeyboardEvent) => {
      try {
        await apiService.downloadFile(connectionId, path, filename);
      } catch (err) {
        logError("Failed to download file", { error: err, path, connectionId });
      }
    },
    [connectionId, path, filename]
  );

  const loadShareFile = useCallback(
    async (signal?: AbortSignal) => {
      if (prefetchedShareFileRef.current) {
        return prefetchedShareFileRef.current;
      }

      if (sharePrefetchPromiseRef.current) {
        return sharePrefetchPromiseRef.current;
      }

      const shareFilePromise = apiService.getFileBlob(connectionId, path, { signal }).then((blob) => createShareFile(blob, filename));
      sharePrefetchPromiseRef.current = shareFilePromise;

      try {
        return await shareFilePromise;
      } finally {
        if (sharePrefetchPromiseRef.current === shareFilePromise) {
          sharePrefetchPromiseRef.current = null;
        }
      }
    },
    [connectionId, filename, path]
  );

  useEffect(() => {
    void loadShareFile;
    prefetchedShareFileRef.current = null;
    sharePrefetchPromiseRef.current = null;
  }, [loadShareFile]);

  const handleShareIntent = useCallback(() => {
    if (!shareWarmEnabled) {
      return;
    }

    void loadShareFile();
  }, [shareWarmEnabled, loadShareFile]);

  const handleShare = useCallback(async () => {
    setShareError(null);
    setSharing(true);

    try {
      const shareFile = await loadShareFile();
      const result = await shareNativeContent({
        file: shareFile,
        title: filename,
        text: content,
      });

      if (result === "unsupported") {
        setShareError(t("viewer.share.unsupported"));
      }
    } catch (err) {
      logError("Failed to share markdown", { error: err, path, connectionId });
      setShareError(t("viewer.share.failed"));
    } finally {
      setSharing(false);
    }
  }, [connectionId, content, filename, loadShareFile, path, t]);

  useEffect(() => {
    const markdownRoot = contentRef.current?.querySelector(MARKDOWN_SEARCH_ROOT_SELECTOR);
    clearDomTextSearchHighlights(markdownRoot instanceof HTMLElement ? markdownRoot : null);
    searchHighlightsRef.current = [];

    if (isEditing || !searchText.trim() || loading || error) {
      setSearchMatches(0);
      setCurrentSearchMatch(0);
      return;
    }

    if (!(markdownRoot instanceof HTMLElement)) {
      setSearchMatches(0);
      setCurrentSearchMatch(0);
      return;
    }

    const highlights = applyDomTextSearchHighlights(markdownRoot, searchText);
    searchHighlightsRef.current = highlights;
    const initialMatch = highlights.length > 0 ? 1 : 0;
    setSearchMatches(highlights.length);
    setCurrentSearchMatch(initialMatch);
    activateDomTextSearchMatch(highlights, initialMatch);

    return () => {
      clearDomTextSearchHighlights(markdownRoot);
      searchHighlightsRef.current = [];
    };
  }, [error, isEditing, loading, searchText]);

  useEffect(() => {
    activateDomTextSearchMatch(searchHighlightsRef.current, currentSearchMatch);
  }, [currentSearchMatch]);

  useEffect(() => {
    if (!isEditing || !editorFailed) {
      return;
    }

    setSearchMatches(0);
    setCurrentSearchMatch(0);
  }, [editorFailed, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    setSearchMatches(editorSearchState.searchMatches);
    setCurrentSearchMatch(editorSearchState.currentMatch);

    if (searchPanelOpen && !editorSearchState.isSearchable) {
      setSearchPanelOpen(false);
    }
  }, [editorSearchState.currentMatch, editorSearchState.isSearchable, editorSearchState.searchMatches, isEditing, searchPanelOpen]);

  const exitEditMode = useCallback(
    async (nextContent = content) => {
      clearPendingBaselineSync();
      await releaseEditLock();
      setDraftContent(nextContent);
      setEditBaselineContent(nextContent);
      hasUserEditedRef.current = false;
      setEditError(null);
      setEditorFailed(false);
      setEditorBoundaryKey((previousKey) => previousKey + 1);
      setIsEditing(false);
      setPendingUnsavedChangesAction(null);
    },
    [clearPendingBaselineSync, content, releaseEditLock]
  );

  const closeViewer = useCallback(async () => {
    clearPendingBaselineSync();
    await releaseEditLock();
    setPendingUnsavedChangesAction(null);
    onClose();
  }, [clearPendingBaselineSync, onClose, releaseEditLock]);

  const handleEnterEditMode = useCallback(async () => {
    if (loading || error) {
      return;
    }

    setEditError(null);

    try {
      if (supportsEditLocks) {
        await apiService.acquireEditLock(connectionId, path, editSessionIdRef.current);
        setLockHeld(true);
      }

      setDraftContent(content);
      setEditBaselineContent(content);
      clearPendingBaselineSync();
      hasUserEditedRef.current = false;
      setEditorFailed(false);
      setEditorBoundaryKey((previousKey) => previousKey + 1);
      setIsEditing(true);
    } catch (err) {
      const message = getApiErrorMessage(err, t("viewer.edit.lockFailedReason"), { includeOriginalMessage: true });
      setEditError(t("viewer.edit.lockFailed", { message }));
      logError("Failed to enter markdown edit mode", { error: err, path, connectionId });
    }
  }, [clearPendingBaselineSync, connectionId, content, error, loading, path, supportsEditLocks, t]);

  const handleCancelEdit = useCallback(async () => {
    if (hasUnsavedChanges) {
      setPendingUnsavedChangesAction("cancel-edit");
      return;
    }

    await exitEditMode();
  }, [exitEditMode, hasUnsavedChanges]);

  const persistDraft = useCallback(
    async (afterSave: PendingUnsavedChangesAction | "stay-edit" = "cancel-edit") => {
      if (!isEditing) {
        return false;
      }

      const savedContent = draftContent;
      setEditError(null);
      setIsSaving(true);

      try {
        await apiService.saveTextFile(connectionId, path, savedContent, {
          filename,
          mimeType: "text/markdown;charset=utf-8",
        });
        setContent(savedContent);
        setEditBaselineContent(savedContent);
        hasUserEditedRef.current = false;

        if (afterSave === "close-viewer") {
          await closeViewer();
        } else if (afterSave === "cancel-edit") {
          await exitEditMode(savedContent);
        }

        return true;
      } catch (err) {
        setEditError(getApiErrorMessage(err, t("viewer.edit.saveFailed"), { includeOriginalMessage: true }));
        logError("Failed to save markdown", { error: err, path, connectionId });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [closeViewer, connectionId, draftContent, exitEditMode, filename, isEditing, path, t]
  );

  const handleSave = useCallback(async () => {
    await persistDraft("cancel-edit");
  }, [persistDraft]);

  const handleRequestClose = useCallback(async () => {
    if (isEditing && hasUnsavedChanges) {
      setPendingUnsavedChangesAction("close-viewer");
      return;
    }

    await closeViewer();
  }, [closeViewer, hasUnsavedChanges, isEditing]);

  const handleUnsavedChangesDialogClose = useCallback(() => {
    if (isSaving) {
      return;
    }

    setPendingUnsavedChangesAction(null);
  }, [isSaving]);

  const handleUnsavedChangesDiscard = useCallback(async () => {
    if (pendingUnsavedChangesAction === "close-viewer") {
      await closeViewer();
      return;
    }

    await exitEditMode();
  }, [closeViewer, exitEditMode, pendingUnsavedChangesAction]);

  const handleUnsavedChangesSave = useCallback(async () => {
    if (!pendingUnsavedChangesAction) {
      return;
    }

    await persistDraft(pendingUnsavedChangesAction);
  }, [pendingUnsavedChangesAction, persistDraft]);

  // Toggle fullscreen mode
  const handleToggleFullscreen = useCallback(() => {
    if (!dialogRef.current) return;

    if (!document.fullscreenElement) {
      dialogRef.current.requestFullscreen().catch((err) => {
        logError("Failed to enable fullscreen", { error: err });
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Context-aware Escape handler (window-level via useKeyboardShortcuts)
  // Blur-first logic lives on the Dialog Paper's onKeyDown instead,
  // because it must fire before the parent FileBrowser's window listener.
  // - If in fullscreen: exit fullscreen
  // - Otherwise: close the viewer
  const handleEscape = useCallback(
    (_event?: KeyboardEvent) => {
      if (searchPanelOpen || isViewerSearchInputFocused()) {
        setSearchPanelOpen(false);
        setSearchText("");
      } else if (isEditing) {
        void handleCancelEdit();
      } else if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        void handleRequestClose();
      }
    },
    [handleCancelEdit, handleRequestClose, isEditing, searchPanelOpen]
  );

  const handleOpenSearch = useCallback(
    (_event?: KeyboardEvent) => {
      if (loading || !!error || (isEditing && !editorSearchState.isSearchable)) {
        return;
      }

      setSearchPanelOpen(true);
    },
    [editorSearchState.isSearchable, error, isEditing, loading]
  );

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  const handleSearchPanelToggle = useCallback((open: boolean) => {
    setSearchPanelOpen(open);
  }, []);

  const runEditorCommand = useCallback(
    (commandLabel: string, command: () => void) => {
      if (!isEditing || editorFailed) {
        return;
      }

      setEditError(null);

      try {
        command();
      } catch (err) {
        const message = getEditorErrorMessage(err, t("viewer.edit.commandFailedReason"));
        setEditError(t("viewer.edit.commandFailed", { action: commandLabel, message }));
        logError("Markdown editor command failed", { error: err, path, connectionId, command: commandLabel });
      }
    },
    [connectionId, editorFailed, isEditing, path, t]
  );

  const handleEditorCrashed = useCallback(
    (error: Error, errorInfo: ErrorInfo) => {
      setEditorFailed(true);
      logError("Markdown editor crashed", { error, path, connectionId, componentStack: errorInfo.componentStack }, "viewer");
    },
    [connectionId, path]
  );

  const handleRetryEditor = useCallback(() => {
    setEditError(null);
    setEditorFailed(false);
    setEditorBoundaryKey((previousKey) => previousKey + 1);
  }, []);

  const handleToggleInlineCode = useCallback(() => {
    runEditorCommand(t("viewer.shortcuts.inlineCode"), () => {
      editorRef.current?.toggleInlineCode();
    });
  }, [runEditorCommand, t]);

  const handleInsertCodeBlock = useCallback(() => {
    runEditorCommand(t("viewer.shortcuts.insertCodeBlock"), () => {
      editorRef.current?.insertCodeBlock();
    });
  }, [runEditorCommand, t]);

  const handleEditorChange = useCallback(
    (nextMarkdown: string) => {
      if (isEditing && !hasUserEditedRef.current) {
        clearPendingBaselineSync();
        pendingBaselineSyncTimeoutRef.current = window.setTimeout(() => {
          pendingBaselineSyncTimeoutRef.current = null;

          if (!hasUserEditedRef.current) {
            setEditBaselineContent(nextMarkdown);
          }
        }, 0);
      }

      setDraftContent(nextMarkdown);
    },
    [clearPendingBaselineSync, isEditing]
  );

  const handleEditorUserEdit = useCallback(() => {
    clearPendingBaselineSync();
    hasUserEditedRef.current = true;
  }, [clearPendingBaselineSync]);

  useEffect(() => {
    return () => {
      clearPendingBaselineSync();
    };
  }, [clearPendingBaselineSync]);

  const handleSearchNext = useCallback(
    (_event?: KeyboardEvent) => {
      if (isEditing) {
        runEditorCommand(t("common.search.nextMatch"), () => {
          editorRef.current?.nextSearchResult();
        });
        return;
      }

      if (searchMatches === 0) {
        return;
      }

      setCurrentSearchMatch((previousMatch) => (previousMatch >= searchMatches ? 1 : previousMatch + 1));
    },
    [isEditing, runEditorCommand, searchMatches, t]
  );

  const handleSearchPrevious = useCallback(
    (_event?: KeyboardEvent) => {
      if (isEditing) {
        runEditorCommand(t("common.search.previousMatch"), () => {
          editorRef.current?.previousSearchResult();
        });
        return;
      }

      if (searchMatches === 0) {
        return;
      }

      setCurrentSearchMatch((previousMatch) => (previousMatch <= 1 ? searchMatches : previousMatch - 1));
    },
    [isEditing, runEditorCommand, searchMatches, t]
  );

  /**
   * Paper-level keydown handler — single authority for all Escape logic.
   * MUI Dialogs render in a portal at document.body (outside the React root),
   * so native events may not reliably reach window listeners. Handling
   * everything here and calling preventDefault() makes close robust.
   * 1. If a toolbar button/input has focus → blur it (hide focus ring)
   * 2. If in fullscreen → exit fullscreen
   * 3. Otherwise → close the viewer
   */
  const handlePaperKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (isMarkdownEditorTextInputFocused()) {
        handleEscape();
        return;
      }
      if (blurActiveToolbarControl(contentRef)) return;
      handleEscape();
    },
    [handleEscape]
  );

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  // Keyboard shortcuts using centralized system
  const markdownShortcuts = useMemo(
    () => [
      // Download
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
      {
        ...COMMON_SHORTCUTS.SEARCH,
        handler: handleOpenSearch,
        enabled: !loading && !error && (!isEditing || editorSearchState.isSearchable),
      },
      {
        ...COMMON_SHORTCUTS.NEXT_MATCH,
        handler: handleSearchNext,
        enabled: searchMatches > 0,
      },
      {
        ...COMMON_SHORTCUTS.PREVIOUS_MATCH,
        handler: handleSearchPrevious,
        enabled: searchMatches > 0,
      },
      // Enter edit mode
      {
        ...COMMON_SHORTCUTS.EDIT,
        handler: () => {
          void handleEnterEditMode();
        },
        enabled: !isEditing,
      },
      // Save while editing
      {
        ...COMMON_SHORTCUTS.SAVE,
        handler: () => {
          void handleSave();
        },
        enabled: isEditing && !isSaving,
      },
      {
        ...MARKDOWN_EDITOR_SHORTCUTS.INLINE_CODE,
        handler: handleToggleInlineCode,
        enabled: isEditing && !isSaving,
      },
      {
        ...MARKDOWN_EDITOR_SHORTCUTS.CODE_BLOCK,
        handler: handleInsertCodeBlock,
        enabled: isEditing && !isSaving,
      },
      // Fullscreen
      {
        ...VIEWER_SHORTCUTS.FULLSCREEN,
        handler: handleToggleFullscreen,
      },
      // Close viewer or exit fullscreen on Escape
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleEscape,
        allowInInput: false,
      },
      // Show help
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP,
        handler: handleShowHelp,
      },
    ],
    [
      handleDownload,
      handleEnterEditMode,
      handleEscape,
      handleOpenSearch,
      handleSave,
      handleSearchNext,
      handleSearchPrevious,
      handleShowHelp,
      handleInsertCodeBlock,
      handleToggleFullscreen,
      handleToggleInlineCode,
      editorSearchState.isSearchable,
      error,
      isEditing,
      isSaving,
      loading,
      searchMatches,
    ]
  );

  const isSearchable = isEditing ? !editorFailed && editorSearchState.isSearchable : !loading && !error && content.trim().length > 0;

  useKeyboardShortcuts({
    shortcuts: markdownShortcuts,
    inputSelector: "input, textarea",
  });

  const toolbarActions = useMemo(
    () =>
      isEditing
        ? [
            createSaveToolbarAction({
              id: "save-markdown",
              onClick: () => {
                void handleSave();
              },
              isMobile,
              disabled: isSaving,
            }),
            createCancelToolbarAction({
              id: "cancel-markdown",
              onClick: () => {
                void handleCancelEdit();
              },
              isMobile,
              disabled: isSaving,
            }),
          ]
        : [
            createEditToolbarAction({
              id: "edit-markdown",
              onClick: () => {
                void handleEnterEditMode();
              },
              isMobile,
              disabled: loading || !!error,
            }),
          ],
    [error, handleCancelEdit, handleEnterEditMode, handleSave, isEditing, isMobile, isSaving, loading]
  );

  // Log when markdown viewer opens
  useEffect(() => {
    logInfo("Markdown viewer opened", { filename, path });
  }, [filename, path]);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      logInfo("Markdown viewer closed");
      // Exit fullscreen if still active when component unmounts
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    };
  }, []);

  return (
    <>
      <Dialog
        open={true}
        onClose={() => {
          void handleRequestClose();
        }}
        maxWidth={false}
        fullScreen
        disableEscapeKeyDown // Escape handled by useKeyboardShortcuts
        ref={dialogRef}
        sx={{
          "& .MuiDialog-container": {
            alignItems: "stretch",
            justifyContent: "stretch",
          },
        }}
        PaperProps={{
          onKeyDown: handlePaperKeyDown,
          sx: {
            margin: 0,
            width: "100dvw",
            maxWidth: "100dvw",
            height: "100dvh",
            maxHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            backgroundColor: viewerBg,
          },
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          {/* Markdown Controls Overlay */}
          <Box
            sx={{
              flexShrink: 0,
              zIndex: 1,
            }}
          >
            <ViewerControls
              filename={filename}
              toolbarBackground={toolbarBg}
              toolbarText={toolbarText}
              actions={toolbarActions}
              config={{
                download: true,
                share: shareEnabled,
                search: true,
              }}
              onClose={() => {
                void handleRequestClose();
              }}
              search={{
                searchText,
                onSearchChange: handleSearchChange,
                searchMatches,
                currentMatch: currentSearchMatch,
                onSearchNext: handleSearchNext,
                onSearchPrevious: handleSearchPrevious,
                searchPanelOpen,
                onSearchPanelToggle: handleSearchPanelToggle,
                isSearchable,
                searchUnavailableTitle: isEditing ? t("viewer.edit.searchUnavailable") : undefined,
              }}
              onDownload={handleDownload}
              onShare={handleShare}
              onShareIntent={handleShareIntent}
              shareDisabled={sharing}
            />
          </Box>

          {editError && (
            <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>
              {editError}
            </Alert>
          )}

          {shareError && (
            <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>
              {shareError}
            </Alert>
          )}

          {/* Markdown content area - flex grows to fill remaining space */}
          <Box
            ref={contentRef}
            tabIndex={0}
            sx={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              minHeight: 0,
              width: "100%",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              backgroundColor: viewerBg,
              "&:focus": {
                outline: "none",
              },
            }}
          >
            {loading ? (
              <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
              </Box>
            ) : error ? (
              <Box p={2}>
                <Alert severity="error">{error}</Alert>
              </Box>
            ) : isEditing ? (
              <Box
                sx={{
                  p: 2,
                  height: "100%",
                  overflow: "auto",
                  "& .sambee-markdown-editor": {
                    height: "100%",
                  },
                  "& .sambee-markdown-editor .mdxeditor": {
                    display: "flex",
                    flexDirection: "column",
                    minHeight: "100%",
                  },
                  "& .sambee-markdown-editor [contenteditable='true']": {
                    minHeight: 320,
                  },
                  [MDX_EDITOR_SEARCH_MATCH_SELECTOR]: {
                    backgroundColor: MARKDOWN_SEARCH_MATCH_COLOR,
                  },
                  [MDX_EDITOR_CURRENT_SEARCH_MATCH_SELECTOR]: {
                    backgroundColor: MARKDOWN_SEARCH_CURRENT_MATCH_COLOR,
                  },
                }}
              >
                <MarkdownEditorErrorBoundary
                  key={editorBoundaryKey}
                  title={t("viewer.edit.editorCrashTitle")}
                  description={t("viewer.edit.editorCrashMessage")}
                  retryLabel={t("viewer.edit.retryEditor")}
                  returnToPreviewLabel={t("viewer.edit.returnToPreview")}
                  onError={handleEditorCrashed}
                  onRetry={handleRetryEditor}
                  onReturnToPreview={() => {
                    void handleCancelEdit();
                  }}
                >
                  <MarkdownRichEditor
                    ref={editorRef}
                    className="sambee-markdown-editor"
                    markdown={draftContent}
                    diffMarkdown={content}
                    onChange={handleEditorChange}
                    onUserEdit={handleEditorUserEdit}
                    ariaLabel={t("viewer.edit.editorLabel")}
                    autoFocus={true}
                    readOnly={isSaving}
                    searchText={searchText}
                    searchOpen={searchPanelOpen}
                    onSearchStateChange={setEditorSearchState}
                  />
                </MarkdownEditorErrorBoundary>
              </Box>
            ) : (
              <Box
                data-markdown-search-root="true"
                sx={{
                  ...getMarkdownContentStyles(viewerText),
                  [`& ${DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR}`]: {
                    backgroundColor: MARKDOWN_SEARCH_MATCH_COLOR,
                    borderRadius: 0.5,
                    padding: 0,
                  },
                  [`& ${DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR}[${DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE}="true"]`]: {
                    backgroundColor: MARKDOWN_SEARCH_CURRENT_MATCH_COLOR,
                  },
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                  }}
                >
                  {content}
                </ReactMarkdown>
              </Box>
            )}
          </Box>
        </Box>
      </Dialog>

      <Dialog open={unsavedChangesDialogOpen} onClose={handleUnsavedChangesDialogClose} aria-labelledby="markdown-unsaved-changes-title">
        <DialogTitle id="markdown-unsaved-changes-title">{t("viewer.edit.unsavedChangesTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "text.primary" }}>
            {pendingUnsavedChangesAction === "close-viewer"
              ? t("viewer.edit.unsavedChangesCloseMessage")
              : t("viewer.edit.unsavedChangesExitMessage")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleUnsavedChangesDialogClose} disabled={isSaving} autoFocus>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={() => void handleUnsavedChangesDiscard()} disabled={isSaving} color="warning">
            {t("common.actions.discard")}
          </Button>
          <Button onClick={() => void handleUnsavedChangesSave()} disabled={isSaving} variant="contained">
            {t("common.actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Keyboard Shortcuts Help Dialog */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={markdownShortcuts}
        title={t("keyboardShortcutsHelp.titles.markdownViewer")}
      />
    </>
  );
};

export default MarkdownViewer;
