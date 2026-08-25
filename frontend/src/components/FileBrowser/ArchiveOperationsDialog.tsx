import CancelIcon from "@mui/icons-material/Cancel";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../services/api";
import type { ArchiveOperation } from "../../types";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";

const OPERATION_STATUS_POLL_INTERVAL_MS = 2_000;

interface ArchiveOperationsDialogProps {
  open: boolean;
  onClose: () => void;
}

function operationTarget(operation: ArchiveOperation): string {
  return operation.destination_path || operation.source_path;
}

export function ArchiveOperationsDialog({ open, onClose }: ArchiveOperationsDialogProps) {
  const { t } = useTranslation();
  const [operations, setOperations] = useState<ArchiveOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingOperationId, setCancellingOperationId] = useState<string | null>(null);

  const loadOperations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOperations(await api.listArchiveOperations());
    } catch {
      setError(t("fileBrowser.archive.operationsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadOperations();
    const intervalId = window.setInterval(() => void loadOperations(), OPERATION_STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadOperations, open]);

  const cancelOperation = async (operationId: string) => {
    setCancellingOperationId(operationId);
    try {
      await api.cancelArchiveOperation(operationId);
      await loadOperations();
    } catch {
      setError(t("fileBrowser.archive.operationsLoadError"));
    } finally {
      setCancellingOperationId(null);
    }
  };

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      title={t("fileBrowser.archive.operationsTitle")}
      description={t("fileBrowser.archive.operationsDescription")}
      maxWidth="sm"
      contentSx={{ p: 2 }}
      actions={
        <>
          <Button
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={() => void loadOperations()}
            disabled={loading}
          >
            {t("fileBrowser.archive.operationsRefresh")}
          </Button>
          <Button variant="contained" onClick={onClose}>
            {t("common.actions.close")}
          </Button>
        </>
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && operations.length === 0 ? (
          <Typography color="text.secondary">{t("fileBrowser.archive.operationsEmpty")}</Typography>
        ) : null}
        <List disablePadding aria-label={t("fileBrowser.archive.operationsTitle")}>
          {operations.map((operation) => {
            const isTerminal = ["completed", "cancelled", "failed"].includes(operation.phase);
            const cancellationRequested = operation.cancellation_requested && !isTerminal;
            return (
              <ListItem
                key={operation.id}
                disableGutters
                secondaryAction={
                  !isTerminal ? (
                    <Button
                      color="inherit"
                      size="small"
                      startIcon={cancellingOperationId === operation.id ? <CircularProgress size={14} /> : <CancelIcon />}
                      disabled={cancellationRequested || cancellingOperationId !== null}
                      onClick={() => void cancelOperation(operation.id)}
                    >
                      {cancellationRequested
                        ? t("fileBrowser.archive.operationCancellationRequested")
                        : t("fileBrowser.archive.operationCancel")}
                    </Button>
                  ) : null
                }
              >
                <ListItemText
                  primary={t(`fileBrowser.archive.operationKinds.${operation.kind}`)}
                  secondary={
                    <>
                      <Typography component="span" variant="body2" color="text.secondary">
                        {t(`fileBrowser.archive.operationPhases.${operation.phase}`)}
                      </Typography>
                      <Typography component="span" variant="body2" color="text.secondary">{` - ${operationTarget(operation)}`}</Typography>
                    </>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      </Box>
    </ResponsiveFormDialog>
  );
}
