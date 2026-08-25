import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import { Alert, AppBar, Box, Button, CircularProgress, Dialog, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import { getCompatibleViewerIds, getFileTypeByExtension } from "../../utils/FileTypeRegistry";

const MAX_ARCHIVE_PREVIEW_BYTES = 5 * 1024 * 1024;

type PreviewKind = "image" | "pdf" | "text" | null;

interface ArchiveMemberPreviewProps {
  connectionId: string;
  archivePath: string;
  member: { name: string; path: string; size?: number | null };
  onClose: () => void;
}

function getPreviewKind(filename: string, mimeType: string): PreviewKind {
  const fileType = getFileTypeByExtension(filename);
  if (mimeType.startsWith("image/") || fileType?.category === "image") return "image";
  if (mimeType === "application/pdf" || fileType?.mimeTypes.includes("application/pdf")) return "pdf";
  if (mimeType.startsWith("text/") || fileType?.category === "text") return "text";
  return null;
}

function ArchiveTextPreview({ blob }: { blob: Blob }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void blob.text().then((value) => {
      if (active) setContent(value);
    });
    return () => {
      active = false;
    };
  }, [blob]);

  return content === null ? (
    <CircularProgress aria-label="Loading preview" />
  ) : (
    <Box component="pre" sx={{ m: 0, p: 2, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
      {content}
    </Box>
  );
}

export function canPreviewArchiveMember(filename: string, size?: number | null): boolean {
  if (size !== undefined && size !== null && size > MAX_ARCHIVE_PREVIEW_BYTES) return false;
  const fileType = getFileTypeByExtension(filename);
  const mimeType = fileType?.mimeTypes[0] ?? "application/octet-stream";
  return getCompatibleViewerIds(filename, mimeType).length > 0;
}

export function ArchiveMemberPreview({ connectionId, archivePath, member, onClose }: ArchiveMemberPreviewProps) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (member.size !== undefined && member.size !== null && member.size > MAX_ARCHIVE_PREVIEW_BYTES) {
      setError(t("fileBrowser.archive.previewTooLarge"));
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setBlob(null);
    setError(null);
    setLoading(true);
    void api
      .getArchiveMember(connectionId, archivePath, member.path)
      .then((data) => {
        if (active) setBlob(data);
      })
      .catch(() => {
        if (active) setError(t("fileBrowser.archive.previewError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archivePath, connectionId, member.path, member.size, t]);

  useEffect(() => {
    if (!blob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const downloadMember = () => {
    if (!blob || !objectUrl) return;
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = member.name;
    link.click();
  };

  const mimeType = blob?.type || getFileTypeByExtension(member.name)?.mimeTypes[0] || "application/octet-stream";
  const previewKind = getPreviewKind(member.name, mimeType);

  return (
    <Dialog fullScreen open onClose={onClose} aria-labelledby="archive-member-preview-title">
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <Tooltip title={t("common.actions.close")}>
            <IconButton aria-label={t("common.actions.close")} onClick={onClose} edge="start">
              <CloseIcon />
            </IconButton>
          </Tooltip>
          <Typography id="archive-member-preview-title" noWrap variant="h6" sx={{ ml: 2, flex: 1 }}>
            {member.name}
          </Typography>
          <Tooltip title={t("fileBrowser.archive.download")}>
            <span>
              <IconButton aria-label={t("fileBrowser.archive.download")} onClick={downloadMember} disabled={!blob || !objectUrl}>
                <DownloadIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "grid",
          placeItems: loading || error || !previewKind ? "center" : undefined,
        }}
      >
        {loading ? <CircularProgress aria-label={t("fileBrowser.archive.previewLoading")} /> : null}
        {error ? <Alert severity="warning">{error}</Alert> : null}
        {!loading && !error && previewKind === "image" && objectUrl ? (
          <Box
            component="img"
            src={objectUrl}
            alt={member.name}
            sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", m: "auto" }}
          />
        ) : null}
        {!loading && !error && previewKind === "pdf" && objectUrl ? (
          <Box component="iframe" title={member.name} src={objectUrl} sx={{ border: 0, width: "100%", height: "100%" }} />
        ) : null}
        {!loading && !error && previewKind === "text" && blob ? <ArchiveTextPreview blob={blob} /> : null}
        {!loading && !error && previewKind === null ? (
          <Box sx={{ textAlign: "center" }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("fileBrowser.archive.previewUnavailable")}
            </Alert>
            <Button startIcon={<DownloadIcon />} onClick={downloadMember}>
              {t("fileBrowser.archive.download")}
            </Button>
          </Box>
        ) : null}
      </Box>
    </Dialog>
  );
}
