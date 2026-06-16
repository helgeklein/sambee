/**
 * Conflict resolution dialog for the "Done Editing" window.
 *
 * Shown inline (replacing the normal DoneEditingWindow content) when
 * `finish_editing` detects that the server-side file was modified by
 * another user during the edit session.
 *
 * Three resolution options:
 * - **Overwrite**: Force-upload the local version, replacing the server copy.
 * - **Save as Copy**: Upload to a `(conflict copy)` path alongside the current version.
 * - **Cancel**: Return to the normal editing view without uploading.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "preact/hooks";

import { translate } from "../i18n";
import {
  type AuthRetryResult,
  type CompletedResult,
  getTauriErrorMessage,
  isAuthRetryResult,
  isLifecycleErrorResult,
  type LifecycleErrorResult,
  type LifecycleErrorStatus,
} from "../utils/tauriErrorMarkers";
import { openSambeeStatusPage } from "../utils/openSambeeStatusPage";
import "../styles/dialog.css";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Conflict metadata returned by the Rust `finish_editing` command. */
export interface ConflictInfo {
  /** UUID of the edit operation. */
  operation_id: string;
  /** Display filename. */
  filename: string;
  /** Server `modified_at` at download time (ISO 8601). */
  download_modified: string;
  /** Current server `modified_at` (ISO 8601). */
  server_modified: string;
  /** Server URL used to reopen Sambee after terminal lifecycle failures. */
  server_url: string;
}

type ConflictResolutionResult = CompletedResult | AuthRetryResult | LifecycleErrorResult;

function conflictLifecycleMessage(status: LifecycleErrorStatus, fallbackMessage: string) {
  switch (status) {
    case "renewal_required":
      return translate("conflictDialog.lifecycle.renewalRequired", { message: fallbackMessage });
    case "auth_failed":
      return translate("conflictDialog.lifecycle.authFailed", { message: fallbackMessage });
    case "lock_lost":
      return translate("conflictDialog.lifecycle.lockLost", { message: fallbackMessage });
    case "recovery_required":
      return translate("conflictDialog.lifecycle.recoveryRequired", { message: fallbackMessage });
  }
}

function blockedLifecyclePrimaryActionLabel(status: LifecycleErrorStatus) {
  switch (status) {
    case "renewal_required":
      return translate("doneEditing.buttons.reopenRequired");
    case "auth_failed":
      return translate("doneEditing.buttons.authFailed");
    case "lock_lost":
      return translate("doneEditing.buttons.lockLost");
    case "recovery_required":
      return translate("doneEditing.buttons.recoveryRequired");
  }
}

/** Props for the ConflictDialog component. */
interface ConflictDialogProps {
  /** Conflict details from the server check. */
  conflict: ConflictInfo;
  /** Called when the dialog is resolved or cancelled. */
  onResolved: () => void;
  /** Optional override used by browser previews for the overwrite action. */
  onOverwriteAction?: () => Promise<ConflictResolutionResult | void>;
  /** Optional override used by browser previews for the save-copy action. */
  onSaveCopyAction?: () => Promise<ConflictResolutionResult | void>;
  /** Optional lifecycle hook used by previews/tests to reopen Sambee after a terminal status. */
  onBlockedLifecycleAction?: (status: LifecycleErrorStatus, serverUrl: string) => Promise<void>;
  /** Optional lifecycle hook used by previews after a successful action. */
  onActionComplete?: (action: "overwrite" | "saveCopy" | "cancel") => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

//
// ConflictDialog
//
/**
 * Inline conflict resolution dialog.
 */
export function ConflictDialog({
  conflict,
  onResolved,
  onOverwriteAction,
  onSaveCopyAction,
  onBlockedLifecycleAction,
  onActionComplete,
}: ConflictDialogProps) {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedLifecycle, setBlockedLifecycle] = useState<LifecycleErrorStatus | null>(null);

  const handleBlockedLifecycleAction = useCallback(async () => {
    if (!blockedLifecycle) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (onBlockedLifecycleAction) {
        await onBlockedLifecycleAction(blockedLifecycle, conflict.server_url);
      } else {
        await openSambeeStatusPage(conflict.server_url, blockedLifecycle);
      }
    } catch (e) {
      setError(getTauriErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [blockedLifecycle, conflict.server_url, onBlockedLifecycleAction]);

  const primaryActionLabel = blockedLifecycle
    ? blockedLifecyclePrimaryActionLabel(blockedLifecycle)
    : translate("conflictDialog.actions.overwrite");

  //
  // handleOverwrite
  //
  const handleOverwrite = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    setError(null);
    setBlockedLifecycle(null);
    try {
      const result = onOverwriteAction
        ? await onOverwriteAction()
        : await invoke<ConflictResolutionResult>("resolve_conflict_overwrite", {
            operationId: conflict.operation_id,
          });

      if (isAuthRetryResult(result, "conflict")) {
        setNotice(translate("conflictDialog.authRefreshedRetry"));
        setLoading(false);
        return;
      }
      if (isLifecycleErrorResult(result)) {
        setBlockedLifecycle(result.status);
        setError(conflictLifecycleMessage(result.status, result.message));
        setLoading(false);
        return;
      }

      onActionComplete?.("overwrite");
    } catch (e) {
      setError(getTauriErrorMessage(e));
      setLoading(false);
    }
  }, [conflict.operation_id, onActionComplete, onOverwriteAction]);

  //
  // handleSaveAsCopy
  //
  const handleSaveAsCopy = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    setError(null);
    setBlockedLifecycle(null);
    try {
      const result = onSaveCopyAction
        ? await onSaveCopyAction()
        : await invoke<ConflictResolutionResult>("resolve_conflict_save_copy", {
            operationId: conflict.operation_id,
          });

      if (isAuthRetryResult(result, "conflict")) {
        setNotice(translate("conflictDialog.authRefreshedRetry"));
        setLoading(false);
        return;
      }
      if (isLifecycleErrorResult(result)) {
        setBlockedLifecycle(result.status);
        setError(conflictLifecycleMessage(result.status, result.message));
        setLoading(false);
        return;
      }

      onActionComplete?.("saveCopy");
    } catch (e) {
      setError(getTauriErrorMessage(e));
      setLoading(false);
    }
  }, [conflict.operation_id, onActionComplete, onSaveCopyAction]);

  //
  // handleCancel
  //
  const handleCancel = useCallback(() => {
    onActionComplete?.("cancel");
    onResolved();
  }, [onActionComplete, onResolved]);

  return (
    <div class="done-editing-window">
      <h2 class="dialog-title dialog-title--warning">{translate("conflictDialog.title")}</h2>
      <p class="dialog-subtitle">{conflict.filename}</p>

      <div class="dialog-body">
        <p>{translate("conflictDialog.body")}</p>
        <div class="dialog-detail">
          <div>
            <strong>{translate("conflictDialog.labels.yourDownload")}</strong> {conflict.download_modified}
          </div>
          <div>
            <strong>{translate("conflictDialog.labels.serverVersion")}</strong> {conflict.server_modified}
          </div>
        </div>
      </div>

      {notice && <p class="done-editing-notice">{notice}</p>}

      <div class="dialog-actions">
        <button
          type="button"
          class="dialog-btn dialog-btn--primary"
          onClick={blockedLifecycle ? () => void handleBlockedLifecycleAction() : handleOverwrite}
          disabled={loading}
        >
          {primaryActionLabel}
        </button>
        <button
          type="button"
          class="dialog-btn dialog-btn--ghost"
          onClick={handleSaveAsCopy}
          disabled={loading || blockedLifecycle !== null}
        >
          {translate("conflictDialog.actions.saveCopy")}
        </button>
        <button type="button" class="dialog-btn dialog-btn--ghost" onClick={handleCancel} disabled={loading}>
          {translate("conflictDialog.actions.cancel")}
        </button>
      </div>

      {error && <p class="dialog-error">{error}</p>}
    </div>
  );
}
