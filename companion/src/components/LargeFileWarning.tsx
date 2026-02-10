/**
 * Large-file warning dialog.
 *
 * Shown in the main App window when the Rust edit lifecycle detects that
 * the file to be downloaded exceeds the configured size threshold.
 * The lifecycle pauses until the user responds.
 *
 * Two options:
 * - **Continue Anyway**: Proceed with the download.
 * - **Cancel**: Abort the edit lifecycle.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "preact/hooks";

import "../styles/dialog.css";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Payload emitted by the Rust "confirm-large-file" event. */
export interface LargeFileInfo {
  /** Opaque confirmation ID for the pending lifecycle. */
  confirm_id: string;
  /** Display filename. */
  filename: string;
  /** File size in megabytes. */
  size_mb: number;
  /** Configured limit in megabytes. */
  limit_mb: number;
}

/** Props for the LargeFileWarning component. */
interface LargeFileWarningProps {
  /** Large file metadata from the Rust event. */
  info: LargeFileInfo;
  /** Called after the user responds (proceed or cancel). */
  onResolved: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

//
// LargeFileWarning
//
/**
 * Blocking dialog that asks whether to proceed with a large file download.
 */
export function LargeFileWarning({ info, onResolved }: LargeFileWarningProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  //
  // respond
  //
  const respond = useCallback(
    async (proceed: boolean) => {
      setLoading(true);
      setError(null);
      try {
        await invoke("confirm_large_download", {
          confirmId: info.confirm_id,
          proceed,
        });
        onResolved();
      } catch (e) {
        setError(String(e));
        setLoading(false);
      }
    },
    [info.confirm_id, onResolved]
  );

  //
  // handleContinue
  //
  const handleContinue = useCallback(() => respond(true), [respond]);

  //
  // handleCancel
  //
  const handleCancel = useCallback(() => respond(false), [respond]);

  return (
    <div class="dialog-overlay">
      <div class="dialog-panel">
        <h2 class="dialog-title dialog-title--warning">⚠ Large File</h2>
        <p class="dialog-subtitle">{info.filename}</p>

        <div class="dialog-body">
          <p>
            This file is <strong>{info.size_mb} MB</strong> (limit: {info.limit_mb} MB). Downloading and syncing large files may be slow and
            use significant disk space.
          </p>
        </div>

        <div class="dialog-actions">
          <button type="button" class="dialog-btn dialog-btn--primary" onClick={handleContinue} disabled={loading}>
            Continue Anyway
          </button>
          <button type="button" class="dialog-btn dialog-btn--ghost" onClick={handleCancel} disabled={loading}>
            Cancel
          </button>
        </div>

        {error && <p class="dialog-error">{error}</p>}
      </div>
    </div>
  );
}
