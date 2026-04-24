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
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { translate } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import type { ConflictInfo } from "./ConflictDialog";
import { ConflictDialog } from "./ConflictDialog";
import "../styles/done-editing.css";

const HOLD_DURATION_MS = 1500;
const HOLD_DURATION_SECONDS = HOLD_DURATION_MS / 1000;
const CONFLICT_PREFIX = "conflict:";

export interface DoneEditingContext {
  operation_id: string;
  filename: string;
  app_name: string;
}

export type DoneEditingFileStatus = { kind: "unchanged" } | { kind: "modified"; modifiedAt: string };

export type DoneEditingButtonHandlers = Pick<
  JSX.HTMLAttributes<HTMLButtonElement>,
  "onMouseDown" | "onMouseUp" | "onMouseLeave" | "onKeyDown" | "onKeyUp"
>;

interface DoneEditingWindowViewProps {
  context: DoneEditingContext;
  fileStatus: DoneEditingFileStatus;
  processing: boolean;
  uploadProgress: number;
  error: string | null;
  conflict: ConflictInfo | null;
  holdProgress: number;
  discardHoldProgress: number;
  doneButtonLabel: string;
  doneAriaLabel: string;
  discardAriaLabel: string;
  doneHandlers: DoneEditingButtonHandlers;
  discardHandlers: DoneEditingButtonHandlers;
  onConflictResolved: () => void;
}

export function DoneEditingWindow() {
  const { t } = useI18n();
  const [context, setContext] = useState<DoneEditingContext | null>(null);
  const [fileStatus, setFileStatus] = useState<DoneEditingFileStatus>({ kind: "unchanged" });
  const [holdProgress, setHoldProgress] = useState(0);
  const [discardHoldProgress, setDiscardHoldProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const holdStart = useRef<number | null>(null);
  const discardHoldStart = useRef<number | null>(null);
  const animFrame = useRef<number>(0);
  const pendingAction = useRef<(() => void) | null>(null);

  const isModified = fileStatus.kind === "modified";

  useEffect(() => {
    const unlistenContext = listen<DoneEditingContext>("edit-context", (event) => {
      setContext(event.payload);
    });

    const unlistenStatus = listen<DoneEditingFileStatus>("file-status", (event) => {
      setFileStatus(event.payload);
    });

    const unlistenUpload = listen<{ progress: number }>("upload-progress", (event) => {
      setUploadProgress(event.payload.progress);
    });

    void invoke<DoneEditingContext>("get_done_editing_context", {
      windowLabel: getCurrentWindow().label,
    })
      .then((payload) => {
        setContext(payload);
      })
      .catch(() => {
        // The initial edit-context event still handles the normal path.
      });

    return () => {
      void unlistenContext.then((fn) => fn());
      void unlistenStatus.then((fn) => fn());
      void unlistenUpload.then((fn) => fn());
    };
  }, []);

  const startHold = useCallback(
    (setter: (value: number) => void, startRef: { current: number | null }, onComplete: () => void) => {
      if (processing) return;

      startRef.current = performance.now();
      pendingAction.current = null;

      const tick = () => {
        if (startRef.current === null) return;

        const elapsed = performance.now() - startRef.current;
        const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
        setter(progress);

        if (progress >= 1) {
          startRef.current = null;
          pendingAction.current = onComplete;
          return;
        }

        animFrame.current = requestAnimationFrame(tick);
      };

      tick();
    },
    [processing]
  );

  const cancelHold = useCallback((setter: (value: number) => void, startRef: { current: number | null }) => {
    startRef.current = null;
    cancelAnimationFrame(animFrame.current);
    pendingAction.current = null;
    setter(0);
  }, []);

  const releaseHold = useCallback(
    (setter: (value: number) => void, startRef: { current: number | null }) => {
      if (pendingAction.current) {
        const action = pendingAction.current;
        pendingAction.current = null;
        setter(0);
        action();
        return;
      }

      cancelHold(setter, startRef);
    },
    [cancelHold]
  );

  const confirmDone = useCallback(async () => {
    if (!context) return;

    setProcessing(true);
    setError(null);

    try {
      const result = await invoke<string>("finish_editing", {
        operationId: context.operation_id,
      });

      if (typeof result === "string" && result.startsWith(CONFLICT_PREFIX)) {
        const conflictJson = result.slice(CONFLICT_PREFIX.length);
        try {
          setConflict(JSON.parse(conflictJson) as ConflictInfo);
          setProcessing(false);
        } catch {
          setError(translate("doneEditing.parseConflictError"));
          setProcessing(false);
        }
      }
    } catch (err) {
      setError(String(err));
      setProcessing(false);
    }
  }, [context]);

  const confirmDiscard = useCallback(async () => {
    if (!context) return;

    setProcessing(true);
    setError(null);

    try {
      await invoke("discard_editing", {
        operationId: context.operation_id,
      });
    } catch (err) {
      setError(String(err));
      setProcessing(false);
    }
  }, [context]);

  const makeHandlers = useCallback(
    (setter: (value: number) => void, startRef: { current: number | null }, onComplete: () => void): DoneEditingButtonHandlers => ({
      onMouseDown: () => startHold(setter, startRef, onComplete),
      onMouseUp: () => releaseHold(setter, startRef),
      onMouseLeave: () => cancelHold(setter, startRef),
      onKeyDown: (event) => {
        if (event.repeat) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startHold(setter, startRef, onComplete);
        }
      },
      onKeyUp: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          releaseHold(setter, startRef);
        } else if (event.key === "Escape") {
          cancelHold(setter, startRef);
        }
      },
    }),
    [cancelHold, releaseHold, startHold]
  );

  const doneHandlers = makeHandlers(setHoldProgress, holdStart, confirmDone);
  const discardHandlers = makeHandlers(setDiscardHoldProgress, discardHoldStart, confirmDiscard);

  const doneButtonLabel = processing
    ? isModified
      ? t("doneEditing.buttons.uploading")
      : t("doneEditing.buttons.closing")
    : isModified
      ? t("doneEditing.buttons.doneUpload")
      : t("doneEditing.buttons.doneClose");

  if (!context) {
    return (
      <div class="done-editing-window done-editing-window--loading">
        <p>{t("doneEditing.waitingForContext")}</p>
      </div>
    );
  }

  return (
    <DoneEditingWindowView
      context={context}
      fileStatus={fileStatus}
      processing={processing}
      uploadProgress={uploadProgress}
      error={error}
      conflict={conflict}
      holdProgress={holdProgress}
      discardHoldProgress={discardHoldProgress}
      doneButtonLabel={doneButtonLabel}
      doneAriaLabel={
        isModified
          ? t("doneEditing.aria.confirmUpload", { seconds: HOLD_DURATION_SECONDS })
          : t("doneEditing.aria.confirmClose", { seconds: HOLD_DURATION_SECONDS })
      }
      discardAriaLabel={t("doneEditing.aria.discardChanges", { seconds: HOLD_DURATION_SECONDS })}
      doneHandlers={doneHandlers}
      discardHandlers={discardHandlers}
      onConflictResolved={() => {
        setConflict(null);
        setProcessing(false);
      }}
    />
  );
}

export function DoneEditingWindowView({
  context,
  fileStatus,
  processing,
  uploadProgress,
  error,
  conflict,
  holdProgress,
  discardHoldProgress,
  doneButtonLabel,
  doneAriaLabel,
  discardAriaLabel,
  doneHandlers,
  discardHandlers,
  onConflictResolved,
}: DoneEditingWindowViewProps) {
  const { t } = useI18n();
  const isModified = fileStatus.kind === "modified";

  if (conflict) {
    return <ConflictDialog conflict={conflict} onResolved={onConflictResolved} />;
  }

  return (
    <div class="done-editing-window">
      <h2 class="done-editing-title">✎ {context.filename}</h2>
      <p class="done-editing-app">{t("doneEditing.openedIn", { appName: context.app_name })}</p>

      <p class={`file-status ${isModified ? "file-status--modified" : "file-status--unchanged"}`}>
        {t("doneEditing.statusLabel")}{" "}
        {isModified && fileStatus.kind === "modified"
          ? t("doneEditing.modifiedAt", { time: fileStatus.modifiedAt })
          : t("doneEditing.unchanged")}
      </p>

      {error && <p class="done-editing-error">{error}</p>}

      <button class="btn-primary" {...doneHandlers} disabled={processing} aria-label={doneAriaLabel}>
        {doneButtonLabel}
      </button>
      {holdProgress > 0 && (
        <div class="hold-progress-track" role="progressbar" aria-valuenow={Math.round(holdProgress * 100)} aria-valuemax={100}>
          <div class="hold-progress-fill" style={{ width: `${holdProgress * 100}%` }} />
        </div>
      )}

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

      {isModified && !processing && (
        <>
          <button class="btn-secondary btn-small" {...discardHandlers} disabled={processing} aria-label={discardAriaLabel}>
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
