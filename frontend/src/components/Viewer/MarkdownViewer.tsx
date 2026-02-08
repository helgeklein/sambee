import { Alert, Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../../hooks/useApiRetry";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import { getMarkdownContentStyles, getViewerColors } from "../../theme/viewerStyles";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { blurActiveToolbarControl } from "../../utils/keyboardUtils";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { ViewerControls } from "./ViewerControls";
import "highlight.js/styles/github.css";

/**
 * Extract error message from API error or exception
 */
const getErrorMessage = (err: unknown): string => {
  if (isApiError(err) && err.response?.data?.detail) {
    return err.response.data.detail;
  }
  if (isApiError(err) && err.message) {
    if (err.response?.data) {
      const data = err.response.data as Record<string, unknown>;
      if (typeof data["detail"] === "string") {
        return data["detail"];
      }
    }
    return `Failed to load markdown: ${err.message}`;
  }
  return "Failed to load markdown file";
};

/**
 * Markdown Viewer Component
 * Displays markdown files with syntax highlighting and GitHub-flavored markdown support.
 * Integrated with ViewerControls and keyboard shortcuts system.
 */
export const MarkdownViewer: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose }) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fetchWithRetry = useApiRetry();

  const { currentTheme } = useSambeeTheme();
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
      } catch (err) {
        if (abortController.signal.aborted) {
          return;
        }

        // Show "server busy" only for actual transient/network errors
        const errorMessage = checkIsTransientError(err) ? getTransientErrorMessage() : getErrorMessage(err);

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
  }, [connectionId, path, fetchWithRetry]);

  // Auto-focus the content when loaded so keyboard scrolling works
  useEffect(() => {
    if (!loading && !error && contentRef.current) {
      // Small delay to ensure dialog transition is complete
      setTimeout(() => {
        contentRef.current?.focus();
      }, 100);
    }
  }, [loading, error]);

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
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        onClose();
      }
    },
    [onClose]
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
      // Fullscreen
      {
        ...VIEWER_SHORTCUTS.FULLSCREEN,
        handler: handleToggleFullscreen,
      },
      // Close viewer or exit fullscreen on Escape
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleEscape,
      },
      // Show help
      {
        id: "show-help",
        keys: ["?"],
        label: "?",
        description: "Show keyboard shortcuts",
        handler: handleShowHelp,
      },
    ],
    [handleDownload, handleToggleFullscreen, handleEscape, handleShowHelp]
  );

  useKeyboardShortcuts({
    shortcuts: markdownShortcuts,
  });

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
        onClose={onClose}
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
              config={{
                download: true,
              }}
              onClose={onClose}
              onDownload={handleDownload}
            />
          </Box>

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
            ) : (
              <Box sx={getMarkdownContentStyles(viewerText)}>
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

      {/* Keyboard Shortcuts Help Dialog */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={markdownShortcuts}
        title="Markdown viewer shortcuts"
      />
    </>
  );
};

export default MarkdownViewer;
