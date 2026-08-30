import { Alert, Box, Button, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ArchiveExtractionConflict,
  ArchiveExtractionConflictAction,
  ArchiveExtractionSummary,
} from "../../pages/FileBrowser/contentProviders";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { type ArchiveConflictResolution, ArchiveConflictResolver, ArchiveMemberErrorResolver } from "./ArchiveConflictResolver";
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
  conflicts?: ArchiveExtractionConflict[] | null;
  allowedConflictActions?: ArchiveExtractionConflictAction[];
  isSubmittingConflictDecision?: boolean;
  onClose: () => void;
  onConfirm: (destinationPath: string) => void;
  onCancelExtraction?: () => void;
  onMemberErrorDecision?: (action: "retry" | "ignore") => void;
  onConflictDecision?: (action: ArchiveExtractionConflictAction, memberPath?: string, targetPath?: string) => void;
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
  const [conflictResolution, setConflictResolution] = useState<ArchiveConflictResolution | null>(null);
  const [memberErrorResolution, setMemberErrorResolution] = useState<"retry" | "ignore">("retry");

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
  const currentConflict = conflicts?.[0] ?? null;
  const awaitingConflictDecision = currentConflict !== null && onConflictDecision !== undefined;

  useEffect(() => {
    if (!awaitingConflictDecision) {
      setConflictResolution(null);
    }
  }, [awaitingConflictDecision]);

  const handleConflictContinue = () => {
    if (!conflictResolution || !onConflictDecision) return;
    onConflictDecision(conflictResolution.action, conflictResolution.memberPath, conflictResolution.targetPath);
  };

  const handleMemberErrorContinue = () => {
    if (!memberError || !onMemberErrorDecision) return;
    onMemberErrorDecision(memberErrorResolution);
  };

  const handleDecisionKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || isCancelling || isSubmittingConflictDecision) return;
    if (awaitingConflictDecision && conflictResolution) {
      event.preventDefault();
      handleConflictContinue();
      return;
    }
    if (memberError && onMemberErrorDecision) {
      event.preventDefault();
      handleMemberErrorContinue();
    }
  };

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      onEscape={isExtracting && onCancelExtraction ? onCancelExtraction : undefined}
      onKeyDown={handleDecisionKeyDown}
      title={t("fileBrowser.archive.extractTitle")}
      description={t("fileBrowser.archive.extractPrompt", { archive: archiveName })}
      maxWidth="sm"
      actions={
        awaitingConflictDecision ? (
          <>
            {onCancelExtraction ? (
              <Button onClick={onCancelExtraction} disabled={isCancelling || isSubmittingConflictDecision}>
                {t("fileBrowser.archive.buttonCancelExtraction")}
              </Button>
            ) : null}
            <Button
              variant="contained"
              onClick={handleConflictContinue}
              disabled={conflictResolution === null || isCancelling || isSubmittingConflictDecision}
            >
              {t("fileBrowser.archive.collisionContinue")}
            </Button>
          </>
        ) : memberError ? (
          <>
            {onCancelExtraction ? (
              <Button onClick={onCancelExtraction} disabled={isCancelling || isSubmittingConflictDecision}>
                {t("fileBrowser.archive.buttonCancelExtraction")}
              </Button>
            ) : null}
            <Button variant="contained" onClick={handleMemberErrorContinue} disabled={isCancelling || isSubmittingConflictDecision}>
              {t("fileBrowser.archive.collisionContinue")}
            </Button>
          </>
        ) : isExtracting ? (
          onCancelExtraction ? (
            <Button onClick={onCancelExtraction} disabled={isCancelling}>
              {t("fileBrowser.archive.buttonCancelExtraction")}
            </Button>
          ) : null
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
        {awaitingConflictDecision && currentConflict ? (
          <ArchiveConflictResolver
            key={currentConflict.memberPath}
            conflict={currentConflict}
            allowedActions={allowedConflictActions}
            isSubmitting={isSubmittingConflictDecision}
            error={error}
            onResolutionChange={setConflictResolution}
          />
        ) : null}
        {memberError ? (
          <ArchiveMemberErrorResolver
            key={memberError.memberPath}
            error={memberError}
            isSubmitting={isSubmittingConflictDecision}
            onResolutionChange={setMemberErrorResolution}
          />
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
          <DialogReadOnlyField label={t("fileBrowser.archive.destinationLabel")} value={destinationLabel ?? ""} showFormSurface />
        ) : null}
      </Box>
    </ResponsiveFormDialog>
  );
}
