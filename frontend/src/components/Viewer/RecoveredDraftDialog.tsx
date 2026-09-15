import { Alert, Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { DraftSnapshot } from "../../services/draftRecovery";
import { ResponsiveDialogShell } from "../Dialog/ResponsiveDialogShell";

interface RecoveredDraftDialogProps {
  draft: DraftSnapshot | null;
  fileSize?: number;
  fileModifiedAt?: string;
  error: string | null;
  isResuming: boolean;
  onDiscard: () => void;
  onResume: () => void;
}

function formatByteSize(bytes: number | undefined, unknownLabel: string): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return unknownLabel;
  }

  return formatFileSize(bytes);
}

function formatTime(value: number | string | undefined, unknownLabel: string): string {
  if (value === undefined) {
    return unknownLabel;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unknownLabel : formatDate(date.toISOString());
}

function isDraftNewer(draft: DraftSnapshot, fileModifiedAt: string | undefined): boolean {
  if (!fileModifiedAt) {
    return false;
  }

  const savedTime = new Date(fileModifiedAt).getTime();
  return Number.isFinite(savedTime) && draft.updatedAt > savedTime;
}

export function RecoveredDraftDialog({
  draft,
  fileSize,
  fileModifiedAt,
  error,
  isResuming,
  onDiscard,
  onResume,
}: RecoveredDraftDialogProps) {
  const { t } = useTranslation();
  const unknownLabel = t("viewer.edit.recovery.unknown");

  return (
    <ResponsiveDialogShell
      open={draft !== null}
      onClose={() => {}}
      disableClose
      title={t("viewer.edit.recovery.title")}
      description={
        draft && isDraftNewer(draft, fileModifiedAt) ? t("viewer.edit.recovery.newerDescription") : t("viewer.edit.recovery.description")
      }
      maxWidth="xs"
      actionNotice={error ? <Alert severity="error">{error}</Alert> : null}
      actions={
        <>
          <Button color="warning" disabled={isResuming} onClick={onDiscard}>
            {t("viewer.edit.recovery.discard")}
          </Button>
          <Button variant="contained" disabled={isResuming} onClick={onResume}>
            {t("viewer.edit.recovery.resume")}
          </Button>
        </>
      }
    >
      {draft ? (
        <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 1, m: 0 }}>
          <Typography component="dt" variant="body2" sx={{ color: "text.secondary" }}>
            {t("viewer.edit.recovery.savedFile")}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {formatByteSize(fileSize, unknownLabel)}, {formatTime(fileModifiedAt, unknownLabel)}
          </Typography>
          <Typography component="dt" variant="body2" sx={{ color: "text.secondary" }}>
            {t("viewer.edit.recovery.localDraft")}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {formatByteSize(new Blob([draft.content]).size, unknownLabel)}, {formatTime(draft.updatedAt, unknownLabel)}
          </Typography>
        </Box>
      ) : null}
    </ResponsiveDialogShell>
  );
}
