import { Box, Button, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ArchiveExtractionConflict,
  ArchiveExtractionConflictAction,
  ArchiveExtractionSummary,
} from "../../pages/FileBrowser/contentProviders";
import { type ConflictInfo, FileType } from "../../types";
import { DialogNotice } from "../Dialog/DialogNotice";
import { ResponsiveDialogShell } from "../Dialog/ResponsiveDialogShell";
import { FormGroup, FormRow, FormSurface, formOutlinedControlSx } from "../Form/FormLayout";
import { ArchiveMemberErrorResolver } from "./ArchiveMemberErrorResolver";
import { ArchiveOperationProgress } from "./ArchiveOperationProgress";
import { DialogOperationContext } from "./DialogOperationContext";
import { type ConflictDecision, type ConflictResolution, OverwriteResolutionDialog } from "./OverwriteConflictDialog";

export type ArchiveExtractionScope = { kind: "archive" } | { kind: "members"; memberPaths: string[] };

interface ArchiveExtractDialogProps {
  archiveName: string;
  extractionScope: ArchiveExtractionScope;
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
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized) return "empty";
  if (normalized.startsWith("/") || normalized.split("/").some((part: string) => part === "" || part === "." || part === "..")) {
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
      name: getItemName(conflict.source.path),
      path: conflict.source.path,
      type,
      size: conflict.source.size ?? undefined,
      modified_at: conflict.source.modifiedAt ?? undefined,
      is_readable: true,
      is_hidden: false,
    },
    existing_file: {
      name: getItemName(conflict.target.path),
      path: conflict.target.path,
      type,
      size: conflict.target.size ?? undefined,
      modified_at: conflict.target.modifiedAt ?? undefined,
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
      const parentPath = getParentPath(conflict.source.path);
      return { action: "rename", targetPath: parentPath ? `${parentPath}/${decision.targetName}` : decision.targetName };
    }
  }
}

export function ArchiveExtractDialog({
  archiveName,
  extractionScope,
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
  const cancelExtractionButtonRef = useRef<HTMLButtonElement>(null);
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
    onConfirm(destinationPath.trim().replace(/\\/g, "/"));
  };

  const validationMessage =
    validationError === "empty"
      ? t("fileBrowser.archive.validationDestinationEmpty")
      : validationError === "unsafe"
        ? t("fileBrowser.archive.validationDestinationUnsafe")
        : null;
  const currentConflict = conflicts?.[0] ?? null;
  const awaitingConflictDecision = currentConflict !== null && onConflictDecision !== undefined;
  const selectedMemberPaths = extractionScope.kind === "members" ? extractionScope.memberPaths : [];
  const isSingleMemberExtraction = selectedMemberPaths.length === 1;
  const actionNotice = memberError ? (
    <DialogNotice
      message={memberError.message}
      severity={memberError.partialOutput ? "warning" : "error"}
      testId="archive-member-error-notice"
    />
  ) : (
    <DialogNotice message={error} testId="archive-extract-notice" />
  );
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
      {memberError
        ? t("fileBrowser.archive.memberErrorPrompt")
        : extractionScope.kind === "archive"
          ? t("fileBrowser.archive.extractDescriptionArchive")
          : isSingleMemberExtraction
            ? t("fileBrowser.archive.extractDescriptionMember")
            : t("fileBrowser.archive.extractDescriptionMembers", { count: selectedMemberPaths.length })}
    </Typography>
  );

  useEffect(() => {
    if (!memberError || isCancelling || isSubmittingConflictDecision) return;
    const frameId = requestAnimationFrame(() => retryMemberButtonRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [isCancelling, isSubmittingConflictDecision, memberError]);

  useEffect(() => {
    if (!open || !isExtracting || awaitingConflictDecision || memberError || !onCancelExtraction) return;
    const frameId = requestAnimationFrame(() => cancelExtractionButtonRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [awaitingConflictDecision, isExtracting, memberError, onCancelExtraction, open]);

  if (awaitingConflictDecision && currentConflict && onConflictDecision) {
    const conflictResolutions = toConflictResolutions(allowedConflictActions);
    const handleConflictResolve = (decision: ConflictDecision) => {
      const archiveDecision = toArchiveDecision(decision, currentConflict, allowedConflictActions);
      if (archiveDecision) {
        onConflictDecision(archiveDecision.action, currentConflict.source.path, archiveDecision.targetPath);
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
        sourcePath={joinDisplayPath(sourcePathPrefix, currentConflict.source.path)}
        targetDirectoryPath={getConnectionPath(targetConnectionName, getParentPath(currentConflict.target.path))}
        onResolve={handleConflictResolve}
        onCancel={onCancelExtraction ?? onClose}
      />
    );
  }

  return (
    <ResponsiveDialogShell
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      onEscape={isExtracting && onCancelExtraction ? onCancelExtraction : undefined}
      onTransitionEntered={focusInitialControl}
      title={t(memberError ? "fileBrowser.archive.memberErrorTitle" : "fileBrowser.archive.extractTitle")}
      description={extractionDescription}
      maxWidth="sm"
      actionNotice={!awaitingConflictDecision ? actionNotice : undefined}
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
            <Button ref={cancelExtractionButtonRef} onClick={onCancelExtraction} disabled={isCancelling}>
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
        {!memberError && !awaitingConflictDecision ? (
          <DialogOperationContext
            entries={[
              ...(extractionScope.kind === "archive"
                ? [{ label: t("fileBrowser.operationContext.archive"), value: archiveName, kind: "fileName" as const }]
                : isSingleMemberExtraction
                  ? [{ label: t("fileBrowser.operationContext.archiveMember"), value: selectedMemberPaths[0]!, kind: "path" as const }]
                  : []),
              { label: t("fileBrowser.operationContext.destinationDirectory"), value: destinationLabel ?? "", kind: "path" as const },
            ]}
          />
        ) : null}
        {isExtracting && !awaitingConflictDecision && !memberError ? (
          <ArchiveOperationProgress operation="extract" processedMembers={progressSummary?.membersProcessed} />
        ) : null}
        {memberError ? (
          <ArchiveMemberErrorResolver key={`${memberError.memberPath}\u0000${memberError.targetPath}`} error={memberError} />
        ) : null}
        {!isExtracting && !awaitingConflictDecision && requiresDestinationName ? (
          <FormSurface>
            <FormGroup edge="both">
              <FormRow sx={{ display: { md: "block" } }}>
                <TextField
                  inputRef={inputRef}
                  fullWidth
                  label={t("fileBrowser.archive.destinationNameLabel")}
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
                  sx={formOutlinedControlSx}
                />
              </FormRow>
            </FormGroup>
          </FormSurface>
        ) : null}
      </Box>
    </ResponsiveDialogShell>
  );
}
