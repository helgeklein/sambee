import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type {
  ArchiveExtractionConflict,
  ArchiveExtractionConflictAction,
  ArchiveExtractionSummary,
} from "../../pages/FileBrowser/contentProviders";
import { type ConflictInfo, FileType } from "../../types";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { ArchiveMemberErrorResolver } from "./ArchiveMemberErrorResolver";
import { ArchiveOperationProgress } from "./ArchiveOperationProgress";
import { InlineItemName } from "./InlineItemName";
import { type ConflictDecision, type ConflictResolution, OverwriteResolutionDialog } from "./OverwriteConflictDialog";

interface ArchiveExtractDialogProps {
  archiveName: string;
  initialDestinationName: string;
  destinationLabel?: string;
  sourcePathPrefix?: string;
  targetConnectionName?: string;
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

function getItemName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function getParentPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex < 0 ? "" : path.slice(0, separatorIndex);
}

function joinDisplayPath(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  return `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getConnectionPath(connectionName: string | undefined, path: string): string {
  return connectionName ? `${connectionName}:/${path}` : path;
}

function toArchiveConflictInfo(conflict: ArchiveExtractionConflict): ConflictInfo {
  const type = conflict.isDirectory ? FileType.DIRECTORY : FileType.FILE;
  return {
    incoming_file: {
      name: getItemName(conflict.memberPath),
      path: conflict.memberPath,
      type,
      size: conflict.sourceSize,
      modified_at: conflict.sourceModifiedAt,
      is_readable: true,
      is_hidden: false,
    },
    existing_file: {
      name: getItemName(conflict.targetPath),
      path: conflict.targetPath,
      type,
      size: conflict.targetSize,
      modified_at: conflict.targetModifiedAt,
      is_readable: true,
      is_hidden: false,
    },
  };
}

function toConflictResolutions(actions: readonly ArchiveExtractionConflictAction[]): ConflictResolution[] {
  const resolutions: ConflictResolution[] = [];
  if (actions.includes("skip") || actions.includes("skip_all")) resolutions.push("skip");
  if (actions.includes("replace") || actions.includes("replace_all")) resolutions.push("overwrite");
  if (actions.includes("replace_older")) resolutions.push("overwrite-older");
  if (actions.includes("rename")) resolutions.push("rename");
  return resolutions;
}

function toArchiveDecision(
  decision: ConflictDecision,
  conflict: ArchiveExtractionConflict,
  allowedActions: readonly ArchiveExtractionConflictAction[]
): { action: ArchiveExtractionConflictAction; targetPath?: string } | null {
  switch (decision.resolution) {
    case "skip":
      return { action: decision.applyToAll || !allowedActions.includes("skip") ? "skip_all" : "skip" };
    case "overwrite":
      return { action: decision.applyToAll || !allowedActions.includes("replace") ? "replace_all" : "replace" };
    case "overwrite-older":
      return { action: "replace_older" };
    case "rename": {
      if (!decision.targetName) return null;
      const parentPath = getParentPath(conflict.memberPath);
      return { action: "rename", targetPath: parentPath ? `${parentPath}/${decision.targetName}` : decision.targetName };
    }
  }
}

export function ArchiveExtractDialog({
  archiveName,
  initialDestinationName,
  destinationLabel,
  sourcePathPrefix,
  targetConnectionName,
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
  const extractButtonRef = useRef<HTMLButtonElement>(null);
  const retryMemberButtonRef = useRef<HTMLButtonElement>(null);
  const [destinationPath, setDestinationPath] = useState(initialDestinationName);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDestinationPath(initialDestinationName);
      setValidationError(null);
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
  const focusInitialControl = () => {
    if (memberError) {
      retryMemberButtonRef.current?.focus();
    } else if (requiresDestinationName) {
      inputRef.current?.select();
    } else {
      extractButtonRef.current?.focus();
    }
  };
  const extractionDescription = (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      {memberError ? (
        t("fileBrowser.archive.memberErrorPrompt")
      ) : (
        <Trans
          i18nKey="fileBrowser.archive.extractPrompt"
          values={{ archive: archiveName }}
          components={{ item: <InlineItemName testId="archive-extract-prompt-name" /> }}
        />
      )}
    </Typography>
  );

  useEffect(() => {
    if (!memberError || isCancelling || isSubmittingConflictDecision) return;
    const frameId = requestAnimationFrame(() => retryMemberButtonRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [isCancelling, isSubmittingConflictDecision, memberError]);

  if (awaitingConflictDecision && currentConflict && onConflictDecision) {
    const conflictResolutions = toConflictResolutions(allowedConflictActions);
    const handleConflictResolve = (decision: ConflictDecision) => {
      const archiveDecision = toArchiveDecision(decision, currentConflict, allowedConflictActions);
      if (archiveDecision) {
        onConflictDecision(archiveDecision.action, currentConflict.memberPath, archiveDecision.targetPath);
      }
    };

    return (
      <OverwriteResolutionDialog
        open={open}
        conflict={toArchiveConflictInfo(currentConflict)}
        operation="extract"
        allowedActions={conflictResolutions}
        canApplyToAll={(resolution) =>
          resolution === "skip"
            ? allowedConflictActions.includes("skip") && allowedConflictActions.includes("skip_all")
            : allowedConflictActions.includes("replace") && allowedConflictActions.includes("replace_all")
        }
        isSubmitting={isSubmittingConflictDecision || isCancelling}
        error={error}
        sourcePath={joinDisplayPath(sourcePathPrefix, currentConflict.memberPath)}
        targetDirectoryPath={getConnectionPath(targetConnectionName, getParentPath(currentConflict.targetPath))}
        onResolve={handleConflictResolve}
        onCancel={onCancelExtraction ?? onClose}
      />
    );
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      onEscape={isExtracting && onCancelExtraction ? onCancelExtraction : undefined}
      onTransitionEntered={focusInitialControl}
      title={t(memberError ? "fileBrowser.archive.memberErrorTitle" : "fileBrowser.archive.extractTitle")}
      description={extractionDescription}
      maxWidth="sm"
      actions={
        memberError ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: { xs: "flex-start", sm: "flex-end" }, width: "100%" }}>
            {onCancelExtraction ? (
              <Button onClick={onCancelExtraction} disabled={isCancelling || isSubmittingConflictDecision}>
                {t("fileBrowser.archive.buttonCancelExtraction")}
              </Button>
            ) : null}
            <Button
              onClick={() => onMemberErrorDecision?.("ignore")}
              disabled={isCancelling || isSubmittingConflictDecision || !onMemberErrorDecision}
            >
              {t("fileBrowser.archive.buttonIgnoreMemberError")}
            </Button>
            <Button
              ref={retryMemberButtonRef}
              variant="contained"
              onClick={() => onMemberErrorDecision?.("retry")}
              disabled={isCancelling || isSubmittingConflictDecision || !onMemberErrorDecision}
            >
              {t("fileBrowser.archive.buttonRetryMemberError")}
            </Button>
          </Box>
        ) : isExtracting ? (
          onCancelExtraction ? (
            <Button onClick={onCancelExtraction} disabled={isCancelling}>
              {t("fileBrowser.archive.buttonCancelExtraction")}
            </Button>
          ) : null
        ) : (
          <>
            <Button onClick={onClose}>{t("common.actions.cancel")}</Button>
            <Button ref={extractButtonRef} variant="contained" onClick={handleConfirm}>
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
        {memberError ? (
          <ArchiveMemberErrorResolver key={`${memberError.memberPath}\u0000${memberError.targetPath}`} error={memberError} />
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
          <DialogReadOnlyField ariaLabel={t("fileBrowser.archive.destinationLabel")} value={destinationLabel ?? ""} showFormSurface />
        ) : null}
      </Box>
    </ResponsiveFormDialog>
  );
}
