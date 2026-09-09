import { Alert, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { DialogOperationContext } from "./DialogOperationContext";

interface ArchiveMemberErrorResolverProps {
  error: { memberPath: string; targetPath: string; message: string; partialOutput: boolean };
}

export function ArchiveMemberErrorResolver({ error }: ArchiveMemberErrorResolverProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Alert severity={error.partialOutput ? "warning" : "error"} role="alert">
        {error.message}
      </Alert>
      <DialogOperationContext
        entries={[
          { label: t("fileBrowser.archive.collisionArchiveMemberLabel"), value: error.memberPath, kind: "path" },
          { label: t("fileBrowser.archive.memberErrorTargetLabel"), value: error.targetPath, kind: "path" },
        ]}
      />
      {error.partialOutput ? (
        <Typography variant="body2" color="text.secondary">
          {t("fileBrowser.archive.memberErrorPartialOutputNote")}
        </Typography>
      ) : null}
    </Box>
  );
}
