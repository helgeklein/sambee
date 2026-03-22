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
}

/** Props for the ConflictDialog component. */
interface ConflictDialogProps {
  /** Conflict details from the server check. */
  conflict: ConflictInfo;
  /** Called when the dialog is resolved or cancelled. */
  onResolved: () => void;
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
export function ConflictDialog({ conflict, onResolved }: ConflictDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  //
  // handleOverwrite
  //
  const handleOverwrite = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("resolve_conflict_overwrite", {
        operationId: conflict.operation_id,
      });
      // Window will be closed by the Rust command
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, [conflict.operation_id]);

  //
  // handleSaveAsCopy
  //
  const handleSaveAsCopy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("resolve_conflict_save_copy", {
        operationId: conflict.operation_id,
      });
      // Window will be closed by the Rust command
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, [conflict.operation_id]);

  //
  // handleCancel
  //
  const handleCancel = useCallback(() => {
    onResolved();
  }, [onResolved]);

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

      <div class="dialog-actions">
        <button type="button" class="dialog-btn dialog-btn--primary" onClick={handleOverwrite} disabled={loading}>
          {translate("conflictDialog.actions.overwrite")}
        </button>
        <button type="button" class="dialog-btn dialog-btn--ghost" onClick={handleSaveAsCopy} disabled={loading}>
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
