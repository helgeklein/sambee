import { useEffect, useRef, useState } from "preact/hooks";
import { translate } from "../i18n";
import { applyTheme, getDefaultTheme } from "../lib/theme";
import type { NativeApp } from "../types";
import { APP_PICKER_FALLBACK_WIDTH, AppPickerView, type AppPickerViewState, measureAppPickerHeight } from "./AppPicker";
import "../styles/app-picker-preview.css";

type PreviewThemeMode = "light" | "dark";
type PreviewStatus = "loaded" | "loading" | "empty" | "error";

const PREVIEW_ERROR_MESSAGE = "Mock backend error: failed to enumerate registered handlers for this file type.";
const PREVIEW_BROWSED_APP_PATH = "C:\\Program Files\\Custom Office\\Spreadsheet Studio.exe";
const PREVIEW_EXTENSIONS = ["xlsx", "docx", "png", "csv"] as const;
const PREVIEW_APPS: NativeApp[] = [
  {
    name: "Editor",
    executable: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsNotepad_11.2501.31.0_x64__8wekyb3d8bbwe\\Notepad\\Notepad.exe",
    icon: null,
    is_default: true,
  },
  {
    name: "LibreOffice Calc",
    executable: "C:\\Program Files\\LibreOffice\\program\\scalc.exe",
    icon: null,
    is_default: false,
  },
  {
    name: "OnlyOffice Desktop Editors",
    executable: "C:\\Users\\demo\\AppData\\Local\\Programs\\ONLYOFFICE\\DesktopEditors\\DesktopEditors.exe",
    icon: null,
    is_default: false,
  },
];

function buildPreviewState(status: PreviewStatus, apps: NativeApp[]): AppPickerViewState {
  switch (status) {
    case "loading":
      return { kind: "loading" };
    case "empty":
      return { kind: "loaded", apps: [] };
    case "error":
      return { kind: "error", message: PREVIEW_ERROR_MESSAGE };
    default:
      return { kind: "loaded", apps };
  }
}

/** Browser-only preview for iterating on the app picker dialog without Tauri. */
export function AppPickerPreview() {
  const [themeMode, setThemeMode] = useState<PreviewThemeMode>("light");
  const [status, setStatus] = useState<PreviewStatus>("loaded");
  const [extension, setExtension] = useState<string>(PREVIEW_EXTENSIONS[0]);
  const [alwaysUse, setAlwaysUse] = useState(false);
  const [apps, setApps] = useState<NativeApp[]>(PREVIEW_APPS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(320);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    applyTheme(getDefaultTheme(themeMode));
  }, [themeMode]);

  useEffect(() => {
    if (status !== "loaded") {
      setSelectedIndex(-1);
      return;
    }

    setSelectedIndex((currentIndex) => {
      if (apps.length === 0) {
        return -1;
      }

      return currentIndex >= 0 && currentIndex < apps.length ? currentIndex : 0;
    });
  }, [apps, status]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const updatePreviewHeight = () => {
      setPreviewHeight(measureAppPickerHeight(panel));
    };

    updatePreviewHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updatePreviewHeight();
    });

    observer.observe(panel);
    return () => {
      observer.disconnect();
    };
  }, [alwaysUse, apps, extension, selectedIndex, status, themeMode]);

  const previewState = buildPreviewState(status, apps);

  return (
    <div
      class="app-picker-preview"
      style={{
        "--app-picker-preview-width": `${APP_PICKER_FALLBACK_WIDTH}px`,
        "--app-picker-preview-height": `${previewHeight}px`,
      }}
    >
      <div class="app-picker-preview__toolbar">
        <div class="app-picker-preview__group">
          <label class="app-picker-preview__field">
            <span>{translate("appPicker.title", { extension: "" }).replace(/\.$/, "")}</span>
            <select value={extension} onChange={(event) => setExtension((event.target as HTMLSelectElement).value)}>
              {PREVIEW_EXTENSIONS.map((value) => (
                <option key={value} value={value}>
                  .{value}
                </option>
              ))}
            </select>
          </label>

          <label class="app-picker-preview__field">
            <span>State</span>
            <select value={status} onChange={(event) => setStatus((event.target as HTMLSelectElement).value as PreviewStatus)}>
              <option value="loaded">Loaded</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
              <option value="error">Error</option>
            </select>
          </label>

          <label class="app-picker-preview__field">
            <span>Theme</span>
            <select value={themeMode} onChange={(event) => setThemeMode((event.target as HTMLSelectElement).value as PreviewThemeMode)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>

        <div class="app-picker-preview__group">
          <button
            type="button"
            class="app-picker-preview__toolbar-btn"
            onClick={() => {
              setApps(PREVIEW_APPS);
              setAlwaysUse(false);
              setSelectedIndex(0);
              setStatus("loaded");
            }}
          >
            Reset Preview
          </button>
        </div>
      </div>

      <div class="app-picker-preview__viewport">
        <div class="app-picker-preview__window">
          <div class="app-picker-preview__window-meta">
            {APP_PICKER_FALLBACK_WIDTH} x {previewHeight}
          </div>
          <AppPickerView
            extension={extension}
            state={previewState}
            selectedIndex={selectedIndex}
            alwaysUse={alwaysUse}
            onSelectIndex={setSelectedIndex}
            onAlwaysUseChange={setAlwaysUse}
            onOpen={() => {}}
            onCancel={() => {}}
            onBrowse={() => {
              setStatus("loaded");
              setApps((currentApps) => {
                const existingIndex = currentApps.findIndex((app) => app.executable === PREVIEW_BROWSED_APP_PATH);
                if (existingIndex >= 0) {
                  setSelectedIndex(existingIndex);
                  return currentApps;
                }

                const updatedApps = [
                  ...currentApps,
                  {
                    name: "Spreadsheet Studio",
                    executable: PREVIEW_BROWSED_APP_PATH,
                    icon: null,
                    is_default: false,
                  },
                ];
                setSelectedIndex(updatedApps.length - 1);
                return updatedApps;
              });
            }}
            panelRef={panelRef}
          />
        </div>
      </div>
    </div>
  );
}
