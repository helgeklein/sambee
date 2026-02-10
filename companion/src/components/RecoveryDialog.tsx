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

import "../styles/dialog.css";

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
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/** Tracks the resolution state of each leftover. */
interface ItemState {
  /** Whether the item is currently being processed. */
  loading: boolean;
  /** Error message if the action failed. */
  error: string | null;
  /** Whether this item has been resolved. */
  resolved: boolean;
}

//
// RecoveryDialog
//
/**
 * Displays recovery cards for leftover operations found on startup.
 */
export function RecoveryDialog({ leftovers, onDone }: RecoveryDialogProps) {
  const [states, setStates] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    for (const l of leftovers) {
      init[l.operation_dir] = { loading: false, error: null, resolved: false };
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
      updateItemState(operationDir, { loading: true, error: null });
      try {
        await invoke("recovery_upload", { operationDir });
        const updated = {
          ...states,
          [operationDir]: { loading: false, error: null, resolved: true },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: String(e) });
      }
    },
    [states, updateItemState, checkAllResolved]
  );

  //
  // handleDiscard
  //
  const handleDiscard = useCallback(
    async (operationDir: string) => {
      updateItemState(operationDir, { loading: true, error: null });
      try {
        await invoke("recovery_discard", { operationDir });
        const updated = {
          ...states,
          [operationDir]: { loading: false, error: null, resolved: true },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: String(e) });
      }
    },
    [states, updateItemState, checkAllResolved]
  );

  //
  // handleDismiss
  //
  const handleDismiss = useCallback(
    async (operationDir: string) => {
      updateItemState(operationDir, { loading: true, error: null });
      try {
        await invoke("recovery_dismiss", { operationDir });
        const updated = {
          ...states,
          [operationDir]: { loading: false, error: null, resolved: true },
        };
        setStates(updated);
        checkAllResolved(updated);
      } catch (e) {
        updateItemState(operationDir, { loading: false, error: String(e) });
      }
    },
    [states, updateItemState, checkAllResolved]
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
    <div class="dialog-overlay">
      <div class="dialog-panel">
        <h2 class="dialog-title dialog-title--warning">Unsaved Files Found</h2>
        <p class="dialog-subtitle">{pendingLeftovers.length} file(s) from a previous session need attention.</p>

        <div class="recovery-list">
          {pendingLeftovers.map((leftover) => {
            const state = states[leftover.operation_dir];
            return (
              <div class="recovery-item" key={leftover.operation_dir}>
                <div class="recovery-item-header">
                  <span class="recovery-item-filename">{leftover.filename}</span>
                </div>
                <div class="recovery-item-detail">
                  {leftover.remote_path} — modified {leftover.local_modified}
                </div>
                <div class="recovery-item-actions">
                  <button
                    type="button"
                    class="dialog-btn dialog-btn--primary"
                    onClick={() => handleUpload(leftover.operation_dir)}
                    disabled={state?.loading}
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    class="dialog-btn dialog-btn--danger"
                    onClick={() => handleDiscard(leftover.operation_dir)}
                    disabled={state?.loading}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    class="dialog-btn dialog-btn--ghost"
                    onClick={() => handleDismiss(leftover.operation_dir)}
                    disabled={state?.loading}
                  >
                    Later
                  </button>
                </div>
                {state?.error && <p class="dialog-error">{state.error}</p>}
              </div>
            );
          })}
        </div>

        <div class="dialog-actions dialog-actions--row">
          <button type="button" class="dialog-btn dialog-btn--ghost" onClick={handleDismissAll}>
            Dismiss All
          </button>
        </div>
      </div>
    </div>
  );
}
