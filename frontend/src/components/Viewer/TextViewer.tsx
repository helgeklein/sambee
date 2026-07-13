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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../../hooks/useApiRetry";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { readTextEditorMaxFileSizeBytesPreference } from "../../pages/FileBrowser/preferences";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import { getSearchHighlightColors } from "../../theme/commonStyles";
import { getViewerColors } from "../../theme/viewerStyles";
import type { EditLockInfo } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { blurActiveToolbarControl } from "../../utils/keyboardUtils";
import { createShareFile, shareNativeContent, shouldWarmNativeSharePayload, supportsNativeShare } from "../../utils/nativeShare";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import MarkdownEditorErrorBoundary from "./MarkdownEditorErrorBoundary";
import { scheduleRetriableFocusRestore } from "./focusRestoration";
import { TextCodeEditor, type TextCodeEditorHandle, type TextCodeEditorSearchState } from "./TextCodeEditor";
import { useMarkdownEditSession } from "./useMarkdownEditSession";
import { VIEWER_SEARCH_INPUT_ATTRIBUTE, ViewerControls, ViewerFilenameBadge } from "./ViewerControls";
import { createEditToolbarAction, createSaveToolbarAction } from "./viewerToolbarActions";

type PendingUnsavedChangesAction = "cancel-edit" | "close-viewer" | "stay-edit";
type TextSearchCloseReason = "escape" | "toggle";

function withOpacity(color: string, opacity: number): string {
  const normalizedOpacity = Math.max(0, Math.min(1, opacity));
  const hex = color.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${normalizedOpacity})`;
  }

  return color;
}

function isViewerSearchInputFocused(): boolean {
  return document.activeElement instanceof HTMLElement && document.activeElement.getAttribute(VIEWER_SEARCH_INPUT_ATTRIBUTE) === "true";
}

function isTextEditorTextInputFocused(): boolean {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (!activeElement.closest(".sambee-text-editor")) {
    return false;
  }

  return activeElement.matches("textarea, [contenteditable='true']");
}

function preserveTextEditorSelection(editorRef: React.RefObject<TextCodeEditorHandle | null>): void {
  editorRef.current?.preserveSelection();
}

function areTextEditorSearchStatesEqual(left: TextCodeEditorSearchState, right: TextCodeEditorSearchState): boolean {
  return (
    left.searchText === right.searchText &&
    left.searchMatches === right.searchMatches &&
    left.currentMatch === right.currentMatch &&
    left.isSearchOpen === right.isSearchOpen &&
    left.isSearchable === right.isSearchable &&
    left.viewMode === right.viewMode
  );
}

export const TextViewer: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose, isReadOnly = false }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editLockInfo, setEditLockInfo] = useState<EditLockInfo | null>(null);
  const [sharing, setSharing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchMatches, setSearchMatches] = useState(0);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchAutoNavigate, setSearchAutoNavigate] = useState(true);
  const [editorBoundaryKey, setEditorBoundaryKey] = useState(0);
  const [pendingUnsavedChangesAction, setPendingUnsavedChangesAction] = useState<PendingUnsavedChangesAction | null>(null);
  const [editorSearchState, setEditorSearchState] = useState<TextCodeEditorSearchState>({
    searchText: "",
    searchMatches: 0,
    currentMatch: 0,
    isSearchOpen: false,
    isSearchable: true,
    viewMode: "source",
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextCodeEditorHandle | null>(null);
  const unsavedChangesCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const prefetchedShareFileRef = useRef<File | null>(null);
  const sharePrefetchPromiseRef = useRef<Promise<File> | null>(null);
  const editBaselineContentRef = useRef("");
  const lockHeldRef = useRef<EditLockInfo | null>(null);
  const editSessionIdRef = useRef(typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const isEditingRef = useRef(false);
  const fetchWithRetry = useApiRetry();

  const { currentTheme } = useSambeeTheme();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));
  const shareEnabled = isMobile && supportsNativeShare();
  const shareWarmEnabled = shareEnabled && shouldWarmNativeSharePayload();
  const supportsEditLocks = apiService.supportsEditLocks(connectionId);
  const { viewerBg, toolbarBg, toolbarText, viewerText, linkColor } = getViewerColors(currentTheme, "markdown");
  const searchHighlightColors = useMemo(() => getSearchHighlightColors(muiTheme, currentTheme), [currentTheme, muiTheme]);
  const filename = path.split("/").pop() || path;
  const maxFileSizeBytes = readTextEditorMaxFileSizeBytesPreference();
  const contentSizeBytes = useMemo(() => new Blob([content]).size, [content]);
  const exceedsEditorLimit = !loading && !error && contentSizeBytes > maxFileSizeBytes;
  const textEditorTheme = useMemo(
    () => ({
      accentColor: linkColor,
      activeLineBackground: muiTheme.palette.action.selected,
      borderColor: withOpacity(viewerText, muiTheme.palette.mode === "dark" ? 0.32 : 0.16),
      currentSearchMatchBackground: searchHighlightColors.currentMatch,
      isDarkMode: muiTheme.palette.mode === "dark",
      otherSearchMatchBackground: searchHighlightColors.otherMatches,
      selectionBackground: withOpacity(linkColor, muiTheme.palette.mode === "dark" ? 0.3 : 0.18),
      surfaceBackground: viewerBg,
      textColor: viewerText,
    }),
    [linkColor, muiTheme.palette.action.selected, muiTheme.palette.mode, searchHighlightColors.currentMatch, searchHighlightColors.otherMatches, viewerBg, viewerText]
  );

  const setEditBaselineContent = useCallback((nextContent: string) => {
    editBaselineContentRef.current = nextContent;
  }, []);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const restoreEditingFocus = useCallback(() => {
    if (!isEditing) {
      return;
    }

    return scheduleRetriableFocusRestore({
      delaysMs: [0, 16, 48, 96],
      attemptRestore: () => {
        if (editorRef.current?.restorePreservedSelection() === true) {
          return true;
        }

        editorRef.current?.focus();
        return isTextEditorTextInputFocused();
      },
    });
  }, [isEditing]);

  const unsavedChangesDialogOpen = pendingUnsavedChangesAction !== null;
  const hasUnsavedChanges = isEditing && draftContent !== editBaselineContentRef.current;
  const editorShouldBeReadOnly = !isEditing || Boolean(isSaving && pendingUnsavedChangesAction);

  const {
    beginBaselineSyncWindow,
    clearBaselineSyncWindow,
    clearPendingBaselineSync,
    handleEditorChange,
    handleEditorUserEdit,
    markEditSessionPristine,
    requestRestoreEditingFocus,
  } = useMarkdownEditSession({
    isEditing,
    isSaving,
    contentRef,
    hasPendingUnsavedChangesAction: unsavedChangesDialogOpen,
    restoreEditingFocus,
    setDraftContent,
    setEditBaselineContent,
  });

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
        if (!isEditingRef.current) {
          setDraftContent(data);
          setEditBaselineContent(data);
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          return;
        }

        if (checkIsTransientError(err)) {
          setError(getTransientErrorMessage(err, t("errors.failedToLoadFile")));
        } else {
          setError(getApiErrorMessage(err, t("errors.failedToLoadFile"), { includeOriginalMessage: true }));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadContent();

    return () => {
      abortController.abort();
    };
  }, [connectionId, fetchWithRetry, path, setEditBaselineContent, t]);

  const releaseEditLock = useCallback(async () => {
    if (!editLockInfo) {
      return;
    }

    try {
      await apiService.releaseEditLock(connectionId, path, editLockInfo);
    } catch (err) {
      logError("Failed to release text edit lock", { error: err, path, connectionId });
    } finally {
      setEditLockInfo(null);
    }
  }, [connectionId, editLockInfo, path]);

  useEffect(() => {
    lockHeldRef.current = editLockInfo;
  }, [editLockInfo]);

  useEffect(() => {
    if (!isEditing || !editLockInfo) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void apiService.heartbeatEditLock(connectionId, path, editLockInfo).catch((err) => {
        logError("Failed to refresh text edit lock", { error: err, path, connectionId });
      });
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connectionId, editLockInfo, isEditing, path]);

  useEffect(() => {
    return () => {
      if (lockHeldRef.current) {
        void apiService.releaseEditLock(connectionId, path, lockHeldRef.current).catch((err) => {
          logError("Failed to release text edit lock during cleanup", { error: err, path, connectionId });
        });
      }
    };
  }, [connectionId, path]);

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
    prefetchedShareFileRef.current = null;
    sharePrefetchPromiseRef.current = null;
  }, [loadShareFile]);

  const handleDownload = useCallback(async () => {
    try {
      await apiService.downloadFile(connectionId, path, filename);
    } catch (err) {
      logError("Failed to download file", { error: err, path, connectionId });
    }
  }, [connectionId, filename, path]);

  const handleShareIntent = useCallback(() => {
    if (!shareWarmEnabled) {
      return;
    }

    void loadShareFile();
  }, [loadShareFile, shareWarmEnabled]);

  const handleShare = useCallback(async () => {
    setShareError(null);
    setSharing(true);

    try {
      const shareFile = await loadShareFile();
      const result = await shareNativeContent({ file: shareFile, title: filename, text: content });
      if (result === "unsupported") {
        setShareError(t("viewer.share.unsupported"));
      }
    } catch (err) {
      logError("Failed to share text file", { error: err, path, connectionId });
      setShareError(t("viewer.share.failed"));
    } finally {
      setSharing(false);
    }
  }, [connectionId, content, filename, loadShareFile, path, t]);

  useEffect(() => {
    setSearchMatches(editorSearchState.searchMatches);
    setCurrentSearchMatch(editorSearchState.currentMatch);

    if (searchPanelOpen && !editorSearchState.isSearchable) {
      setSearchPanelOpen(false);
    }
  }, [editorSearchState.currentMatch, editorSearchState.isSearchable, editorSearchState.searchMatches, searchPanelOpen]);

  const exitEditMode = useCallback(
    async (nextContent = content) => {
      clearPendingBaselineSync();
      clearBaselineSyncWindow();
      await releaseEditLock();
      setDraftContent(nextContent);
      setEditBaselineContent(nextContent);
      markEditSessionPristine();
      setEditError(null);
      setEditorBoundaryKey((previousKey) => previousKey + 1);
      setIsEditing(false);
      setPendingUnsavedChangesAction(null);
    },
    [clearBaselineSyncWindow, clearPendingBaselineSync, content, markEditSessionPristine, releaseEditLock, setEditBaselineContent]
  );

  const closeViewer = useCallback(async () => {
    clearPendingBaselineSync();
    clearBaselineSyncWindow();
    await releaseEditLock();
    setPendingUnsavedChangesAction(null);
    onClose();
  }, [clearBaselineSyncWindow, clearPendingBaselineSync, onClose, releaseEditLock]);

  const handleEnterEditMode = useCallback(async () => {
    if (isReadOnly || loading || error || exceedsEditorLimit) {
      return;
    }

    setEditError(null);

    try {
      if (supportsEditLocks) {
        const lockInfo = await apiService.acquireEditLock(connectionId, path, editSessionIdRef.current);
        setEditLockInfo(lockInfo);
      }

      setDraftContent(content);
      setEditBaselineContent(content);
      clearPendingBaselineSync();
      beginBaselineSyncWindow();
      markEditSessionPristine();
      setSearchAutoNavigate(true);
      setEditorBoundaryKey((previousKey) => previousKey + 1);
      setIsEditing(true);
    } catch (err) {
      const message = getApiErrorMessage(err, t("viewer.text.lockFailedReason"), { includeOriginalMessage: true });
      setEditError(t("viewer.text.lockFailed", { message }));
      logError("Failed to enter text edit mode", { error: err, path, connectionId });
    }
  }, [beginBaselineSyncWindow, clearPendingBaselineSync, connectionId, content, error, exceedsEditorLimit, isReadOnly, loading, markEditSessionPristine, path, setEditBaselineContent, supportsEditLocks, t]);

  const handleCancelEdit = useCallback(async () => {
    if (hasUnsavedChanges) {
      preserveTextEditorSelection(editorRef);
      setPendingUnsavedChangesAction("cancel-edit");
      return;
    }

    await exitEditMode();
  }, [exitEditMode, hasUnsavedChanges]);

  const persistDraft = useCallback(
    async (afterSave: PendingUnsavedChangesAction = "stay-edit") => {
      if (!isEditing || isReadOnly) {
        return false;
      }

      if (afterSave === "stay-edit") {
        requestRestoreEditingFocus();
        editorRef.current?.preserveSelection();
      }

      setEditError(null);
      setIsSaving(true);

      try {
        let savedContent = draftContent;
        if (editorRef.current) {
          await editorRef.current.flushPendingEdits();
          savedContent = editorRef.current.getCanonicalText();
        }

        await apiService.saveTextFile(connectionId, path, savedContent, { filename });
        setContent(savedContent);
        setEditBaselineContent(savedContent);
        clearBaselineSyncWindow();
        markEditSessionPristine();

        if (afterSave === "close-viewer") {
          await closeViewer();
        } else if (afterSave === "cancel-edit") {
          await exitEditMode(savedContent);
        }

        return true;
      } catch (err) {
        setEditError(getApiErrorMessage(err, t("viewer.text.saveFailed"), { includeOriginalMessage: true }));
        logError("Failed to save text file", { error: err, path, connectionId });
        return false;
      } finally {
        setIsSaving(false);
        if (afterSave === "stay-edit") {
          window.requestAnimationFrame(() => {
            restoreEditingFocus();
          });
        }
      }
    },
    [clearBaselineSyncWindow, closeViewer, connectionId, draftContent, exitEditMode, filename, isEditing, isReadOnly, markEditSessionPristine, path, requestRestoreEditingFocus, restoreEditingFocus, setEditBaselineContent, t]
  );

  const handleSave = useCallback(async () => {
    await persistDraft("stay-edit");
  }, [persistDraft]);

  const handleRequestClose = useCallback(async () => {
    if (isEditing && hasUnsavedChanges) {
      preserveTextEditorSelection(editorRef);
      setPendingUnsavedChangesAction("close-viewer");
      return;
    }

    await closeViewer();
  }, [closeViewer, hasUnsavedChanges, isEditing]);

  const closeSearchPanel = useCallback(
    ({ preserveQuery, restoreEditorFocus }: { preserveQuery: boolean; restoreEditorFocus: boolean }) => {
      setSearchPanelOpen(false);

      if (!preserveQuery) {
        setSearchText("");
        setSearchAutoNavigate(true);
      }

      if (!restoreEditorFocus) {
        return;
      }

      editorRef.current?.focusCurrentSearchResult();
    },
    []
  );

  const handleEscape = useCallback(() => {
    if (searchPanelOpen || isViewerSearchInputFocused()) {
      closeSearchPanel({ preserveQuery: true, restoreEditorFocus: true });
    } else if (isEditing) {
      void handleCancelEdit();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      void handleRequestClose();
    }
  }, [closeSearchPanel, handleCancelEdit, handleRequestClose, isEditing, searchPanelOpen]);

  const handleOpenSearch = useCallback(() => {
    if (loading || error || exceedsEditorLimit || !editorSearchState.isSearchable) {
      return;
    }

    const selectedText = editorRef.current?.getPrimarySelectionText() ?? "";
    setSearchAutoNavigate(false);
    if (selectedText.length > 0) {
      setSearchText(selectedText);
    }
    setSearchPanelOpen(true);
  }, [editorSearchState.isSearchable, error, exceedsEditorLimit, loading]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchAutoNavigate(false);
    setSearchText(text);
  }, []);

  const handleSearchPanelToggle = useCallback(
    (open: boolean) => {
      if (open) {
        setSearchPanelOpen(true);
        return;
      }

      closeSearchPanel({ preserveQuery: true, restoreEditorFocus: false });
    },
    [closeSearchPanel]
  );

  const handleSearchClose = useCallback(
    (reason: TextSearchCloseReason) => {
      closeSearchPanel({ preserveQuery: true, restoreEditorFocus: reason === "escape" });
    },
    [closeSearchPanel]
  );

  const handleSearchNext = useCallback(() => {
    if (searchMatches === 0) {
      return;
    }

    editorRef.current?.focusCurrentSearchResult();
    editorRef.current?.nextSearchResult();
  }, [searchMatches]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatches === 0) {
      return;
    }

    editorRef.current?.focusCurrentSearchResult();
    editorRef.current?.previousSearchResult();
  }, [searchMatches]);

  const handlePaperKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (unsavedChangesDialogOpen || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isTextEditorTextInputFocused()) {
        handleEscape();
        return;
      }

      if (blurActiveToolbarControl(contentRef)) {
        return;
      }

      handleEscape();
    },
    [handleEscape, unsavedChangesDialogOpen]
  );

  const handleToggleFullscreen = useCallback(() => {
    if (!dialogRef.current) {
      return;
    }

    if (!document.fullscreenElement) {
      dialogRef.current.requestFullscreen().catch((err) => {
        logError("Failed to enable fullscreen", { error: err });
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  const textShortcuts = useMemo(
    () => [
      { ...COMMON_SHORTCUTS.DOWNLOAD, handler: handleDownload },
      { ...COMMON_SHORTCUTS.SEARCH, handler: handleOpenSearch, enabled: !loading && !error && !exceedsEditorLimit && editorSearchState.isSearchable },
      { ...COMMON_SHORTCUTS.NEXT_MATCH, handler: handleSearchNext, enabled: searchMatches > 0 },
      { ...COMMON_SHORTCUTS.PREVIOUS_MATCH, handler: handleSearchPrevious, enabled: searchMatches > 0 },
      { ...COMMON_SHORTCUTS.EDIT, handler: () => void handleEnterEditMode(), enabled: !isEditing && !isReadOnly && !exceedsEditorLimit },
      { ...COMMON_SHORTCUTS.SAVE, handler: () => void handleSave(), allowInInput: true, enabled: isEditing && !isSaving },
      { ...VIEWER_SHORTCUTS.FULLSCREEN, handler: handleToggleFullscreen },
      { ...COMMON_SHORTCUTS.CLOSE, handler: handleEscape, allowInInput: false, enabled: !unsavedChangesDialogOpen },
      { ...BROWSER_SHORTCUTS.SHOW_HELP, handler: () => setShowHelp(true) },
    ],
    [editorSearchState.isSearchable, error, exceedsEditorLimit, handleDownload, handleEnterEditMode, handleEscape, handleOpenSearch, handleSave, handleSearchNext, handleSearchPrevious, handleToggleFullscreen, isEditing, isReadOnly, isSaving, loading, searchMatches, unsavedChangesDialogOpen]
  );

  useKeyboardShortcuts({
    active: !showHelp,
    shortcuts: textShortcuts,
    inputSelector: "input, textarea",
  });

  const toolbarActions = useMemo(
    () =>
      isEditing
        ? [
            createSaveToolbarAction({
              id: "save-text",
              onClick: () => {
                void handleSave();
              },
              isMobile,
              disabled: isSaving || exceedsEditorLimit,
            }),
          ]
        : [
            ...(isReadOnly
              ? []
              : [
                  createEditToolbarAction({
                    id: "edit-text",
                    onClick: () => {
                      void handleEnterEditMode();
                    },
                    isMobile,
                    disabled: loading || !!error || exceedsEditorLimit,
                  }),
                ]),
          ],
    [error, exceedsEditorLimit, handleEnterEditMode, handleSave, isEditing, isMobile, isReadOnly, isSaving, loading]
  );

  const unsavedChangesIndicator = hasUnsavedChanges ? (
    <Box
      component="span"
      role="status"
      aria-label={t("viewer.edit.unsavedIndicatorAria")}
      title={t("viewer.edit.unsavedIndicator")}
      sx={{ width: isMobile ? 7 : 8, height: isMobile ? 7 : 8, borderRadius: "50%", backgroundColor: toolbarText, opacity: 1, flexShrink: 0, alignSelf: "flex-start", mt: "-0.26em" }}
    />
  ) : null;

  const readOnlyIndicator = isReadOnly ? (
    <ViewerFilenameBadge label={t("settings.connectionDialog.accessMode.readOnlyLabel")} toolbarText={toolbarText} />
  ) : null;

  const filenameAdornment =
    unsavedChangesIndicator || readOnlyIndicator ? (
      <Box sx={{ display: "flex", alignItems: "center", gap: isMobile ? 0.75 : 1 }}>
        {unsavedChangesIndicator}
        {readOnlyIndicator}
      </Box>
    ) : null;

  const handleDialogClose = useCallback(
    (_event: unknown, reason: string) => {
      if (reason === "escapeKeyDown") {
        return;
      }

      void handleRequestClose();
    },
    [handleRequestClose]
  );

  useEffect(() => {
    logInfo("Text viewer opened", { filename, path });
  }, [filename, path]);

  useEffect(() => {
    return () => {
      logInfo("Text viewer closed");
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    };
  }, []);

  return (
    <>
      <Dialog
        open={true}
        onClose={handleDialogClose}
        maxWidth={false}
        fullScreen
        ref={dialogRef}
        disableEnforceFocus
        sx={{
          "& .MuiDialog-container": {
            alignItems: "stretch",
            justifyContent: "stretch",
          },
        }}
        slotProps={{
          paper: {
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
          },
        }}
      >
        <Box sx={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box" }}>
          <Box sx={{ flexShrink: 0, zIndex: 1 }}>
            <ViewerControls
              filename={filename}
              filenameAdornment={filenameAdornment}
              toolbarBackground={toolbarBg}
              toolbarText={toolbarText}
              actions={toolbarActions}
              config={{ download: true, share: shareEnabled, search: !exceedsEditorLimit }}
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
                onSearchClose: handleSearchClose,
                clearSearchOnClose: false,
                isSearchable: !exceedsEditorLimit && editorSearchState.isSearchable,
                searchUnavailableTitle: exceedsEditorLimit ? t("viewer.text.limitSearchUnavailable") : undefined,
              }}
              onDownload={handleDownload}
              onShare={handleShare}
              onShareIntent={handleShareIntent}
              shareDisabled={sharing}
            />
          </Box>

          {editError ? <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>{editError}</Alert> : null}
          {shareError ? <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>{shareError}</Alert> : null}

          <Box ref={contentRef} data-testid="text-viewer-content" tabIndex={0} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, width: "100%", paddingBottom: "env(safe-area-inset-bottom, 0px)", backgroundColor: viewerBg, "&:focus": { outline: "none" } }}>
            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
                <CircularProgress />
              </Box>
            ) : error ? (
              <Box sx={{ p: 2 }}>
                <Alert severity="error">{error}</Alert>
              </Box>
            ) : exceedsEditorLimit ? (
              <Box sx={{ p: 2, overflow: "auto" }}>
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("viewer.text.limitMessage", {
                    currentSizeMb: (contentSizeBytes / (1024 * 1024)).toFixed(1),
                    maxSizeMb: (maxFileSizeBytes / (1024 * 1024)).toFixed(0),
                  })}
                </Alert>
                <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: viewerText, fontFamily: "monospace" }}>
                  {content}
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  p: 0,
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  overflow: "hidden",
                  "& .sambee-text-editor": {
                    flex: 1,
                    minHeight: 0,
                  },
                  "& .sambee-text-editor .cm-content": {
                    p: "16px 20px",
                  },
                }}
              >
                <MarkdownEditorErrorBoundary
                  key={editorBoundaryKey}
                  title={t("viewer.text.editorCrashTitle")}
                  description={t("viewer.text.editorCrashMessage")}
                  retryLabel={t("viewer.edit.retryEditor")}
                  returnToPreviewLabel={t("viewer.edit.returnToPreview")}
                  onError={() => {}}
                  onRetry={() => {
                    setEditError(null);
                    setEditorBoundaryKey((previousKey) => previousKey + 1);
                  }}
                  onReturnToPreview={() => {
                    void handleCancelEdit();
                  }}
                >
                  <TextCodeEditor
                    ref={editorRef}
                    className="sambee-text-editor"
                    text={isEditing ? draftContent : content}
                    filename={filename}
                    theme={textEditorTheme}
                    onChange={handleEditorChange}
                    onUserEdit={handleEditorUserEdit}
                    ariaLabel={t("viewer.text.editorLabel")}
                    autoFocus={true}
                    readOnly={editorShouldBeReadOnly}
                    searchText={searchPanelOpen ? searchText : ""}
                    searchOpen={searchPanelOpen}
                    searchAutoNavigate={searchAutoNavigate}
                    onSearchStateChange={(nextState) => {
                      setEditorSearchState((previousState) =>
                        areTextEditorSearchStatesEqual(previousState, nextState) ? previousState : nextState
                      );
                    }}
                  />
                </MarkdownEditorErrorBoundary>
              </Box>
            )}
          </Box>
        </Box>
      </Dialog>

      <Dialog
        open={unsavedChangesDialogOpen}
        onClose={() => {
          if (!isSaving) {
            setPendingUnsavedChangesAction(null);
          }
        }}
        aria-labelledby="text-unsaved-changes-title"
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
      >
        <DialogTitle id="text-unsaved-changes-title">{t("viewer.edit.unsavedChangesTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "text.primary" }}>
            {pendingUnsavedChangesAction === "close-viewer"
              ? t("viewer.edit.unsavedChangesCloseMessage")
              : t("viewer.edit.unsavedChangesExitMessage")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button ref={unsavedChangesCancelButtonRef} onClick={() => setPendingUnsavedChangesAction(null)} disabled={isSaving} autoFocus>
            {t("common.actions.cancel")}
          </Button>
          <Button
            onClick={() => {
              if (pendingUnsavedChangesAction === "close-viewer") {
                void closeViewer();
              } else {
                void exitEditMode();
              }
            }}
            disabled={isSaving}
            color="warning"
          >
            {t("common.actions.discard")}
          </Button>
          <Button
            onClick={() => {
              if (pendingUnsavedChangesAction) {
                void persistDraft(pendingUnsavedChangesAction);
              }
            }}
            disabled={isSaving}
            variant="contained"
          >
            {t("common.actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <KeyboardShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} shortcuts={textShortcuts} title={t("keyboardShortcutsHelp.titles.textViewer")} />
    </>
  );
};

export default memo(TextViewer);
