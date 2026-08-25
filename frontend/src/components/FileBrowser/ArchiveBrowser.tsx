import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import {
  Alert,
  AppBar,
  Box,
  Breadcrumbs,
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
import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../pages/FileBrowser/formatters";
import api from "../../services/api";
import { isLocalDrive } from "../../services/backendRouter";
import type { ArchiveEntryInfo, ArchiveOperation } from "../../types";
import { ArchiveExtractDialog } from "./ArchiveExtractDialog";
import { ArchiveExtractionConflictDialog } from "./ArchiveExtractionConflictDialog";

const LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE = "local_archive_extraction_partial";

interface ArchiveBrowserProps {
  connectionId: string;
  archivePath: string;
  onClose: () => void;
  onExtracted?: (connectionId: string, archivePath: string) => void;
}

type ExtractionNotice = { message: string; severity: "info" | "success" };

function getSkippedMemberCount(operation: ArchiveOperation): number {
  try {
    const checkpoint: unknown = JSON.parse(operation.checkpoint_json);
    if (typeof checkpoint !== "object" || checkpoint === null || !("files_skipped" in checkpoint)) {
      return 0;
    }
    const filesSkipped = checkpoint.files_skipped;
    return typeof filesSkipped === "number" && Number.isSafeInteger(filesSkipped) && filesSkipped > 0 ? filesSkipped : 0;
  } catch {
    return 0;
  }
}

export function ArchiveBrowser({ connectionId, archivePath, onClose, onExtracted }: ArchiveBrowserProps) {
  const { t } = useTranslation();
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const [virtualPath, setVirtualPath] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [forwardPathHistory, setForwardPathHistory] = useState<string[]>([]);
  const [items, setItems] = useState<ArchiveEntryInfo[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractNotice, setExtractNotice] = useState<ExtractionNotice | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [activeExtractionOperationId, setActiveExtractionOperationId] = useState<string | null>(null);
  const [isCancellingExtraction, setIsCancellingExtraction] = useState(false);
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

  const navigateTo = (path: string) => {
    if (path === virtualPath) {
      return;
    }
    setPageCursor(null);
    setPathHistory((currentHistory) => [...currentHistory, virtualPath]);
    setForwardPathHistory([]);
    setVirtualPath(path);
  };

  const navigateUp = () => {
    navigateTo(virtualPath.includes("/") ? virtualPath.slice(0, virtualPath.lastIndexOf("/")) : "");
  };

  const navigateBack = () => {
    const previousPath = pathHistory.at(-1);
    if (previousPath === undefined) {
      return;
    }
    setPageCursor(null);
    setPathHistory((currentHistory) => currentHistory.slice(0, -1));
    setForwardPathHistory((currentHistory) => [...currentHistory, virtualPath]);
    setVirtualPath(previousPath);
  };

  const navigateForward = () => {
    const nextPath = forwardPathHistory.at(-1);
    if (nextPath === undefined) {
      return;
    }
    setPageCursor(null);
    setForwardPathHistory((currentHistory) => currentHistory.slice(0, -1));
    setPathHistory((currentHistory) => [...currentHistory, virtualPath]);
    setVirtualPath(nextPath);
  };

  const getExtractionNotice = (filesSkipped: number) =>
    filesSkipped > 0 ? t("fileBrowser.archive.extractPartialSuccess", { count: filesSkipped }) : t("fileBrowser.archive.extractSuccess");

  const setExtractionSuccessNotice = (filesSkipped: number) => {
    setExtractNotice({ message: getExtractionNotice(filesSkipped), severity: "success" });
  };

  const extractArchive = async (destinationPath: string) => {
    setIsExtracting(true);
    setExtractError(null);
    try {
      if (isLocalDrive(connectionId)) {
        const result = await api.extractLocalArchive(connectionId, archivePath, destinationPath);
        setExtractDialogOpen(false);
        setExtractionSuccessNotice(result.files_skipped);
        onExtracted?.(connectionId, archivePath);
        return;
      }
      const operation = await api.prepareArchiveOperation({
        kind: "extract",
        source_connection_id: connectionId,
        source_path: archivePath,
        destination_connection_id: connectionId,
        destination_path: destinationPath,
      });
      setActiveExtractionOperationId(operation.id);
      const result = await api.executeArchiveExtraction(operation.id);
      if (result.phase === "awaiting_user_decision") {
        setExtractDialogOpen(false);
        const pendingDecision = JSON.parse(result.pending_decision_json ?? "{}");
        const conflicts = Array.isArray(pendingDecision.conflicts) ? pendingDecision.conflicts : [];
        setPendingExtraction({ operationId: result.id, conflicts });
      } else if (result.phase === "completed") {
        setExtractDialogOpen(false);
        setExtractionSuccessNotice(getSkippedMemberCount(result));
      } else if (result.phase === "cancelled") {
        setExtractDialogOpen(false);
        setExtractNotice({ message: t("fileBrowser.archive.extractCancelled"), severity: "info" });
      } else {
        setExtractError(t("fileBrowser.archive.extractError"));
      }
    } catch (error) {
      const hasPartialLocalOutput = isAxiosError(error) && error.response?.data?.code === LOCAL_ARCHIVE_EXTRACTION_PARTIAL_CODE;
      if (hasPartialLocalOutput) {
        onExtracted?.(connectionId, archivePath);
      }
      setExtractError(
        hasPartialLocalOutput
          ? t("fileBrowser.archive.extractPartialOutputError")
          : isAxiosError(error) && error.response?.status === 409
            ? t("fileBrowser.archive.validationDestinationExists")
            : t("fileBrowser.archive.extractError")
      );
    } finally {
      setIsExtracting(false);
      setActiveExtractionOperationId(null);
      setIsCancellingExtraction(false);
    }
  };

  const cancelExtraction = async () => {
    if (!activeExtractionOperationId) {
      return;
    }
    setIsCancellingExtraction(true);
    try {
      await api.cancelArchiveOperation(activeExtractionOperationId);
    } catch {
      setExtractError(t("fileBrowser.archive.extractError"));
      setIsCancellingExtraction(false);
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
        if (result.phase === "completed") {
          setExtractionSuccessNotice(getSkippedMemberCount(result));
        } else if (result.phase === "cancelled") {
          setExtractNotice({ message: t("fileBrowser.archive.extractCancelled"), severity: "info" });
        } else {
          setExtractError(t("fileBrowser.archive.extractError"));
        }
      } else if (decision.phase === "cancelled") {
        setExtractNotice({ message: t("fileBrowser.archive.extractCancelled"), severity: "info" });
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
          <IconButton aria-label={t("fileBrowser.archive.historyBack")} disabled={pathHistory.length === 0} onClick={navigateBack}>
            <NavigateBeforeIcon />
          </IconButton>
          <IconButton
            aria-label={t("fileBrowser.archive.historyForward")}
            disabled={forwardPathHistory.length === 0}
            onClick={navigateForward}
          >
            <NavigateNextIcon />
          </IconButton>
          <Box sx={{ ml: 2, minWidth: 0, flex: 1 }}>
            <Typography noWrap variant="h6">
              {archivePath.split("/").at(-1)}
            </Typography>
            {virtualPath ? (
              <Breadcrumbs aria-label={t("fileBrowser.archive.breadcrumbs")} separator="/">
                <Button color="inherit" size="small" onClick={() => navigateTo("")}>
                  {t("fileBrowser.archive.root")}
                </Button>
                {virtualPath.split("/").map((part, index, parts) => {
                  const path = parts.slice(0, index + 1).join("/");
                  return index === parts.length - 1 ? (
                    <Typography key={path} noWrap variant="body2" color="text.secondary">
                      {part}
                    </Typography>
                  ) : (
                    <Button key={path} color="inherit" size="small" onClick={() => navigateTo(path)}>
                      {part}
                    </Button>
                  );
                })}
              </Breadcrumbs>
            ) : (
              <Typography noWrap variant="body2" color="text.secondary">
                {t("fileBrowser.archive.root")}
              </Typography>
            )}
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
          <Alert severity={extractNotice.severity} sx={{ mb: 2 }}>
            {extractNotice.message}
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
                disabled={item.type === "file" && item.state !== "readable"}
                onClick={() => {
                  if (item.type === "directory") {
                    navigateTo(item.path);
                  } else {
                    void downloadMember(item.path);
                  }
                }}
              >
                <ListItemIcon>{item.type === "directory" ? <FolderIcon /> : <InsertDriveFileIcon />}</ListItemIcon>
                <ListItemText
                  primary={item.name}
                  secondary={
                    item.state !== "readable"
                      ? t("fileBrowser.archive.entryUnavailable")
                      : item.type === "file"
                        ? formatFileSize(item.size ?? undefined)
                        : undefined
                  }
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
        isCancelling={isCancellingExtraction}
        isExtracting={isExtracting}
        open={extractDialogOpen}
        onCancelExtraction={activeExtractionOperationId ? cancelExtraction : undefined}
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
