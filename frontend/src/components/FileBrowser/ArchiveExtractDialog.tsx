import { Alert, Box, Button, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArchiveExtractionSummary } from "../../pages/FileBrowser/contentProviders";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { ArchiveExtractionConflictDialog, type ArchiveExtractionConflictDialogProps } from "./ArchiveExtractionConflictDialog";
import { ArchiveOperationProgress } from "./ArchiveOperationProgress";

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
  progressSummary?: ArchiveExtractionSummary | null;
  conflicts?: ArchiveExtractionConflictDialogProps["conflicts"] | null;
  allowedConflictActions?: ArchiveExtractionConflictDialogProps["allowedActions"];
  isSubmittingConflictDecision?: boolean;
  onClose: () => void;
  onConfirm: (destinationPath: string) => void;
  onCancelExtraction?: () => void;
  onMemberErrorDecision?: (action: "retry" | "ignore") => void;
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
  progressSummary = null,
  conflicts = null,
  allowedConflictActions = [],
  isSubmittingConflictDecision = false,
  onClose,
  onConfirm,
  onCancelExtraction,
  onMemberErrorDecision,
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
  const awaitingConflictDecision = conflicts !== null && onConflictDecision !== undefined;

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      title={t("fileBrowser.archive.extractTitle")}
      description={t("fileBrowser.archive.extractPrompt", { archive: archiveName })}
      maxWidth="sm"
      actions={
        isExtracting ? (
          <>
            {onCancelExtraction ? (
              <Button onClick={onCancelExtraction} disabled={isCancelling}>
                {t("fileBrowser.archive.buttonCancelExtraction")}
              </Button>
            ) : null}
            {memberError && onMemberErrorDecision ? (
              <>
                <Button onClick={() => onMemberErrorDecision("ignore")} disabled={isCancelling}>
                  {t("fileBrowser.archive.buttonIgnoreMemberError")}
                </Button>
                <Button variant="contained" onClick={() => onMemberErrorDecision("retry")} disabled={isCancelling}>
                  {t("fileBrowser.archive.buttonRetryMemberError")}
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t("common.actions.cancel")}</Button>
            <Button variant="contained" onClick={handleConfirm}>
              {t("fileBrowser.archive.buttonExtract")}
            </Button>
          </>
        )
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {isExtracting && !awaitingConflictDecision && !memberError ? (
          <ArchiveOperationProgress
            currentItem={archiveName}
            completedMembers={progressSummary ? progressSummary.filesExtracted + progressSummary.directoriesCreated : undefined}
            totalMembers={progressSummary?.totalMembers}
            processedBytes={progressSummary?.extractedBytes}
            totalBytes={progressSummary?.totalBytes}
          />
        ) : null}
        {error && !awaitingConflictDecision ? <Alert severity="error">{error}</Alert> : null}
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
        {memberError ? (
          <Alert severity={memberError.partialOutput ? "warning" : "error"}>
            {memberError.message} ({memberError.memberPath} to {memberError.targetPath})
          </Alert>
        ) : null}
        {!isExtracting && !awaitingConflictDecision && requiresDestinationName ? (
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
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleConfirm();
                    }
                  }}
                  error={validationError !== null}
                  helperText={validationMessage}
                  sx={settingsFormOutlinedControlSx}
                />
              </SettingsFormRow>
            </SettingsFormGroup>
          </SettingsFormSurface>
        ) : !isExtracting && !awaitingConflictDecision ? (
          <Box sx={{ color: "text.secondary", typography: "body2" }}>{destinationLabel ?? ""}</Box>
        ) : null}
      </Box>
    </ResponsiveFormDialog>
  );
}
