import { Alert, Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
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
      if (typeof data.detail === "string") {
        return data.detail;
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

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  // Load markdown content
  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiService.getFileContent(connectionId, path);
        setContent(data);
      } catch (err) {
        const errorMessage = getErrorMessage(err);
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
  }, [connectionId, path]);

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
    (_event?: KeyboardEvent) => {
      const downloadUrl = apiService.getDownloadUrl(connectionId, path);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      link.click();
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

  // Context-aware Escape handler
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
        ref={dialogRef}
        sx={{
          "& .MuiDialog-container": {
            alignItems: "stretch",
            justifyContent: "stretch",
          },
        }}
        PaperProps={{
          sx: {
            margin: 0,
            width: "100dvw",
            maxWidth: "100dvw",
            height: "100dvh",
            maxHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#fff",
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
              <Box
                sx={{
                  // Layout
                  minHeight: 0,
                  minWidth: 0,
                  width: "100%",
                  maxWidth: "100%",
                  p: { xs: 2, sm: 4 },

                  // Ensure all children respect container width
                  "& *": {
                    boxSizing: "border-box",
                    minWidth: 0,
                    maxWidth: "100%",
                  },

                  // Code blocks: fixed width with internal scrolling
                  "& pre": {
                    backgroundColor: "#f6f8fa",
                    borderRadius: 1,
                    p: { xs: 1, sm: 2 },
                    overflow: "auto",
                    width: "100%",
                  },

                  // Inline code: break long words
                  "& code": {
                    backgroundColor: "#f6f8fa",
                    padding: "0.2em 0.4em",
                    borderRadius: "3px",
                    fontSize: "0.9em",
                    overflowWrap: "break-word",
                  },

                  // Code inside pre: preserve formatting (don't break)
                  "& pre code": {
                    padding: 0,
                    backgroundColor: "transparent",
                    overflowWrap: "normal",
                  },

                  // Images: scale to fit
                  "& img": {
                    maxWidth: "100%",
                    height: "auto",
                    display: "block",
                  },

                  // Tables: horizontal scroll if too wide
                  "& table": {
                    borderCollapse: "collapse",
                    width: "100%",
                    marginBottom: "16px",
                    display: "block",
                    overflowX: "auto",
                  },
                  "& table td, & table th": {
                    border: "1px solid #dfe2e5",
                    padding: "6px 13px",
                  },
                  "& table tr": {
                    backgroundColor: "#fff",
                    borderTop: "1px solid #c6cbd1",
                  },
                  "& table tr:nth-of-type(even)": {
                    backgroundColor: "#f6f8fa",
                  },

                  // Blockquotes
                  "& blockquote": {
                    borderLeft: "4px solid #dfe2e5",
                    margin: "0",
                    paddingLeft: "16px",
                    color: "#6a737d",
                  },

                  // Headings: break long words
                  "& h1, & h2, & h3, & h4, & h5, & h6": {
                    marginTop: "24px",
                    marginBottom: "16px",
                    fontWeight: 600,
                    lineHeight: 1.25,
                    overflowWrap: "break-word",
                  },
                  "& h1": {
                    paddingBottom: "0.3em",
                    fontSize: "2em",
                    borderBottom: "1px solid #eaecef",
                  },
                  "& h2": {
                    paddingBottom: "0.3em",
                    fontSize: "1.5em",
                    borderBottom: "1px solid #eaecef",
                  },
                  "& h3": {
                    fontSize: "1.25em",
                  },

                  // Links
                  "& a": {
                    color: "#0366d6",
                    textDecoration: "none",
                    overflowWrap: "break-word",
                    "&:hover": {
                      textDecoration: "underline",
                    },
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

      {/* Keyboard Shortcuts Help Dialog */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={markdownShortcuts}
        title="Markdown Viewer Shortcuts"
      />
    </>
  );
};

export default MarkdownViewer;
