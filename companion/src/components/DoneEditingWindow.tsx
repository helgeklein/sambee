/**
 * "Done Editing" window component.
 *
 * Displays when a file is open in a native editor. Shows:
 * - Filename and app name
 * - Live file status (Unchanged / Modified at HH:MM:SS)
 * - Hold-to-confirm "Done Editing" button (uploads if modified, closes if not)
 * - Hold-to-confirm "Discard Changes" button (only when file is modified)
 *
 * The window receives edit context and file status via Tauri events emitted
 * from the Rust backend.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { translate } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import type { ConflictInfo } from "./ConflictDialog";
import { ConflictDialog } from "./ConflictDialog";
import "../styles/done-editing.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Hold duration in milliseconds before action fires. */
const HOLD_DURATION_MS = 1500;

/** Hold duration in seconds for translated assistive labels. */
const HOLD_DURATION_SECONDS = HOLD_DURATION_MS / 1000;

/** Prefix returned by `finish_editing` when a conflict is detected. */
const CONFLICT_PREFIX = "conflict:";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Context payload received from the Rust backend via "edit-context" event. */
interface EditContext {
  operation_id: string;
  filename: string;
  app_name: string;
}

/** File status sent from the Rust file polling background task. */
type FileStatus = { kind: "unchanged" } | { kind: "modified"; modifiedAt: string };

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

//
// DoneEditingWindow
//
/**
 * Main component for the Done Editing secondary window.
 */
export function DoneEditingWindow() {
  const { t } = useI18n();
  const [context, setContext] = useState<EditContext | null>(null);
  const [fileStatus, setFileStatus] = useState<FileStatus>({
    kind: "unchanged",
  });
  const [holdProgress, setHoldProgress] = useState(0);
  const [discardHoldProgress, setDiscardHoldProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const holdStart = useRef<number | null>(null);
  const discardHoldStart = useRef<number | null>(null);
  const animFrame = useRef<number>(0);
  /** Stores the action callback when hold duration is met, fires on key/mouse release. */
  const pendingAction = useRef<(() => void) | null>(null);

  const isModified = fileStatus.kind === "modified";

  // ── Event listeners ──────────────────────────────────────────────────

  useEffect(() => {
    const unlistenContext = listen<EditContext>("edit-context", (event) => {
      setContext(event.payload);
    });

    const unlistenStatus = listen<FileStatus>("file-status", (event) => {
      setFileStatus(event.payload);
    });

    const unlistenUpload = listen<{ progress: number }>("upload-progress", (event) => {
      setUploadProgress(event.payload.progress);
    });

    void invoke<EditContext>("get_done_editing_context", {
      windowLabel: getCurrentWindow().label,
    })
      .then((payload) => {
        setContext(payload);
      })
      .catch(() => {
        // The initial edit-context event still handles the normal path.
      });

    return () => {
      unlistenContext.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
      unlistenUpload.then((fn) => fn());
    };
  }, []);

  // ── Hold-to-confirm logic ────────────────────────────────────────────

  //
  // startHold
  //
  const startHold = useCallback(
    (setter: (v: number) => void, startRef: { current: number | null }, onComplete: () => void) => {
      if (processing) return;
      startRef.current = performance.now();
      pendingAction.current = null;

      const tick = () => {
        if (startRef.current === null) return;
        const elapsed = performance.now() - startRef.current;
        const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
        setter(progress);

        if (progress >= 1) {
          // Hold duration met — wait for key/mouse release before firing
          // to prevent the release event from leaking into the next focused window.
          startRef.current = null;
          pendingAction.current = onComplete;
        } else {
          animFrame.current = requestAnimationFrame(tick);
        }
      };
      tick();
    },
    [processing]
  );

  //
  // cancelHold
  //
  const cancelHold = useCallback((setter: (v: number) => void, startRef: { current: number | null }) => {
    startRef.current = null;
    cancelAnimationFrame(animFrame.current);
    pendingAction.current = null;
    setter(0);
  }, []);

  //
  // releaseHold
  //
  /** Fires the pending action on key/mouse release, or cancels if hold was incomplete. */
  const releaseHold = useCallback(
    (setter: (v: number) => void, startRef: { current: number | null }) => {
      if (pendingAction.current) {
        const action = pendingAction.current;
        pendingAction.current = null;
        setter(0);
        action();
      } else {
        cancelHold(setter, startRef);
      }
    },
    [cancelHold]
  );

  // ── Actions ──────────────────────────────────────────────────────────

  //
  // confirmDone
  //
  const confirmDone = useCallback(async () => {
    if (!context) return;
    setProcessing(true);
    setError(null);
    try {
      const result = await invoke<string>("finish_editing", {
        operationId: context.operation_id,
      });

      // Check if the result indicates a conflict
      if (typeof result === "string" && result.startsWith(CONFLICT_PREFIX)) {
        const conflictJson = result.slice(CONFLICT_PREFIX.length);
        try {
          const info: ConflictInfo = JSON.parse(conflictJson);
          setConflict(info);
          setProcessing(false);
        } catch {
          setError(translate("doneEditing.parseConflictError"));
          setProcessing(false);
        }
        return;
      }
      // Normal success — window will be closed by Rust
    } catch (e) {
      setError(String(e));
      setProcessing(false);
    }
  }, [context]);

  //
  // confirmDiscard
  //
  const confirmDiscard = useCallback(async () => {
    if (!context) return;
    setProcessing(true);
    setError(null);
    try {
      await invoke("discard_editing", {
        operationId: context.operation_id,
      });
    } catch (e) {
      setError(String(e));
      setProcessing(false);
    }
  }, [context]);

  // ── Event handler factories ──────────────────────────────────────────

  //
  // makeHandlers
  //
  const makeHandlers = useCallback(
    (setter: (v: number) => void, startRef: { current: number | null }, onComplete: () => void) => ({
      onMouseDown: () => startHold(setter, startRef, onComplete),
      onMouseUp: () => releaseHold(setter, startRef),
      onMouseLeave: () => cancelHold(setter, startRef),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startHold(setter, startRef, onComplete);
        }
      },
      onKeyUp: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          releaseHold(setter, startRef);
        } else if (e.key === "Escape") {
          cancelHold(setter, startRef);
        }
      },
    }),
    [startHold, cancelHold, releaseHold]
  );

  const doneHandlers = makeHandlers(setHoldProgress, holdStart, confirmDone);
  const discardHandlers = makeHandlers(setDiscardHoldProgress, discardHoldStart, confirmDiscard);

  // ── Button label ─────────────────────────────────────────────────────

  const doneButtonLabel = processing
    ? isModified
      ? t("doneEditing.buttons.uploading")
      : t("doneEditing.buttons.closing")
    : isModified
      ? t("doneEditing.buttons.doneUpload")
      : t("doneEditing.buttons.doneClose");

  // ── Render ───────────────────────────────────────────────────────────

  if (!context) {
    return (
      <div class="done-editing-window done-editing-window--loading">
        <p>{t("doneEditing.waitingForContext")}</p>
      </div>
    );
  }

  // Show conflict resolution dialog if a conflict was detected
  if (conflict) {
    return (
      <ConflictDialog
        conflict={conflict}
        onResolved={() => {
          setConflict(null);
          setProcessing(false);
        }}
      />
    );
  }

  return (
    <div class="done-editing-window">
      <h2 class="done-editing-title">✎ {context.filename}</h2>
      <p class="done-editing-app">{t("doneEditing.openedIn", { appName: context.app_name })}</p>

      {/* Live file change status */}
      <p class={`file-status ${isModified ? "file-status--modified" : "file-status--unchanged"}`}>
        {t("doneEditing.statusLabel")}{" "}
        {isModified && fileStatus.kind === "modified"
          ? t("doneEditing.modifiedAt", { time: fileStatus.modifiedAt })
          : t("doneEditing.unchanged")}
      </p>

      {/* Error display */}
      {error && <p class="done-editing-error">{error}</p>}

      {/* Primary: Done Editing (always visible) */}
      <button
        class="btn-primary"
        {...doneHandlers}
        disabled={processing}
        aria-label={
          isModified
            ? t("doneEditing.aria.confirmUpload", { seconds: HOLD_DURATION_SECONDS })
            : t("doneEditing.aria.confirmClose", { seconds: HOLD_DURATION_SECONDS })
        }
      >
        {doneButtonLabel}
      </button>
      {holdProgress > 0 && (
        <div class="hold-progress-track" role="progressbar" aria-valuenow={Math.round(holdProgress * 100)} aria-valuemax={100}>
          <div class="hold-progress-fill" style={{ width: `${holdProgress * 100}%` }} />
        </div>
      )}

      {/* Upload progress (visible only while uploading a modified file) */}
      {processing && isModified && (
        <div
          class="upload-progress-track"
          role="progressbar"
          aria-valuenow={Math.round(uploadProgress * 100)}
          aria-valuemax={100}
          aria-label={t("doneEditing.aria.uploadProgress")}
        >
          <div class="upload-progress-fill" style={{ width: `${uploadProgress * 100}%` }} />
        </div>
      )}

      {/* Secondary: Discard Changes (only visible when file is modified) */}
      {isModified && !processing && (
        <>
          <button
            class="btn-secondary btn-small"
            {...discardHandlers}
            disabled={processing}
            aria-label={t("doneEditing.aria.discardChanges", { seconds: HOLD_DURATION_SECONDS })}
          >
            {t("doneEditing.buttons.discardHold")}
          </button>
          {discardHoldProgress > 0 && (
            <div
              class="hold-progress-track hold-progress-track--small"
              role="progressbar"
              aria-valuenow={Math.round(discardHoldProgress * 100)}
              aria-valuemax={100}
            >
              <div class="hold-progress-fill hold-progress-fill--danger" style={{ width: `${discardHoldProgress * 100}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
