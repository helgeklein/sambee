/**
 * Preferences panel for the Sambee Companion app.
 *
 * Displays user-configurable settings such as trusted servers, notification
 * preferences, upload conflict resolution, and temp file retention. Settings
 * are auto-saved when changed.
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { log } from "../lib/logger";
import type { UploadConflictAction, UserPreferences } from "../stores/userPreferences";
import { getUserPreferences, saveUserPreferences } from "../stores/userPreferences";
import "../styles/preferences.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum allowed temp file retention (days). */
const MIN_RETENTION_DAYS = 1;

/** Maximum allowed temp file retention (days). */
const MAX_RETENTION_DAYS = 90;

/** Duration (ms) to show the "Saved" indicator after a change. */
const SAVED_INDICATOR_MS = 1500;

/** Human-readable labels for upload conflict actions. */
const CONFLICT_ACTION_LABELS: Record<UploadConflictAction, string> = {
  ask: "Ask me every time",
  overwrite: "Always overwrite server copy",
  "save-copy": "Always save as new copy",
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PreferencesProps {
  /** Called when the user closes the preferences panel. */
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

//
// Preferences
//
/**
 * Full-panel preferences editor.
 *
 * Settings are loaded once on mount and auto-saved on every change.
 * A brief "Saved" indicator flashes after each successful save.
 */
export function Preferences({ onClose }: PreferencesProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSaved, setShowSaved] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState("");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load preferences on mount ───────────────────────────────────────

  useEffect(() => {
    getUserPreferences()
      .then((p) => {
        setPrefs(p);
        setLoading(false);
      })
      .catch((err) => {
        log.error("Failed to load preferences:", err);
        setLoading(false);
      });

    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Auto-save helper ────────────────────────────────────────────────

  //
  // persistPrefs
  //
  /**
   * Save the given preferences and flash the "Saved" indicator.
   */
  const persistPrefs = useCallback(async (updated: UserPreferences) => {
    setPrefs(updated);
    try {
      await saveUserPreferences(updated);
      setShowSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_MS);
    } catch (err) {
      log.error("Failed to save preferences:", err);
    }
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────

  //
  // handleNotificationsChange
  //
  const handleNotificationsChange = useCallback(() => {
    if (!prefs) return;
    persistPrefs({ ...prefs, showNotifications: !prefs.showNotifications });
  }, [prefs, persistPrefs]);

  //
  // handleConflictActionChange
  //
  const handleConflictActionChange = useCallback(
    (e: Event) => {
      if (!prefs) return;
      const value = (e.target as HTMLSelectElement).value as UploadConflictAction;
      persistPrefs({ ...prefs, uploadConflictAction: value });
    },
    [prefs, persistPrefs]
  );

  //
  // handleRetentionChange
  //
  const handleRetentionChange = useCallback(
    (e: Event) => {
      if (!prefs) return;
      const raw = Number.parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isNaN(raw)) return;
      const clamped = Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, raw));
      persistPrefs({ ...prefs, tempFileRetentionDays: clamped });
    },
    [prefs, persistPrefs]
  );

  //
  // handleAddServer
  //
  const handleAddServer = useCallback(() => {
    if (!prefs) return;
    const url = newServerUrl.trim().replace(/\/+$/, "");
    if (!url) return;

    // Prevent duplicate entries
    if (prefs.allowedServers.includes(url)) {
      setNewServerUrl("");
      return;
    }

    persistPrefs({
      ...prefs,
      allowedServers: [...prefs.allowedServers, url],
    });
    setNewServerUrl("");
  }, [prefs, newServerUrl, persistPrefs]);

  //
  // handleRemoveServer
  //
  const handleRemoveServer = useCallback(
    (url: string) => {
      if (!prefs) return;
      persistPrefs({
        ...prefs,
        allowedServers: prefs.allowedServers.filter((s) => s !== url),
      });
    },
    [prefs, persistPrefs]
  );

  //
  // handleServerInputKeyDown
  //
  /** Allow pressing Enter to add a server. */
  const handleServerInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddServer();
      }
    },
    [handleAddServer]
  );

  // ── Render ──────────────────────────────────────────────────────────

  if (loading || !prefs) {
    return (
      <div class="preferences">
        <p>Loading preferences…</p>
      </div>
    );
  }

  return (
    <div class="preferences">
      {/* ── Header ── */}
      <div class="preferences__header">
        <h2 class="preferences__title">Preferences</h2>
        <button type="button" class="preferences__close-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {/* ── Trusted Servers ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">Trusted Servers</span>
        <div class="preferences__field">
          <span class="preferences__hint">Only servers in this list will be allowed to initiate edit sessions.</span>
          {prefs.allowedServers.length > 0 ? (
            <div class="preferences__server-list">
              {prefs.allowedServers.map((url) => (
                <div key={url} class="preferences__server-item">
                  <span class="preferences__server-url">{url}</span>
                  <button
                    type="button"
                    class="preferences__server-remove-btn"
                    onClick={() => handleRemoveServer(url)}
                    title="Remove server"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span class="preferences__server-empty">
              No trusted servers yet. Servers are added automatically on first use, or add one manually below.
            </span>
          )}
          <div class="preferences__server-add">
            <input
              type="url"
              class="preferences__server-input"
              placeholder="https://sambee.example.com"
              value={newServerUrl}
              onInput={(e) => setNewServerUrl((e.target as HTMLInputElement).value)}
              onKeyDown={handleServerInputKeyDown}
            />
            <button type="button" class="preferences__server-add-btn" onClick={handleAddServer} disabled={!newServerUrl.trim()}>
              Add
            </button>
          </div>
        </div>
      </div>

      <hr class="preferences__divider" />

      {/* ── Editing Behavior ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">Editing Behavior</span>

        {/* Upload conflict action */}
        <div class="preferences__field">
          <label class="preferences__label" htmlFor="conflict-action">
            Upload conflict resolution
          </label>
          <select id="conflict-action" class="preferences__select" value={prefs.uploadConflictAction} onChange={handleConflictActionChange}>
            {(Object.entries(CONFLICT_ACTION_LABELS) as [UploadConflictAction, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span class="preferences__hint">What to do when the file on the server changed while you were editing.</span>
        </div>
      </div>

      <hr class="preferences__divider" />

      {/* ── Notifications ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">Notifications</span>
        <label class="preferences__checkbox-row">
          <input type="checkbox" checked={prefs.showNotifications} onChange={handleNotificationsChange} />
          <span class="preferences__label">Show desktop notifications</span>
        </label>
        <span class="preferences__hint">Display system notifications for edit events such as upload success or failure.</span>
      </div>

      <hr class="preferences__divider" />

      {/* ── Cleanup ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">Temp File Cleanup</span>
        <div class="preferences__field">
          <label class="preferences__label" htmlFor="retention-days">
            Keep temp files for (days)
          </label>
          <input
            id="retention-days"
            type="number"
            class="preferences__number-input"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            value={prefs.tempFileRetentionDays}
            onChange={handleRetentionChange}
          />
          <span class="preferences__hint">Recycled temp files older than this are automatically deleted on startup (1–90).</span>
        </div>
      </div>

      {/* ── Save indicator ── */}
      <div class="preferences__footer">{showSaved && <span class="preferences__saved-indicator">Saved ✓</span>}</div>
    </div>
  );
}
