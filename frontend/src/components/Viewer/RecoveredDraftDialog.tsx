import { Alert, Box, Button, Typography } from "@mui/material";
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

function formatByteSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
  }

  return `${new Intl.NumberFormat().format(bytes)} bytes`;
}

function formatTime(value: number | string | undefined): string {
  if (value === undefined) {
    return "Unknown";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
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
  return (
    <ResponsiveDialogShell
      open={draft !== null}
      onClose={() => {}}
      disableClose
      title="Unsaved local draft available"
      description={
        draft && isDraftNewer(draft, fileModifiedAt)
          ? "An unsaved local draft is available and was updated after the saved file."
          : "An unsaved local draft is available."
      }
      maxWidth="xs"
      actionNotice={error ? <Alert severity="error">{error}</Alert> : null}
      actions={
        <>
          <Button color="warning" disabled={isResuming} onClick={onDiscard}>
            Discard draft
          </Button>
          <Button variant="contained" disabled={isResuming} onClick={onResume}>
            Resume editing
          </Button>
        </>
      }
    >
      {draft ? (
        <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 1, m: 0 }}>
          <Typography component="dt" variant="body2" sx={{ color: "text.secondary" }}>
            Saved file
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {formatByteSize(fileSize)}, {formatTime(fileModifiedAt)}
          </Typography>
          <Typography component="dt" variant="body2" sx={{ color: "text.secondary" }}>
            Local draft
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {formatByteSize(new Blob([draft.content]).size)}, {formatTime(draft.updatedAt)}
          </Typography>
        </Box>
      ) : null}
    </ResponsiveDialogShell>
  );
}
