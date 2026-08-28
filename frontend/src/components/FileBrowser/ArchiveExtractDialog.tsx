import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArchiveExtractionSummary } from "../../pages/FileBrowser/contentProviders";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { ArchiveExtractionConflictDialog, type ArchiveExtractionConflictDialogProps } from "./ArchiveExtractionConflictDialog";

interface ArchiveExtractDialogProps {
  archiveName: string;
  initialDestinationName: string;
  destinationLabel?: string;
  requiresDestinationName?: boolean;
  open: boolean;
  isExtracting: boolean;
  isCancelling?: boolean;
  error: string | null;
  memberError?: { memberPath: string; targetPath: string; message: string; partialOutput: boolean } | null;
  completionSummary?: ArchiveExtractionSummary | null;
  progressSummary?: ArchiveExtractionSummary | null;
  conflicts?: ArchiveExtractionConflictDialogProps["conflicts"] | null;
  allowedConflictActions?: ArchiveExtractionConflictDialogProps["allowedActions"];
  isSubmittingConflictDecision?: boolean;
  onClose: () => void;
  onConfirm: (destinationPath: string) => void;
  onCancelExtraction?: () => void;
  onMemberErrorDecision?: (action: "retry" | "ignore") => void;
  onOpenDestination?: () => void;
  onConflictDecision?: ArchiveExtractionConflictDialogProps["onDecision"];
}

function validateDestinationPath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized) return "empty";
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return "unsafe";
  }
  return null;
}

export function ArchiveExtractDialog({
  archiveName,
  initialDestinationName,
  destinationLabel,
  requiresDestinationName = true,
  open,
  isExtracting,
  isCancelling = false,
  error,
  memberError = null,
  completionSummary = null,
  progressSummary = null,
  conflicts = null,
  allowedConflictActions = [],
  isSubmittingConflictDecision = false,
  onClose,
  onConfirm,
  onCancelExtraction,
  onMemberErrorDecision,
  onOpenDestination,
  onConflictDecision,
}: ArchiveExtractDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [destinationPath, setDestinationPath] = useState(initialDestinationName);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDestinationPath(initialDestinationName);
      setValidationError(null);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [initialDestinationName, open]);

  const handleConfirm = () => {
    if (!requiresDestinationName) {
      onConfirm("");
      return;
    }
    const validation = validateDestinationPath(destinationPath);
    if (validation) {
      setValidationError(validation);
      return;
    }
    onConfirm(destinationPath.trim().replaceAll("\\", "/"));
  };

  const validationMessage =
    validationError === "empty"
      ? t("fileBrowser.archive.validationDestinationEmpty")
      : validationError === "unsafe"
        ? t("fileBrowser.archive.validationDestinationUnsafe")
        : " ";
  const completed = completionSummary !== null;
  const awaitingConflictDecision = conflicts !== null && onConflictDecision !== undefined;

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      title={t("fileBrowser.archive.extractTitle")}
      description={t("fileBrowser.archive.extractPrompt", { archive: archiveName })}
      maxWidth="sm"
      contentSx={{ p: 2 }}
      actions={
        completed ? (
          <>
            <Button onClick={onClose}>{t("common.actions.close")}</Button>
            {onOpenDestination ? (
              <Button variant="contained" onClick={onOpenDestination}>
                {t("fileBrowser.archive.buttonOpenDestination")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {isExtracting && onCancelExtraction ? (
              <Button onClick={onCancelExtraction} disabled={isCancelling}>
                {t("fileBrowser.archive.buttonCancelExtraction")}
              </Button>
            ) : (
              <Button onClick={onClose} disabled={isExtracting}>
                {t("common.actions.cancel")}
              </Button>
            )}
            {memberError && onMemberErrorDecision ? (
              <>
                <Button onClick={() => onMemberErrorDecision("ignore")} disabled={isCancelling}>
                  {t("fileBrowser.archive.buttonIgnoreMemberError")}
                </Button>
                <Button variant="contained" onClick={() => onMemberErrorDecision("retry")} disabled={isCancelling}>
                  {t("fileBrowser.archive.buttonRetryMemberError")}
                </Button>
              </>
            ) : (
              <Button
                variant="contained"
                onClick={handleConfirm}
                disabled={isExtracting}
                startIcon={isExtracting ? <CircularProgress size={16} /> : undefined}
              >
                {isExtracting ? t("fileBrowser.archive.buttonExtracting") : t("fileBrowser.archive.buttonExtract")}
              </Button>
            )}
          </>
        )
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {completionSummary ? (
          <Box role="status" aria-live="polite" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Alert severity={completionSummary.filesSkipped > 0 || completionSummary.partialMembers > 0 ? "warning" : "success"}>
              {t("fileBrowser.archive.extractSuccess")}
            </Alert>
            <SettingsFormSurface>
              <SettingsFormGroup>
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryFilesExtracted")}
                  value={completionSummary.filesExtracted.toLocaleString()}
                />
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryDirectoriesCreated")}
                  value={completionSummary.directoriesCreated.toLocaleString()}
                />
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryBytesWritten")}
                  value={completionSummary.extractedBytes.toLocaleString()}
                />
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryFilesSkipped")}
                  value={completionSummary.filesSkipped.toLocaleString()}
                />
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryFilesReplaced")}
                  value={completionSummary.filesReplaced.toLocaleString()}
                />
                <DialogReadOnlyField
                  label={t("fileBrowser.archive.summaryPartialMembers")}
                  value={completionSummary.partialMembers.toLocaleString()}
                />
              </SettingsFormGroup>
            </SettingsFormSurface>
          </Box>
        ) : null}
        {isExtracting && progressSummary ? (
          <SettingsFormSurface role="status" aria-live="polite">
            <SettingsFormGroup>
              <DialogReadOnlyField
                label={t("fileBrowser.archive.summaryFilesExtracted")}
                value={progressSummary.filesExtracted.toLocaleString()}
              />
              <DialogReadOnlyField
                label={t("fileBrowser.archive.summaryDirectoriesCreated")}
                value={progressSummary.directoriesCreated.toLocaleString()}
              />
              <DialogReadOnlyField
                label={t("fileBrowser.archive.summaryBytesWritten")}
                value={progressSummary.extractedBytes.toLocaleString()}
              />
            </SettingsFormGroup>
          </SettingsFormSurface>
        ) : null}
        {!completed && error && !awaitingConflictDecision ? <Alert severity="error">{error}</Alert> : null}
        {awaitingConflictDecision ? (
          <ArchiveExtractionConflictDialog
            inline
            open
            conflicts={conflicts}
            allowedActions={allowedConflictActions}
            isSubmitting={isSubmittingConflictDecision}
            error={error}
            onDecision={onConflictDecision}
          />
        ) : null}
        {!completed && memberError ? (
          <Alert severity={memberError.partialOutput ? "warning" : "error"}>
            {memberError.message} ({memberError.memberPath} to {memberError.targetPath})
          </Alert>
        ) : null}
        {!completed && !awaitingConflictDecision ? (
          <Alert severity="warning">{t("fileBrowser.archive.nonAtomicOutputWarning")}</Alert>
        ) : null}
        {!completed && !awaitingConflictDecision && requiresDestinationName ? (
          <SettingsFormSurface>
            <SettingsFormGroup>
              <SettingsFormRow sx={{ display: { md: "block" } }}>
                <TextField
                  inputRef={inputRef}
                  fullWidth
                  label={t("fileBrowser.archive.destinationLabel")}
                  value={destinationPath}
                  onChange={(event) => {
                    setDestinationPath(event.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isExtracting) {
                      event.preventDefault();
                      handleConfirm();
                    }
                  }}
                  disabled={isExtracting}
                  error={validationError !== null}
                  helperText={validationMessage}
                  sx={settingsFormOutlinedControlSx}
                />
              </SettingsFormRow>
            </SettingsFormGroup>
          </SettingsFormSurface>
        ) : !completed && !awaitingConflictDecision ? (
          <DialogReadOnlyField label={t("fileBrowser.archive.destinationLabel")} value={destinationLabel ?? ""} />
        ) : null}
      </Box>
    </ResponsiveFormDialog>
  );
}
