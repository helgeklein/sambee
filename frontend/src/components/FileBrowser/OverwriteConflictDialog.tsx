//
// OverwriteConflictDialog
//

/**
 * Overwrite Conflict Dialog
 * =========================
 *
 * Shown when an operation encounters an item that already exists at the
 * target. Displays metadata for the source and existing target so the user
 * can make an informed decision.
 *
 * Actions:
 *   - **Skip**    – leave the existing file untouched and continue
 *   - **Overwrite** – replace the existing target with the source
 *
 * An "Apply to all remaining conflicts" checkbox lets the user convert
 * their choice into a batch decision for all subsequent conflicts in
 * the current multi-file operation.
 */

import { Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Trans } from "react-i18next";
import type { ConflictInfo } from "../../types";
import { FileType } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../../utils/localeFormatting";
import { abbreviatePath } from "../../utils/pathDisplay";
import { DialogReadOnlyField } from "../Admin/DialogReadOnlyField";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { InlineItemName } from "./InlineItemName";
import { validateItemName } from "./nameDialogStrings";
import { OVERWRITE_CONFLICT_STRINGS as S } from "./overwriteConflictStrings";

// ============================================================================
// Types
// ============================================================================

export type ConflictResolution = "skip" | "overwrite" | "overwrite-older" | "rename";
export type OverwriteOperation = "copy" | "move" | "extract";

export interface ConflictDecision {
  resolution: ConflictResolution;
  applyToAll: boolean;
  targetName?: string;
}

export interface OverwriteConflictDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Conflict metadata (existing + incoming file info). */
  conflict: ConflictInfo | null;
  operation?: OverwriteOperation;
  /** Resolution choices the operation owner can honor for this conflict. */
  allowedActions: readonly ConflictResolution[];
  /** Whether the owner permits an all-remaining policy for a resolution. */
  canApplyToAll?: (resolution: "skip" | "overwrite") => boolean;
  progress?: { current: number; total: number; conflictsSoFar: number };
  /** True while the operation owner persists the submitted decision. */
  isSubmitting?: boolean;
  /** Owner-level error that does not have a field-level remedy. */
  error?: string | null;
  /** Full source path, including its connection name. */
  sourcePath?: string;
  /** Full target directory path, including its connection name. */
  targetDirectoryPath?: string;
  onResolve: (decision: ConflictDecision) => void;
  onCancel: () => void;
}

const CONFLICT_METADATA_GRID_COLUMNS = { xs: "1fr", md: "minmax(5.5rem, 8rem) minmax(0, 1fr) minmax(0, 1fr)" };
const CONFLICT_METADATA_COLUMN_GAP = 0.75;
const CONFLICT_METADATA_SECTION_MARGIN_BOTTOM = 5;

// ============================================================================
// Helpers
// ============================================================================

/** Format byte count into a human-readable string (e.g. "1.5 MB"). */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatLocalizedNumber(kb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${formatLocalizedNumber(mb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  const gb = mb / 1024;
  return `${formatLocalizedNumber(gb, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

/** Format an ISO date string with the active application locale. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatLocalizedDateTime(iso, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function suggestCopyName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0) return `${fileName} (copy)`;
  return `${fileName.slice(0, extensionIndex)} (copy)${fileName.slice(extensionIndex)}`;
}

function getParentDirectory(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex < 0) return "/";
  return path.slice(0, separatorIndex) || "/";
}

function AbbreviatedInlinePath({
  path,
  testId,
  blockLayout = false,
  removeHorizontalMargin = false,
}: {
  path: string;
  testId: string;
  blockLayout?: boolean;
  removeHorizontalMargin?: boolean;
}) {
  const pathRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [displayPath, setDisplayPath] = useState(path);

  useEffect(() => {
    const pathElement = pathRef.current;
    const measurement = measureRef.current;
    if (!pathElement || !measurement) return;

    const updatePath = () => {
      const styles = getComputedStyle(pathElement);
      const parent = pathElement.parentElement;
      const measureText = (text: string) => {
        measurement.textContent = text;
        return measurement.getBoundingClientRect().width;
      };
      const availableWidth = blockLayout
        ? pathElement.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight)
        : parent
          ? parent.getBoundingClientRect().right - pathElement.getBoundingClientRect().left - measureText(":")
          : 0;
      if (availableWidth <= 0) {
        setDisplayPath(path);
        return;
      }
      setDisplayPath(abbreviatePath(path, availableWidth, measureText));
    };

    updatePath();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updatePath);
    observer.observe(blockLayout ? pathElement : (pathElement.parentElement ?? pathElement));
    return () => observer.disconnect();
  }, [blockLayout, path]);

  return (
    <>
      <InlineItemName
        ref={pathRef}
        testId={testId}
        title={path}
        variant={blockLayout ? "metadata" : "prose"}
        sx={{
          ...(blockLayout
            ? {
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }
            : {}),
          mx: removeHorizontalMargin ? 0 : undefined,
        }}
      >
        {displayPath}
      </InlineItemName>
      <Box
        aria-hidden
        component="span"
        ref={measureRef}
        sx={{ fontFamily: "monospace", fontSize: "0.875em", left: -10000, position: "fixed", visibility: "hidden", whiteSpace: "nowrap" }}
      />
    </>
  );
}

// ============================================================================
// Component
// ============================================================================

const OverwriteConflictDialog: React.FC<OverwriteConflictDialogProps> = ({
  open,
  conflict,
  operation = "copy",
  allowedActions,
  canApplyToAll: ownerCanApplyToAll,
  progress,
  isSubmitting: ownerIsSubmitting = false,
  error = null,
  sourcePath: ownerSourcePath,
  targetDirectoryPath: ownerTargetDirectoryPath,
  onResolve,
  onCancel,
}) => {
  const [applyToAll, setApplyToAll] = useState(false);
  const [resolution, setResolution] = useState<ConflictResolution>("skip");
  const [renameDraft, setRenameDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const targetNameRef = useRef<HTMLInputElement>(null);
  const resolutionGroupRef = useRef<HTMLDivElement>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const previousConflictIdentityRef = useRef<string | null>(null);
  const shouldFocusInitialControlRef = useRef(false);
  const shouldFocusRenameInputRef = useRef(false);

  const sourcePath = ownerSourcePath ?? conflict?.incoming_file.path ?? "";
  const existingTargetName = conflict?.existing_file.name ?? "";
  const targetDirectory = ownerTargetDirectoryPath ?? getParentDirectory(conflict?.existing_file.path ?? "");
  const conflictIdentity = `${conflict?.incoming_file.path ?? ""}\u0000${conflict?.existing_file.path ?? ""}`;
  const allowedActionsIdentity = allowedActions.join("\u0000");
  const dialogStateIdentity = `${conflictIdentity}\u0000${allowedActionsIdentity}`;
  const safeDefaultResolution = allowedActions.includes("skip") ? "skip" : (allowedActions[0] ?? "skip");
  const hasAvailableResolution = allowedActions.length > 0;
  const isRename = resolution === "rename";
  const isSubmittingOrPending = isSubmitting || ownerIsSubmitting;
  const displayedTargetName = isRename ? renameDraft : existingTargetName;
  const targetNameError = isRename
    ? (validateItemName(renameDraft) ?? (renameDraft === existingTargetName ? S.ERROR_TARGET_NAME_UNCHANGED : null))
    : null;
  const canApplyToAll =
    (resolution === "skip" || resolution === "overwrite") &&
    (ownerCanApplyToAll?.(resolution) ?? Boolean(progress && progress.current < progress.total));
  const canContinue = allowedActions.includes(resolution) && !targetNameError && !isSubmittingOrPending;
  const displayedError = error ?? (hasAvailableResolution ? null : S.ERROR_NO_RESOLUTION_AVAILABLE);
  const description = (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      <Trans
        i18nKey="fileBrowser.overwriteConflict.alreadyExists"
        values={{ targetDirectory }}
        components={{ directory: <AbbreviatedInlinePath path={targetDirectory} testId="overwrite-conflict-target-directory" /> }}
      />
    </Typography>
  );

  const focusInitialControl = useCallback(() => {
    if (!shouldFocusInitialControlRef.current) return;
    shouldFocusInitialControlRef.current = false;
    if (!hasAvailableResolution) {
      errorAlertRef.current?.focus();
      return;
    }
    if (safeDefaultResolution === "rename") {
      targetNameRef.current?.focus();
      return;
    }
    resolutionGroupRef.current?.querySelector<HTMLInputElement>(`input[value="${safeDefaultResolution}"]`)?.focus();
  }, [hasAvailableResolution, safeDefaultResolution]);

  useLayoutEffect(() => {
    if (!open) {
      previousConflictIdentityRef.current = null;
      shouldFocusInitialControlRef.current = false;
      shouldFocusRenameInputRef.current = false;
      return;
    }

    if (previousConflictIdentityRef.current === dialogStateIdentity) return;

    previousConflictIdentityRef.current = dialogStateIdentity;
    setApplyToAll(false);
    setResolution(safeDefaultResolution);
    setRenameDraft(suggestCopyName(existingTargetName));
    setIsSubmitting(false);
    shouldFocusInitialControlRef.current = true;
    shouldFocusRenameInputRef.current = safeDefaultResolution === "rename";
  }, [dialogStateIdentity, existingTargetName, open, safeDefaultResolution]);

  useEffect(() => {
    if (!open || isSubmittingOrPending || !shouldFocusInitialControlRef.current) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      if (!shouldFocusInitialControlRef.current) {
        return;
      }
      focusInitialControl();
    });
    return () => cancelAnimationFrame(frameId);
  }, [focusInitialControl, isSubmittingOrPending, open]);

  useEffect(() => {
    if (!open || !ownerIsSubmitting) {
      setIsSubmitting(false);
    }
  }, [open, ownerIsSubmitting]);

  useLayoutEffect(() => {
    if (open && isRename && shouldFocusRenameInputRef.current) {
      targetNameRef.current?.focus();
      targetNameRef.current?.select();
      shouldFocusRenameInputRef.current = false;
    }
  }, [isRename, open]);

  useEffect(() => {
    if (displayedError) {
      requestAnimationFrame(() => errorAlertRef.current?.focus());
    }
  }, [displayedError]);

  const handleResolutionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextResolution = event.target.value as ConflictResolution;
      shouldFocusRenameInputRef.current = nextResolution === "rename" && resolution !== "rename";
      setResolution(nextResolution);
      setApplyToAll(false);
    },
    [resolution]
  );

  const handleContinue = useCallback(() => {
    if (!canContinue) return;
    setIsSubmitting(true);
    onResolve({
      resolution,
      applyToAll: canApplyToAll ? applyToAll : false,
      targetName: isRename ? renameDraft : undefined,
    });
  }, [applyToAll, canApplyToAll, canContinue, isRename, onResolve, renameDraft, resolution]);

  const fallbackEnterHandler = useMemo(() => dialogEnterKeyHandler(handleContinue), [handleContinue]);
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => fallbackEnterHandler(event), [fallbackEnterHandler]);

  const hasFileMetadata = conflict?.incoming_file.type === FileType.FILE && conflict.existing_file.type === FileType.FILE;
  const metadataRows = hasFileMetadata
    ? [
        ...(conflict.incoming_file.size != null || conflict.existing_file.size != null
          ? [{ label: S.LABEL_SIZE, source: formatBytes(conflict.incoming_file.size), target: formatBytes(conflict.existing_file.size) }]
          : []),
        ...(conflict.incoming_file.modified_at || conflict.existing_file.modified_at
          ? [
              {
                label: S.LABEL_MODIFIED,
                source: formatDate(conflict.incoming_file.modified_at),
                target: formatDate(conflict.existing_file.modified_at),
              },
            ]
          : []),
      ]
    : [];

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onCancel}
      onKeyDown={handleKeyDown}
      title={S.TITLE}
      description={description}
      maxWidth="sm"
      disableClose={isSubmittingOrPending}
      onTransitionEntered={focusInitialControl}
      actions={
        <>
          <Button onClick={onCancel} disabled={isSubmittingOrPending}>
            {S.CANCEL_OPERATION(operation)}
          </Button>
          <Button onClick={handleContinue} variant="contained" disabled={!canContinue}>
            {S.BUTTON_CONTINUE}
          </Button>
        </>
      }
    >
      <Box
        role="group"
        aria-label={S.RESOLUTION_LABEL}
        tabIndex={hasAvailableResolution ? undefined : -1}
        aria-busy={isSubmittingOrPending}
      >
        {displayedError ? (
          <Alert ref={errorAlertRef} severity="error" tabIndex={-1}>
            {displayedError}
          </Alert>
        ) : null}
        <DialogReadOnlyField
          ariaLabel={S.LABEL_TARGET_NAME}
          value={displayedTargetName}
          editable={isRename && !isSubmittingOrPending}
          onChange={(event) => setRenameDraft(event.target.value)}
          inputRef={targetNameRef}
          error={Boolean(targetNameError)}
          helperText={targetNameError ?? " "}
          autoFocus={safeDefaultResolution === "rename" && isRename}
          showFormSurface={!isRename}
          sx={{ mb: 2 }}
        />
        <Box component="section" aria-label={S.METADATA_LABEL} sx={{ mb: CONFLICT_METADATA_SECTION_MARGIN_BOTTOM }}>
          <Box component="dl" sx={{ display: "grid", gap: 1, m: 0 }}>
            {metadataRows.length > 0 && (
              <>
                <Box
                  aria-hidden="true"
                  data-testid="overwrite-conflict-desktop-comparison-headers"
                  sx={{
                    display: { xs: "none", md: "grid" },
                    gridTemplateColumns: CONFLICT_METADATA_GRID_COLUMNS.md,
                    columnGap: CONFLICT_METADATA_COLUMN_GAP,
                  }}
                >
                  <Box />
                  <Typography variant="caption" color="text.secondary">
                    {S.LABEL_INCOMING}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {S.LABEL_EXISTING}
                  </Typography>
                </Box>
                {metadataRows.map((row) => (
                  <Box
                    component="div"
                    key={row.label}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: CONFLICT_METADATA_GRID_COLUMNS,
                      columnGap: CONFLICT_METADATA_COLUMN_GAP,
                      rowGap: 1,
                    }}
                  >
                    <Typography component="dt" variant="caption" color="text.secondary">
                      {row.label}
                    </Typography>
                    <Box component="dd" aria-label={`${row.label}: ${S.LABEL_INCOMING}`} sx={{ m: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "block", md: "none" } }}>
                        {S.LABEL_INCOMING}
                      </Typography>
                      <Typography variant="body2">{row.source}</Typography>
                    </Box>
                    <Box component="dd" aria-label={`${row.label}: ${S.LABEL_EXISTING}`} sx={{ m: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "block", md: "none" } }}>
                        {S.LABEL_EXISTING}
                      </Typography>
                      <Typography variant="body2">{row.target}</Typography>
                    </Box>
                  </Box>
                ))}
              </>
            )}
            {sourcePath ? (
              <Box
                component="div"
                sx={{
                  display: "grid",
                  gridTemplateColumns: CONFLICT_METADATA_GRID_COLUMNS,
                  columnGap: CONFLICT_METADATA_COLUMN_GAP,
                  rowGap: 1,
                }}
              >
                <Typography component="dt" variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                  {S.LABEL_SOURCE_PATH}
                </Typography>
                <Box component="dd" data-testid="overwrite-conflict-source-path" sx={{ gridColumn: { md: "2 / -1" }, m: 0, minWidth: 0 }}>
                  <AbbreviatedInlinePath
                    path={sourcePath}
                    testId="overwrite-conflict-source-path-value"
                    blockLayout
                    removeHorizontalMargin
                  />
                </Box>
              </Box>
            ) : null}
          </Box>
        </Box>

        <FormControl component="fieldset" fullWidth disabled={isSubmittingOrPending} ref={resolutionGroupRef} key={dialogStateIdentity}>
          <FormLabel component="legend">{S.RESOLUTION_LABEL}</FormLabel>
          <RadioGroup value={resolution} onChange={handleResolutionChange}>
            {allowedActions.includes("skip") && <FormControlLabel value="skip" control={<Radio size="small" />} label={S.BUTTON_SKIP} />}
            {allowedActions.includes("overwrite") && (
              <FormControlLabel value="overwrite" control={<Radio size="small" />} label={S.BUTTON_OVERWRITE} />
            )}
            {allowedActions.includes("overwrite-older") && (
              <FormControlLabel value="overwrite-older" control={<Radio size="small" />} label={S.BUTTON_OVERWRITE_ONLY_OLDER} />
            )}
            {allowedActions.includes("rename") && (
              <FormControlLabel value="rename" control={<Radio size="small" />} label={S.BUTTON_RENAME} />
            )}
          </RadioGroup>
        </FormControl>

        <Box
          aria-hidden={!canApplyToAll}
          data-testid="overwrite-conflict-apply-all-slot"
          sx={{ mt: 0.5, visibility: canApplyToAll ? "visible" : "hidden" }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={applyToAll}
                onChange={(event) => setApplyToAll(event.target.checked)}
                size="small"
                disabled={isSubmittingOrPending}
              />
            }
            label={S.APPLY_TO_ALL}
          />
        </Box>
        {progress && (
          <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "text.secondary" }}>
            {S.PROGRESS_CONTEXT(progress.current, progress.total, progress.conflictsSoFar)}
          </Typography>
        )}
      </Box>
    </ResponsiveFormDialog>
  );
};

export { OverwriteConflictDialog as OverwriteResolutionDialog };
export default OverwriteConflictDialog;
