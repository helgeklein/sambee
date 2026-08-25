import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";

interface ArchiveExtractionConflictDialogProps {
  open: boolean;
  conflicts: Array<{ member_path: string; target_path: string }>;
  isSubmitting: boolean;
  error: string | null;
  onDecision: (
    action: "skip" | "skip_all" | "replace" | "replace_all" | "rename" | "cancel",
    memberPath?: string,
    targetPath?: string
  ) => void;
}

function suggestedRenameTarget(memberPath: string): string {
  const separatorIndex = memberPath.lastIndexOf("/");
  const directory = separatorIndex >= 0 ? memberPath.slice(0, separatorIndex + 1) : "";
  const fileName = memberPath.slice(separatorIndex + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0) return `${directory}${fileName} (copy)`;
  return `${directory}${fileName.slice(0, extensionIndex)} (copy)${fileName.slice(extensionIndex)}`;
}

export function ArchiveExtractionConflictDialog({
  open,
  conflicts,
  isSubmitting,
  error,
  onDecision,
}: ArchiveExtractionConflictDialogProps) {
  const { t } = useTranslation();
  const [renameMemberPath, setRenameMemberPath] = useState<string | null>(null);
  const [renameTargetPath, setRenameTargetPath] = useState("");

  const beginRename = (memberPath: string) => {
    setRenameMemberPath(memberPath);
    setRenameTargetPath(suggestedRenameTarget(memberPath));
  };

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={() => onDecision("cancel")}
      disableClose={isSubmitting}
      title={t("fileBrowser.archive.collisionTitle")}
      description={t("fileBrowser.archive.collisionPrompt")}
      maxWidth="sm"
      contentSx={{ p: 2 }}
      actions={
        <>
          <Button onClick={() => onDecision("cancel")} disabled={isSubmitting}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={() => onDecision("skip_all")} disabled={isSubmitting}>
            {t("fileBrowser.archive.buttonSkipAll")}
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => onDecision("replace_all")}
            disabled={isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
          >
            {t("fileBrowser.archive.buttonReplaceAll")}
          </Button>
        </>
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <List dense disablePadding aria-label={t("fileBrowser.archive.collisionListLabel")}>
          {conflicts.slice(0, 10).map((conflict) => (
            <ListItem key={conflict.member_path} disableGutters>
              <ListItemText
                primary={conflict.member_path}
                secondary={
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>
                    <Typography variant="body2">{conflict.target_path}</Typography>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      <Button size="small" onClick={() => onDecision("skip", conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonSkip")}
                      </Button>
                      <Button size="small" onClick={() => onDecision("replace", conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonReplace")}
                      </Button>
                      <Button size="small" onClick={() => beginRename(conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonRename")}
                      </Button>
                    </Box>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>
        {renameMemberPath ? (
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              autoFocus
              fullWidth
              label={t("fileBrowser.archive.renameTargetLabel")}
              value={renameTargetPath}
              onChange={(event) => setRenameTargetPath(event.target.value)}
              disabled={isSubmitting}
            />
            <Button
              variant="contained"
              onClick={() => onDecision("rename", renameMemberPath, renameTargetPath)}
              disabled={isSubmitting || !renameTargetPath.trim()}
            >
              {t("fileBrowser.archive.buttonRename")}
            </Button>
          </Box>
        ) : null}
        {conflicts.length > 10 ? (
          <Typography variant="body2">{t("fileBrowser.archive.collisionMore", { count: conflicts.length - 10 })}</Typography>
        ) : null}
      </Box>
    </ResponsiveFormDialog>
  );
}
