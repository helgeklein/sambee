import { Alert, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { InlineItemName } from "./InlineItemName";

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
      <Box
        component="dl"
        sx={{ display: "grid", gap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "minmax(7rem, auto) minmax(0, 1fr)" }, m: 0 }}
      >
        <Typography component="dt" variant="body2" color="text.secondary">
          {t("fileBrowser.archive.collisionArchiveMemberLabel")}
        </Typography>
        <Box component="dd" sx={{ m: 0, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>
          <InlineItemName variant="prose" sx={{ mx: 0 }}>
            {error.memberPath}
          </InlineItemName>
        </Box>
        <Typography component="dt" variant="body2" color="text.secondary">
          {t("fileBrowser.archive.memberErrorTargetLabel")}
        </Typography>
        <Box component="dd" sx={{ m: 0, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>
          <InlineItemName variant="prose" sx={{ mx: 0 }}>
            {error.targetPath}
          </InlineItemName>
        </Box>
      </Box>
      {error.partialOutput ? (
        <Typography variant="body2" color="text.secondary">
          {t("fileBrowser.archive.memberErrorPartialOutputNote")}
        </Typography>
      ) : null}
    </Box>
  );
}
