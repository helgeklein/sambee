/**
 * Recovery dialog for leftover operations from previous sessions.
 *
 * Shown in the main App window when the Rust backend emits a
 * "leftover-operations" event on startup. Displays one card per
 * leftover file with three recovery options:
 * - **Upload**: Re-upload the local file to the server.
 * - **Discard**: Move the file to the recycle bin.
 * - **Keep for Later**: Dismiss (file stays for next startup).
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "preact/hooks";

import { translate } from "../i18n";
import { openSambeeStatusPage } from "../utils/openSambeeStatusPage";
import {
  type AuthRetryResult,
  getTauriErrorMessage,
  isAuthRetryResult,
  isLifecycleErrorResult,
  type LifecycleErrorResult,
  type LifecycleErrorStatus,
} from "../utils/tauriErrorMarkers";
import { ModalDialog } from "./ModalDialog";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Leftover operation info emitted by the Rust backend. */
export interface LeftoverInfo {
  /** Path to the operation directory. */
  operation_dir: string;
  /** Display filename. */
  filename: string;
  /** Server URL the file belongs to. */
  server_url: string;
  /** Remote path on the server. */
  remote_path: string;
  /** Connection ID. */
  connection_id: string;
  /** Last modified time of the local file (formatted). */
  local_modified: string;
}

/** Props for the RecoveryDialog component. */
interface RecoveryDialogProps {
  /** List of leftover operations to recover. */
  leftovers: LeftoverInfo[];
  /** Called when all leftovers have been handled (or dismissed). */
  onDone: () => void;
  /** Optional override used by browser previews for upload. */
  onUploadAction?: (operationDir: string) => Promise<RecoveryUploadResult | undefined>;
  /** Optional override used by browser previews for discard. */
  onDiscardAction?: (operationDir: string) => Promise<void>;
  /** Optional override used by browser previews for dismiss. */
  onDismissAction?: (operationDir: string) => Promise<void>;
  /** Optional lifecycle hook used by previews/tests to reopen Sambee after a terminal status. */
  onBlockedLifecycleAction?: (status: LifecycleErrorStatus, serverUrl: string) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/** Tracks the resolution state of each leftover. */
interface ItemState {
  /** Whether the item is currently being processed. */
  loading: boolean;
  /** Informational message shown when auth was refreshed and the action should be retried. */
  notice: string | null;
  /** Error message if the action failed. */
  error: string | null;
  /** Whether this item has been resolved. */
  resolved: boolean;
  /** Terminal lifecycle state that requires reopening the file from Sambee. */
  blockedLifecycle: LifecycleErrorStatus | null;
}

type RecoveryUploadResult =
  | AuthRetryResult
  | LifecycleErrorResult
  | {
      status: "completed";
      message: string;
    };

//
// RecoveryDialog
//
/**
 * Displays recovery cards for leftover operations found on startup.
 */
export function RecoveryDialog({
  leftovers,
  onDone,
  onUploadAction,
  onDiscardAction,
  onDismissAction,
  onBlockedLifecycleAction,
}: RecoveryDialogProps) {
  const lifecycleMessage = useCallback((status: LifecycleErrorStatus, fallbackMessage: string) => {
    switch (status) {
      case "renewal_required":
        return translate("recovery.lifecycle.renewalRequired", { message: fallbackMessage });
      case "auth_failed":
        return translate("recovery.lifecycle.authFailed", { message: fallbackMessage });
      case "lock_lost":
        return translate("recovery.lifecycle.lockLost", { message: fallbackMessage });
      case "recovery_required":
        return translate("recovery.lifecycle.recoveryRequired", { message: fallbackMessage });
    }
  }, []);

  const blockedLifecyclePrimaryActionLabel = useCallback((status: LifecycleErrorStatus) => {
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
  }, []);

  const [states, setStates] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    for (const l of leftovers) {
      init[l.operation_dir] = { loading: false, notice: null, error: null, resolved: false, blockedLifecycle: null };
    }
    return init;
  });

  //
  // updateItemState
  //
  const updateItemState = useCallback((key: string, patch: Partial<ItemState>) => {
    setStates((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }, []);

  //
  // checkAllResolved
  //
  const checkAllResolved = useCallback(
    (updated: Record<string, ItemState>) => {
      const allDone = Object.values(updated).every((s) => s.resolved);
      if (allDone) {
        onDone();
      }
    },
    [onDone]
  );

  //
  // handleUpload
  //
  const handleUpload = useCallback(
    async (operationDir: string) => {
      updateItemState(operationDir, { loading: true, notice: null, error: null, blockedLifecycle: null });
      try {
        if (onUploadAction) {
          const result = await onUploadAction(operationDir);
          if (isAuthRetryResult(result, "upload")) {
            updateItemState(operationDir, {
              loading: false,
              notice: translate("recovery.authRefreshedRetryUpload"),
              error: null,
            });
            return;
          }
          if (isLifecycleErrorResult(result)) {
            updateItemState(operationDir, {
              loading: false,
              notice: null,
              error: lifecycleMessage(result.status, result.message),
              blockedLifecycle: result.status,
            });
            return;
          }
        } else {
          const result = await invoke<RecoveryUploadResult>("recovery_upload", { operationDir });
          if (isAuthRetryResult(result, "upload")) {
            updateItemState(operationDir, {
              loading: false,
              notice: translate("recovery.authRefreshedRetryUpload"),
              error: null,
            });
            return;
          }
          if (isLifecycleErrorResult(result)) {
            updateItemState(operationDir, {
              loading: false,
              notice: null,
              error: lifecycleMessage(result.status, result.message),
              blockedLifecycle: result.status,
            });
            return;
          }
        }
        const updated = {
          ...states,
          [operationDir]: { loading: false, notice: null, error: null, resolved: true, blockedLifecycle: null },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: getTauriErrorMessage(e) });
      }
    },
    [checkAllResolved, onUploadAction, states, updateItemState]
  );

  const handleBlockedLifecycleAction = useCallback(
    async (status: LifecycleErrorStatus, serverUrl: string, operationDir: string) => {
      updateItemState(operationDir, { loading: true, error: null });
      try {
        if (onBlockedLifecycleAction) {
          await onBlockedLifecycleAction(status, serverUrl);
        } else {
          await openSambeeStatusPage(serverUrl, status);
        }
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: getTauriErrorMessage(e) });
        return;
      }

      updateItemState(operationDir, { loading: false });
    },
    [onBlockedLifecycleAction, updateItemState]
  );

  //
  // handleDiscard
  //
  const handleDiscard = useCallback(
    async (operationDir: string) => {
      updateItemState(operationDir, { loading: true, notice: null, error: null });
      try {
        if (onDiscardAction) {
          await onDiscardAction(operationDir);
        } else {
          await invoke("recovery_discard", { operationDir });
        }
        const updated = {
          ...states,
          [operationDir]: { loading: false, notice: null, error: null, resolved: true, blockedLifecycle: null },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: getTauriErrorMessage(e) });
      }
    },
    [checkAllResolved, onDiscardAction, states, updateItemState]
  );

  //
  // handleDismiss
  //
  const handleDismiss = useCallback(
    async (operationDir: string) => {
      updateItemState(operationDir, { loading: true, notice: null, error: null });
      try {
        if (onDismissAction) {
          await onDismissAction(operationDir);
        } else {
          await invoke("recovery_dismiss", { operationDir });
        }
        const updated = {
          ...states,
          [operationDir]: { loading: false, notice: null, error: null, resolved: true, blockedLifecycle: null },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: getTauriErrorMessage(e) });
      }
    },
    [checkAllResolved, onDismissAction, states, updateItemState]
  );

  //
  // handleDismissAll
  //
  const handleDismissAll = useCallback(() => {
    onDone();
  }, [onDone]);

  // Filter to only show unresolved items
  const pendingLeftovers = leftovers.filter((l) => !states[l.operation_dir]?.resolved);

  if (pendingLeftovers.length === 0) {
    return null;
  }

  return (
    <ModalDialog titleId="recovery-dialog-title">
      <h2 id="recovery-dialog-title" class="dialog-title dialog-title--warning">
        {translate("recovery.title")}
      </h2>
      <p class="dialog-subtitle">{translate("recovery.subtitle", { count: pendingLeftovers.length })}</p>

      <div class="recovery-list">
        {pendingLeftovers.map((leftover) => {
          const state = states[leftover.operation_dir];
          return (
            <div class="recovery-item" key={leftover.operation_dir}>
              <div class="recovery-item-header">
                <span class="recovery-item-filename">{leftover.filename}</span>
              </div>
              <div class="recovery-item-detail">
                {translate("recovery.detail", { remotePath: leftover.remote_path, localModified: leftover.local_modified })}
              </div>
              <div class="recovery-item-actions">
                <button
                  type="button"
                  class="dialog-btn dialog-btn--primary"
                  onClick={() =>
                    state?.blockedLifecycle
                      ? void handleBlockedLifecycleAction(state.blockedLifecycle, leftover.server_url, leftover.operation_dir)
                      : void handleUpload(leftover.operation_dir)
                  }
                  disabled={state?.loading}
                >
                  {state?.blockedLifecycle
                    ? blockedLifecyclePrimaryActionLabel(state.blockedLifecycle)
                    : state?.notice
                      ? translate("recovery.actions.retryUpload")
                      : translate("recovery.actions.upload")}
                </button>
                <button
                  type="button"
                  class="dialog-btn dialog-btn--danger"
                  onClick={() => handleDiscard(leftover.operation_dir)}
                  disabled={state?.loading}
                >
                  {translate("recovery.actions.discard")}
                </button>
                <button
                  type="button"
                  class="dialog-btn dialog-btn--ghost"
                  onClick={() => handleDismiss(leftover.operation_dir)}
                  disabled={state?.loading}
                >
                  {translate("recovery.actions.later")}
                </button>
              </div>
              {state?.notice && <p class="dialog-notice">{state.notice}</p>}
              {state?.error && <p class="dialog-error">{state.error}</p>}
            </div>
          );
        })}
      </div>

      <div class="dialog-actions dialog-actions--row">
        <button type="button" class="dialog-btn dialog-btn--ghost" onClick={handleDismissAll}>
          {translate("recovery.actions.dismissAll")}
        </button>
      </div>
    </ModalDialog>
  );
}
