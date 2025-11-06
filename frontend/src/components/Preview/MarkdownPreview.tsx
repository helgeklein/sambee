import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { apiService } from "../../services/api";
import "highlight.js/styles/github.css";

interface MarkdownPreviewProps {
  connectionId: string;
  path: string;
  onClose: () => void;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  connectionId,
  path,
  onClose,
}) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiService.getFileContent(connectionId, path);
        setContent(data);
      } catch (err) {
        setError("Failed to load markdown file");
        console.error("Error loading markdown:", err);
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

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  return (
    <Dialog
      open={true}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="xl"
      sx={{
        // Ensure dialog container never exceeds viewport width
        "& .MuiDialog-container": {
          width: "100vw",
          maxWidth: "100vw",
        },
        // Constrain paper element to viewport on mobile, with margins on desktop
        "& .MuiDialog-paper": {
          width: { xs: "100vw", sm: "calc(100vw - 64px)" },
          maxWidth: { xs: "100vw", sm: "1200px" },
          height: { xs: "100vh", sm: "90vh" },
          margin: { xs: 0, sm: 4 },
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
          px: { xs: 2, sm: 3 },
          py: { xs: 1.5, sm: 2 },
        }}
      >
        <Typography variant="h6" component="div" sx={{ fontWeight: 500 }}>
          {filename}
        </Typography>
        <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        ref={contentRef}
        tabIndex={0}
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
          height: "100%",
          // Critical: prevent flex item from expanding beyond container
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
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
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {content}
            </ReactMarkdown>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MarkdownPreview;
