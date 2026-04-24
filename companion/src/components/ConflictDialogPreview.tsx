import { useMemo, useState } from "preact/hooks";
import { ConflictDialog, type ConflictInfo } from "./ConflictDialog";
import { DialogPreviewLayout, type PreviewThemeMode } from "./DialogPreviewLayout";

type PreviewActionResult = "success" | "error";

const PREVIEW_CONFLICT: ConflictInfo = {
  operation_id: "preview-conflict-operation",
  filename: "Quarterly Budget.xlsx",
  download_modified: "2026-04-24 12:14:03",
  server_modified: "2026-04-24 12:21:47",
};

/** Browser-only preview for the conflict dialog. */
export function ConflictDialogPreview() {
  const [themeMode, setThemeMode] = useState<PreviewThemeMode>("light");
  const [actionResult, setActionResult] = useState<PreviewActionResult>("success");
  const [visible, setVisible] = useState(true);
  const [instanceKey, setInstanceKey] = useState(0);

  const actionHandler = useMemo(
    () => async () => {
      if (actionResult === "error") {
        throw new Error("Mock preview error: the conflict action failed.");
      }
      setVisible(false);
    },
    [actionResult]
  );

  const resetPreview = () => {
    setVisible(true);
    setInstanceKey((current) => current + 1);
  };

  return (
    <DialogPreviewLayout
      title="Conflict Dialog"
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
      onReset={resetPreview}
      controls={
        <label class="dialog-preview__field">
          <span>Action result</span>
          <select
            value={actionResult}
            onChange={(event) => setActionResult((event.target as HTMLSelectElement).value as PreviewActionResult)}
          >
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </label>
      }
    >
      {visible ? (
        <div class="dialog-preview__inline-window" key={instanceKey}>
          <ConflictDialog
            conflict={PREVIEW_CONFLICT}
            onResolved={() => {
              setVisible(false);
            }}
            onOverwriteAction={actionHandler}
            onSaveCopyAction={actionHandler}
          />
        </div>
      ) : (
        <div class="dialog-preview__dismissed-card">
          <p>Dialog dismissed. Use Reset Preview to reopen it.</p>
        </div>
      )}
    </DialogPreviewLayout>
  );
}
