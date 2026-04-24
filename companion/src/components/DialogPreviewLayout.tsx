import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { applyTheme, getDefaultTheme } from "../lib/theme";
import { PreviewIndexLink } from "./PreviewIndexLink";
import "../styles/dialog-preview.css";

export type PreviewThemeMode = "light" | "dark";

interface DialogPreviewLayoutProps {
  title: string;
  themeMode: PreviewThemeMode;
  onThemeModeChange: (mode: PreviewThemeMode) => void;
  onReset: () => void;
  controls?: ComponentChildren;
  children: ComponentChildren;
}

/** Shared browser-only layout for companion dialog previews. */
export function DialogPreviewLayout({ title, themeMode, onThemeModeChange, onReset, controls, children }: DialogPreviewLayoutProps) {
  useEffect(() => {
    applyTheme(getDefaultTheme(themeMode));
  }, [themeMode]);

  return (
    <main class="dialog-preview">
      <div class="dialog-preview__nav">
        <PreviewIndexLink />
      </div>
      <div class="dialog-preview__toolbar">
        <div class="dialog-preview__group">
          <label class="dialog-preview__field">
            <span>{title}</span>
            <select
              value={themeMode}
              onChange={(event) => onThemeModeChange((event.target as HTMLSelectElement).value as PreviewThemeMode)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {controls}
        </div>
        <button type="button" class="dialog-preview__toolbar-btn" onClick={onReset}>
          Reset Preview
        </button>
      </div>

      <div class="dialog-preview__viewport">{children}</div>
    </main>
  );
}
