import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
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
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import type { ArchiveEntryInfo } from "../../types";
import { ArchiveExtractDialog } from "./ArchiveExtractDialog";
import { ArchiveExtractionConflictDialog } from "./ArchiveExtractionConflictDialog";

interface ArchiveBrowserProps {
  connectionId: string;
  archivePath: string;
  onClose: () => void;
}

export function ArchiveBrowser({ connectionId, archivePath, onClose }: ArchiveBrowserProps) {
  const { t } = useTranslation();
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const [virtualPath, setVirtualPath] = useState("");
  const [items, setItems] = useState<ArchiveEntryInfo[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [pendingExtraction, setPendingExtraction] = useState<{
    operationId: string;
    conflicts: Array<{ member_path: string; target_path: string; is_directory?: boolean }>;
  } | null>(null);

  useEffect(() => {
    triggerElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const triggerElement = triggerElementRef.current;
      if (triggerElement?.isConnected) {
        requestAnimationFrame(() => triggerElement.focus());
      }
    };
  }, []);

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

  const extractArchive = async (destinationPath: string) => {
    setIsExtracting(true);
    setExtractError(null);
    try {
      const operation = await api.prepareArchiveOperation({
        kind: "extract",
        source_connection_id: connectionId,
        source_path: archivePath,
        destination_connection_id: connectionId,
        destination_path: destinationPath,
      });
      const result = await api.executeArchiveExtraction(operation.id);
      setExtractDialogOpen(false);
      if (result.phase === "awaiting_user_decision") {
        const pendingDecision = JSON.parse(result.pending_decision_json ?? "{}");
        const conflicts = Array.isArray(pendingDecision.conflicts) ? pendingDecision.conflicts : [];
        setPendingExtraction({ operationId: result.id, conflicts });
      } else {
        setExtractNotice(t("fileBrowser.archive.extractSuccess"));
      }
    } catch {
      setExtractError(t("fileBrowser.archive.extractError"));
    } finally {
      setIsExtracting(false);
    }
  };

  const resolveExtractionConflict = async (
    action: "skip" | "skip_all" | "replace" | "replace_all" | "rename" | "cancel",
    memberPath?: string,
    targetPath?: string
  ) => {
    if (!pendingExtraction) return;
    setIsExtracting(true);
    setExtractError(null);
    try {
      const decision = await api.decideArchiveExtraction(pendingExtraction.operationId, action, memberPath, targetPath);
      if (decision.phase === "streaming") {
        const result = await api.executeArchiveExtraction(decision.id);
        if (result.phase === "awaiting_user_decision") {
          const pendingDecision = JSON.parse(result.pending_decision_json ?? "{}");
          const conflicts = Array.isArray(pendingDecision.conflicts) ? pendingDecision.conflicts : [];
          setPendingExtraction({ operationId: result.id, conflicts });
          return;
        }
        setExtractNotice(t("fileBrowser.archive.extractSuccess"));
      }
      setPendingExtraction(null);
    } catch {
      setExtractError(t("fileBrowser.archive.extractError"));
    } finally {
      setIsExtracting(false);
    }
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
          <Button startIcon={<UnarchiveIcon />} onClick={() => setExtractDialogOpen(true)}>
            {t("fileBrowser.archive.buttonExtract")}
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: "auto", maxWidth: 960, width: "100%", mx: "auto", p: { xs: 1, sm: 2 } }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {extractNotice ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {extractNotice}
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
      <ArchiveExtractDialog
        archivePath={archivePath}
        error={extractError}
        isExtracting={isExtracting}
        open={extractDialogOpen}
        onClose={() => setExtractDialogOpen(false)}
        onConfirm={extractArchive}
      />
      <ArchiveExtractionConflictDialog
        key={pendingExtraction?.conflicts.map((conflict) => conflict.member_path).join("\u0000") ?? "no-conflicts"}
        conflicts={pendingExtraction?.conflicts ?? []}
        error={extractError}
        isSubmitting={isExtracting}
        open={pendingExtraction !== null}
        onDecision={resolveExtractionConflict}
      />
    </Box>
  );
}
