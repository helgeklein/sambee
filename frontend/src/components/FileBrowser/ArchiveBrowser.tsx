import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import type { ArchiveEntryInfo } from "../../types";

interface ArchiveBrowserProps {
  connectionId: string;
  archivePath: string;
  onClose: () => void;
}

export function ArchiveBrowser({ connectionId, archivePath, onClose }: ArchiveBrowserProps) {
  const { t } = useTranslation();
  const [virtualPath, setVirtualPath] = useState("");
  const [items, setItems] = useState<ArchiveEntryInfo[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api
      .listArchiveDirectory(connectionId, archivePath, virtualPath, {
        cursor: pageCursor ?? undefined,
        pageSize: 100,
        signal: controller.signal,
      })
      .then((listing) => {
        if (!controller.signal.aborted) {
          setItems((currentItems) => (pageCursor ? [...currentItems, ...listing.items] : listing.items));
          setNextCursor(listing.next_cursor ?? null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(t("fileBrowser.archive.browseError"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [archivePath, connectionId, pageCursor, t, virtualPath]);

  const downloadMember = async (memberPath: string) => {
    try {
      const data = await api.getArchiveMember(connectionId, archivePath, memberPath, true);
      const href = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = href;
      link.download = memberPath.split("/").at(-1) ?? "archive-member";
      link.click();
      URL.revokeObjectURL(href);
    } catch {
      setError(t("fileBrowser.archive.downloadError"));
    }
  };

  const navigateUp = () => {
    const parts = virtualPath.split("/");
    parts.pop();
    setPageCursor(null);
    setVirtualPath(parts.join("/"));
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: (theme) => theme.zIndex.modal,
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <IconButton aria-label={t("fileBrowser.archive.closeBrowser")} onClick={onClose} edge="start">
            <ArrowBackIcon />
          </IconButton>
          <Box sx={{ ml: 2, minWidth: 0, flex: 1 }}>
            <Typography noWrap variant="h6">
              {archivePath.split("/").at(-1)}
            </Typography>
            <Typography noWrap variant="body2" color="text.secondary">
              {virtualPath || t("fileBrowser.archive.root")}
            </Typography>
          </Box>
          <Button onClick={navigateUp} disabled={!virtualPath}>
            {t("fileBrowser.archive.up")}
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: "auto", maxWidth: 960, width: "100%", mx: "auto", p: { xs: 1, sm: 2 } }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", minHeight: 180 }}>
            <CircularProgress />
          </Box>
        ) : (
          <List disablePadding>
            {items.map((item) => (
              <ListItemButton
                key={item.path}
                disabled={item.state !== "readable"}
                onClick={() => {
                  if (item.type === "directory") {
                    setPageCursor(null);
                    setVirtualPath(item.path);
                  } else {
                    void downloadMember(item.path);
                  }
                }}
              >
                <ListItemIcon>{item.type === "directory" ? <FolderIcon /> : <InsertDriveFileIcon />}</ListItemIcon>
                <ListItemText
                  primary={item.name}
                  secondary={item.state === "readable" ? undefined : t("fileBrowser.archive.entryUnavailable")}
                />
                {item.type === "file" && item.state === "readable" ? <DownloadIcon color="action" /> : null}
              </ListItemButton>
            ))}
          </List>
        )}
        {nextCursor ? <Button onClick={() => setPageCursor(nextCursor)}>{t("fileBrowser.archive.more")}</Button> : null}
      </Box>
    </Box>
  );
}
