import { Box, Checkbox, FormControl, FormControlLabel, Radio, RadioGroup, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArchiveExtractionConflict, ArchiveExtractionConflictAction } from "../../pages/FileBrowser/contentProviders";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../../utils/localeFormatting";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";

type ArchiveConflictChoice = "skip" | "replace" | "replace_older" | "rename";

export interface ArchiveConflictResolution {
  action: ArchiveExtractionConflictAction;
  memberPath: string;
  targetPath?: string;
}

interface ArchiveConflictResolverProps {
  conflict: ArchiveExtractionConflict;
  allowedActions: ArchiveExtractionConflictAction[];
  isSubmitting: boolean;
  error: string | null;
  onResolutionChange: (resolution: ArchiveConflictResolution | null) => void;
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

function formatModifiedAt(value: string | undefined): string | null {
  if (!value || Number.isNaN(new Date(value).valueOf())) {
    return null;
  }
  return formatLocalizedDateTime(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialChoice(
  conflict: ArchiveExtractionConflict,
  allowedActions: ArchiveExtractionConflictAction[]
): ArchiveConflictChoice | null {
  if (conflict.isDirectory) {
    return allowedActions.includes("rename") ? "rename" : null;
  }
  if (allowedActions.includes("skip") || allowedActions.includes("skip_all")) return "skip";
  if (allowedActions.includes("replace") || allowedActions.includes("replace_all")) return "replace";
  if (allowedActions.includes("replace_older")) return "replace_older";
  if (allowedActions.includes("rename")) return "rename";
  return null;
}

function ArchiveConflictMetadataRow({
  label,
  archiveValue,
  destinationValue,
  archiveLabel,
  destinationLabel,
}: {
  label: string;
  archiveValue: string | null;
  destinationValue: string | null;
  archiveLabel: string;
  destinationLabel: string;
}) {
  if (archiveValue === null && destinationValue === null) return null;

  return (
    <Box
      component="div"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr) minmax(0, 1fr)", sm: "minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1fr)" },
        gap: 1,
      }}
    >
      <Typography component="dt" variant="body2" sx={{ color: "text.secondary", gridColumn: { xs: "1 / -1", sm: "auto" } }}>
        {label}
      </Typography>
      <Box component="dd" aria-label={`${label}: ${archiveLabel}`} sx={{ m: 0, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", display: { sm: "none" } }}>
          {archiveLabel}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {archiveValue ?? "-"}
        </Typography>
      </Box>
      <Box component="dd" aria-label={`${label}: ${destinationLabel}`} sx={{ m: 0, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", display: { sm: "none" } }}>
          {destinationLabel}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {destinationValue ?? "-"}
        </Typography>
      </Box>
    </Box>
  );
}

export function ArchiveConflictResolver({
  conflict,
  allowedActions,
  isSubmitting,
  error,
  onResolutionChange,
}: ArchiveConflictResolverProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ArchiveConflictChoice | null>(() => initialChoice(conflict, allowedActions));
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const [renameTargetPath, setRenameTargetPath] = useState(() => suggestedRenameTarget(conflict.memberPath));
  const directoryConflictSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChoice(initialChoice(conflict, allowedActions));
    setApplyToRemaining(false);
    setRenameTargetPath(suggestedRenameTarget(conflict.memberPath));
  }, [allowedActions, conflict]);

  useEffect(() => {
    if (conflict.isDirectory) {
      directoryConflictSummaryRef.current?.focus();
    }
  }, [conflict.isDirectory]);

  useEffect(() => {
    if (!choice) {
      onResolutionChange(null);
      return;
    }
    if (choice === "rename") {
      if (!isSafeRelativePath(renameTargetPath)) {
        onResolutionChange(null);
        return;
      }
      onResolutionChange({ action: "rename", memberPath: conflict.memberPath, targetPath: renameTargetPath.trim().replaceAll("\\", "/") });
      return;
    }
    if (choice === "skip") {
      onResolutionChange({
        action: applyToRemaining || !allowedActions.includes("skip") ? "skip_all" : "skip",
        memberPath: conflict.memberPath,
      });
      return;
    }
    if (choice === "replace") {
      onResolutionChange({
        action: applyToRemaining || !allowedActions.includes("replace") ? "replace_all" : "replace",
        memberPath: conflict.memberPath,
      });
      return;
    }
    onResolutionChange({ action: "replace_older", memberPath: conflict.memberPath });
  }, [allowedActions, applyToRemaining, choice, conflict.memberPath, onResolutionChange, renameTargetPath]);

  const supports = (action: ArchiveExtractionConflictAction) => allowedActions.includes(action);
  const canApplyToRemaining = (choice === "skip" && supports("skip_all")) || (choice === "replace" && supports("replace_all"));
  const sourceSize =
    conflict.sourceSize === undefined
      ? null
      : t("fileBrowser.archive.collisionByteCount", { count: formatLocalizedNumber(conflict.sourceSize) });
  const targetSize =
    conflict.targetSize === undefined
      ? null
      : t("fileBrowser.archive.collisionByteCount", { count: formatLocalizedNumber(conflict.targetSize) });
  const sourceModifiedAt = formatModifiedAt(conflict.sourceModifiedAt);
  const targetModifiedAt = formatModifiedAt(conflict.targetModifiedAt);
  const isRenameInvalid = choice === "rename" && !isSafeRelativePath(renameTargetPath);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {error ? (
        <Typography color="error" role="alert">
          {error}
        </Typography>
      ) : null}
      <Box
        ref={directoryConflictSummaryRef}
        data-testid="archive-conflict-summary"
        tabIndex={conflict.isDirectory ? -1 : undefined}
        sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}
      >
        <DialogReadOnlyField
          label={t("fileBrowser.archive.collisionArchiveMemberLabel")}
          value={conflict.memberPath}
          multiline
          minRows={1}
          maxRows={2}
        />
        <DialogReadOnlyField
          label={t("fileBrowser.archive.collisionDestinationPathLabel")}
          value={conflict.targetPath}
          multiline
          minRows={1}
          maxRows={2}
        />
      </Box>
      {(sourceSize !== null || targetSize !== null || sourceModifiedAt !== null || targetModifiedAt !== null) && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          <Box
            aria-hidden="true"
            data-testid="archive-conflict-desktop-comparison-headers"
            sx={{
              display: { xs: "none", sm: "grid" },
              gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1fr)",
              gap: 1,
            }}
          >
            <Box />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("fileBrowser.archive.collisionArchiveColumn")}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("fileBrowser.archive.collisionDestinationColumn")}
            </Typography>
          </Box>
          <Box component="dl" sx={{ display: "flex", flexDirection: "column", gap: 1.5, m: 0 }}>
            <ArchiveConflictMetadataRow
              label={t("fileBrowser.archive.collisionSizeLabel")}
              archiveValue={sourceSize}
              destinationValue={targetSize}
              archiveLabel={t("fileBrowser.archive.collisionArchiveColumn")}
              destinationLabel={t("fileBrowser.archive.collisionDestinationColumn")}
            />
            <ArchiveConflictMetadataRow
              label={t("fileBrowser.archive.collisionModifiedLabel")}
              archiveValue={sourceModifiedAt}
              destinationValue={targetModifiedAt}
              archiveLabel={t("fileBrowser.archive.collisionArchiveColumn")}
              destinationLabel={t("fileBrowser.archive.collisionDestinationColumn")}
            />
          </Box>
        </Box>
      )}
      <FormControl component="fieldset" disabled={isSubmitting}>
        <Typography component="legend" variant="body2" sx={{ mb: 0.5, color: "text.secondary" }}>
          {t("fileBrowser.archive.collisionResolutionLabel")}
        </Typography>
        <RadioGroup value={choice ?? ""} onChange={(event) => setChoice(event.target.value as ArchiveConflictChoice)}>
          {!conflict.isDirectory && (supports("skip") || supports("skip_all")) ? (
            <FormControlLabel
              value="skip"
              control={<Radio size="small" autoFocus={choice === "skip"} />}
              label={t("fileBrowser.archive.collisionChoiceSkip")}
            />
          ) : null}
          {!conflict.isDirectory && (supports("replace") || supports("replace_all")) ? (
            <FormControlLabel value="replace" control={<Radio size="small" />} label={t("fileBrowser.archive.collisionChoiceReplace")} />
          ) : null}
          {supports("replace_older") ? (
            <FormControlLabel
              value="replace_older"
              control={<Radio size="small" />}
              label={t("fileBrowser.archive.collisionChoiceReplaceOlder")}
            />
          ) : null}
          {supports("rename") ? (
            <FormControlLabel value="rename" control={<Radio size="small" />} label={t("fileBrowser.archive.collisionChoiceRename")} />
          ) : null}
        </RadioGroup>
      </FormControl>
      {canApplyToRemaining ? (
        <FormControlLabel
          control={<Checkbox checked={applyToRemaining} onChange={(event) => setApplyToRemaining(event.target.checked)} size="small" />}
          disabled={isSubmitting}
          label={t("fileBrowser.archive.collisionApplyRemaining")}
        />
      ) : null}
      {choice === "rename" ? (
        <TextField
          autoFocus={!conflict.isDirectory}
          fullWidth
          label={t("fileBrowser.archive.renameTargetLabel")}
          value={renameTargetPath}
          onChange={(event) => setRenameTargetPath(event.target.value)}
          disabled={isSubmitting}
          error={isRenameInvalid}
          helperText={isRenameInvalid ? t("fileBrowser.archive.validationDestinationUnsafe") : " "}
          sx={settingsFormOutlinedControlSx}
        />
      ) : null}
    </Box>
  );
}

interface ArchiveMemberErrorResolverProps {
  error: { memberPath: string; targetPath: string; message: string; partialOutput: boolean };
  isSubmitting: boolean;
  onResolutionChange: (action: "retry" | "ignore") => void;
}

export function ArchiveMemberErrorResolver({ error, isSubmitting, onResolutionChange }: ArchiveMemberErrorResolverProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<"retry" | "ignore">("retry");

  useEffect(() => {
    onResolutionChange(choice);
  }, [choice, onResolutionChange]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography color={error.partialOutput ? "warning.main" : "error"} role="alert">
        {error.message}
      </Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <DialogReadOnlyField
          label={t("fileBrowser.archive.collisionArchiveMemberLabel")}
          value={error.memberPath}
          multiline
          minRows={1}
          maxRows={2}
        />
        <DialogReadOnlyField
          label={t("fileBrowser.archive.collisionDestinationPathLabel")}
          value={error.targetPath}
          multiline
          minRows={1}
          maxRows={2}
        />
      </Box>
      <FormControl component="fieldset" disabled={isSubmitting}>
        <Typography component="legend" variant="body2" sx={{ mb: 0.5, color: "text.secondary" }}>
          {t("fileBrowser.archive.memberErrorResolutionLabel")}
        </Typography>
        <RadioGroup value={choice} onChange={(event) => setChoice(event.target.value as "retry" | "ignore")}>
          <FormControlLabel
            value="retry"
            control={<Radio size="small" autoFocus />}
            label={t("fileBrowser.archive.memberErrorChoiceRetry")}
          />
          <FormControlLabel value="ignore" control={<Radio size="small" />} label={t("fileBrowser.archive.memberErrorChoiceIgnore")} />
        </RadioGroup>
      </FormControl>
    </Box>
  );
}
