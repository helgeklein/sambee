import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";

export interface ArchiveExtractionConflictDialogProps {
  open: boolean;
  conflicts: Array<{
    member_path: string;
    target_path: string;
    is_directory?: boolean;
    source_size?: number;
    source_modified_at?: string;
    target_size?: number;
    target_modified_at?: string;
  }>;
  allowedActions: Array<"skip" | "skip_all" | "replace" | "replace_all" | "replace_older" | "rename">;
  isSubmitting: boolean;
  error: string | null;
  inline?: boolean;
  onDecision: (
    action: "skip" | "skip_all" | "replace" | "replace_all" | "replace_older" | "rename" | "cancel",
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

function isSafeRelativePath(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/");
  return Boolean(normalized) && !normalized.startsWith("/") && normalized.split("/").every((part) => part && part !== "." && part !== "..");
}

function formatConflictMetadata(conflict: ArchiveExtractionConflictDialogProps["conflicts"][number]): string | null {
  const source = conflict.source_size === undefined ? null : `Archive: ${conflict.source_size.toLocaleString()} bytes`;
  const target = conflict.target_size === undefined ? null : `Existing: ${conflict.target_size.toLocaleString()} bytes`;
  const dates = [conflict.source_modified_at, conflict.target_modified_at]
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value).toLocaleString())
    .filter((value) => value !== "Invalid Date");
  return [source, target, ...dates].filter((value): value is string => value !== null).join("; ") || null;
}

export function ArchiveExtractionConflictDialog({
  open,
  conflicts,
  allowedActions,
  isSubmitting,
  error,
  inline = false,
  onDecision,
}: ArchiveExtractionConflictDialogProps) {
  const { t } = useTranslation();
  const [renameMemberPath, setRenameMemberPath] = useState<string | null>(null);
  const [renameTargetPath, setRenameTargetPath] = useState("");
  const [renameValidationError, setRenameValidationError] = useState(false);
  const can = (action: "skip" | "skip_all" | "replace" | "replace_all" | "replace_older" | "rename") => allowedActions.includes(action);

  const beginRename = (memberPath: string) => {
    setRenameMemberPath(memberPath);
    setRenameTargetPath(suggestedRenameTarget(memberPath));
    setRenameValidationError(false);
  };

  const confirmRename = () => {
    if (!renameMemberPath) return;
    if (!isSafeRelativePath(renameTargetPath)) {
      setRenameValidationError(true);
      return;
    }
    onDecision("rename", renameMemberPath, renameTargetPath.trim().replaceAll("\\", "/"));
  };

  const actionButtons = (
    <>
      <Button onClick={() => onDecision("cancel")} disabled={isSubmitting}>
        {t("common.actions.cancel")}
      </Button>
      {can("skip_all") ? (
        <Button onClick={() => onDecision("skip_all")} disabled={isSubmitting}>
          {t("fileBrowser.archive.buttonSkipAll")}
        </Button>
      ) : null}
      {can("replace_all") ? (
        <Button
          variant="contained"
          color="warning"
          onClick={() => onDecision("replace_all")}
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
        >
          {t("fileBrowser.archive.buttonReplaceAll")}
        </Button>
      ) : null}
      {can("replace_older") ? (
        <Button onClick={() => onDecision("replace_older")} disabled={isSubmitting}>
          {t("fileBrowser.archive.buttonReplaceOlder")}
        </Button>
      ) : null}
    </>
  );
  const review = (
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
                  {formatConflictMetadata(conflict) ? <Typography variant="body2">{formatConflictMetadata(conflict)}</Typography> : null}
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {!conflict.is_directory && can("skip") ? (
                      <Button size="small" onClick={() => onDecision("skip", conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonSkip")}
                      </Button>
                    ) : null}
                    {!conflict.is_directory && can("replace") ? (
                      <Button size="small" onClick={() => onDecision("replace", conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonReplace")}
                      </Button>
                    ) : null}
                    {can("rename") ? (
                      <Button size="small" onClick={() => beginRename(conflict.member_path)} disabled={isSubmitting}>
                        {t("fileBrowser.archive.buttonRename")}
                      </Button>
                    ) : null}
                  </Box>
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>
      {renameMemberPath ? (
        <SettingsFormSurface>
          <SettingsFormGroup>
            <SettingsFormRow sx={{ display: { md: "block" } }}>
              <TextField
                autoFocus
                fullWidth
                label={t("fileBrowser.archive.renameTargetLabel")}
                value={renameTargetPath}
                onChange={(event) => {
                  setRenameTargetPath(event.target.value);
                  setRenameValidationError(false);
                }}
                disabled={isSubmitting}
                error={renameValidationError}
                helperText={renameValidationError ? t("fileBrowser.archive.validationDestinationUnsafe") : " "}
                sx={settingsFormOutlinedControlSx}
              />
              <Button variant="contained" onClick={confirmRename} disabled={isSubmitting} sx={{ mt: 1 }}>
                {t("fileBrowser.archive.buttonRename")}
              </Button>
            </SettingsFormRow>
          </SettingsFormGroup>
        </SettingsFormSurface>
      ) : null}
      {conflicts.length > 10 ? (
        <Typography variant="body2">{t("fileBrowser.archive.collisionMore", { count: conflicts.length - 10 })}</Typography>
      ) : null}
    </Box>
  );

  if (inline) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {review}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>{actionButtons}</Box>
      </Box>
    );
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={() => onDecision("cancel")}
      disableClose={isSubmitting}
      title={t("fileBrowser.archive.collisionTitle")}
      description={t("fileBrowser.archive.collisionPrompt")}
      maxWidth="sm"
      actions={actionButtons}
    >
      {review}
    </ResponsiveFormDialog>
  );
}
