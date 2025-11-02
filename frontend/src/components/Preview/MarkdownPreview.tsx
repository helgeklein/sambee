import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Box, CircularProgress, Alert, Paper } from "@mui/material";
import { apiService } from "../../services/api";
import "highlight.js/styles/github.css";

interface MarkdownPreviewProps {
  connectionId: string;
  path: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  connectionId,
  path,
}) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100%"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={2}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Paper elevation={0} sx={{ p: 4, height: "100%", overflow: "auto" }}>
      <Box
        sx={{
          "& img": {
            maxWidth: "100%",
            height: "auto",
          },
          "& pre": {
            backgroundColor: "#f6f8fa",
            borderRadius: 1,
            p: 2,
            overflow: "auto",
          },
          "& code": {
            backgroundColor: "#f6f8fa",
            padding: "0.2em 0.4em",
            borderRadius: "3px",
            fontSize: "0.9em",
          },
          "& blockquote": {
            borderLeft: "4px solid #dfe2e5",
            margin: "0",
            paddingLeft: "16px",
            color: "#6a737d",
          },
          "& table": {
            borderCollapse: "collapse",
            width: "100%",
            marginBottom: "16px",
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
          "& h1, & h2, & h3, & h4, & h5, & h6": {
            marginTop: "24px",
            marginBottom: "16px",
            fontWeight: 600,
            lineHeight: 1.25,
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
          "& a": {
            color: "#0366d6",
            textDecoration: "none",
            "&:hover": {
              textDecoration: "underline",
            },
          },
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {content}
        </ReactMarkdown>
      </Box>
    </Paper>
  );
};

export default MarkdownPreview;
