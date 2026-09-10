import { Box, LinearProgress, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

type ArchiveOperationProgressProps = { operation: "create" } | { operation: "extract"; processedMembers?: number };

export function ArchiveOperationProgress(props: ArchiveOperationProgressProps) {
  const { t } = useTranslation();
  const progressMessage =
    props.operation === "create"
      ? t("fileBrowser.archive.progressCreating")
      : props.processedMembers && props.processedMembers > 0
        ? t("fileBrowser.archive.progressProcessedMembers", { processed: props.processedMembers })
        : t("fileBrowser.archive.progressPreparing");

  return (
    <Box role="status" aria-live="polite" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {progressMessage}
      </Typography>
      <LinearProgress />
    </Box>
  );
}
