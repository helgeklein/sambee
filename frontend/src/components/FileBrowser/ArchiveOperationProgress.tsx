import { Box, LinearProgress, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

interface ArchiveOperationProgressProps {
  currentItem: string;
  completedMembers?: number;
  totalMembers?: number;
  processedBytes?: number;
  totalBytes?: number;
}

export function ArchiveOperationProgress({
  currentItem,
  completedMembers,
  totalMembers,
  processedBytes,
  totalBytes,
}: ArchiveOperationProgressProps) {
  const { t } = useTranslation();
  const progressValue =
    totalBytes && processedBytes !== undefined
      ? Math.min((processedBytes / totalBytes) * 100, 100)
      : totalMembers && completedMembers !== undefined
        ? Math.min((completedMembers / totalMembers) * 100, 100)
        : undefined;

  return (
    <Box role="status" aria-live="polite" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <LinearProgress variant={progressValue === undefined ? "indeterminate" : "determinate"} value={progressValue} />
      {totalMembers && completedMembers !== undefined ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {t("fileBrowser.archive.progressMembers", { completed: completedMembers, total: totalMembers })}
        </Typography>
      ) : null}
      {totalBytes && processedBytes !== undefined ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {t("fileBrowser.archive.progressBytes", { processed: processedBytes, total: totalBytes })}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {t("fileBrowser.archive.progressSourceArchive")}: {currentItem}
      </Typography>
    </Box>
  );
}
