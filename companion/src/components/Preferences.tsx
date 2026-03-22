/**
 * Preferences panel for the Sambee Companion app.
 *
 * Displays user-configurable settings such as paired browser management,
 * notification preferences, upload conflict resolution, and temp file
 * retention. Settings are auto-saved when changed.
 */

import { invoke } from "@tauri-apps/api/core";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { translate } from "../i18n";
import { log } from "../lib/logger";
import type { UploadConflictAction, UserPreferences } from "../stores/userPreferences";
import { getUserPreferences, saveUserPreferences } from "../stores/userPreferences";
import { ModalDialog } from "./ModalDialog";
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
  const conflictActionLabels: Record<UploadConflictAction, string> = {
    ask: translate("preferences.conflictActions.ask"),
    overwrite: translate("preferences.conflictActions.overwrite"),
    "save-copy": translate("preferences.conflictActions.saveCopy"),
  };
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [pairedOrigins, setPairedOrigins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaved, setShowSaved] = useState(false);
  const [changingAutostart, setChangingAutostart] = useState(false);
  const [pendingUnpairOrigin, setPendingUnpairOrigin] = useState<string | null>(null);
  const [unpairingOrigin, setUnpairingOrigin] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelUnpairButtonRef = useRef<HTMLButtonElement | null>(null);

  // ── Load preferences on mount ───────────────────────────────────────

  useEffect(() => {
    Promise.all([getUserPreferences(), invoke<string[]>("get_paired_origins")])
      .then(async ([storedPrefs, origins]) => {
        let autoStartOnLogin = storedPrefs.autoStartOnLogin;

        try {
          autoStartOnLogin = await isAutostartEnabled();
        } catch (err) {
          log.error("Failed to read autostart state:", err);
        }

        const resolvedPrefs = storedPrefs.autoStartOnLogin === autoStartOnLogin ? storedPrefs : { ...storedPrefs, autoStartOnLogin };

        setPrefs(resolvedPrefs);
        setPairedOrigins(origins);
        setLoading(false);

        if (resolvedPrefs !== storedPrefs) {
          try {
            await saveUserPreferences(resolvedPrefs);
          } catch (err) {
            log.error("Failed to reconcile autostart preference:", err);
          }
        }
      })
      .catch((err) => {
        log.error("Failed to load preferences:", err);
        setLoading(false);
      });

    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pendingUnpairOrigin) {
      return;
    }

    cancelUnpairButtonRef.current?.focus();
  }, [pendingUnpairOrigin]);

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

  const handleAutostartChange = useCallback(async () => {
    if (!prefs || changingAutostart) {
      return;
    }

    const previousPrefs = prefs;
    const updatedPrefs = {
      ...prefs,
      autoStartOnLogin: !prefs.autoStartOnLogin,
    };

    setChangingAutostart(true);
    setPrefs(updatedPrefs);

    try {
      if (updatedPrefs.autoStartOnLogin) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }

      await persistPrefs(updatedPrefs);
    } catch (err) {
      setPrefs(previousPrefs);
      log.error("Failed to update autostart preference:", err);
    } finally {
      setChangingAutostart(false);
    }
  }, [changingAutostart, persistPrefs, prefs]);

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
  const handleConfirmUnpair = useCallback(async () => {
    if (!pendingUnpairOrigin) {
      return;
    }

    const origin = pendingUnpairOrigin;
    setUnpairingOrigin(origin);
    try {
      await invoke("unpair_origin", { origin });
      setPairedOrigins((current) => current.filter((entry) => entry !== origin));
    } catch (err) {
      log.error("Failed to unpair origin:", err);
    } finally {
      setPendingUnpairOrigin(null);
      setUnpairingOrigin(null);
    }
  }, [pendingUnpairOrigin]);

  const handleCancelUnpair = useCallback(() => {
    if (unpairingOrigin) {
      return;
    }

    setPendingUnpairOrigin(null);
  }, [unpairingOrigin]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading || !prefs) {
    return (
      <div class="preferences">
        <p>{translate("preferences.loading")}</p>
      </div>
    );
  }

  return (
    <div class="preferences">
      {/* ── Header ── */}
      <div class="preferences__header">
        <h2 class="preferences__title">{translate("preferences.title")}</h2>
        <button type="button" class="preferences__close-btn" onClick={onClose} title={translate("preferences.closeTitle")}>
          ✕
        </button>
      </div>

      {/* ── Paired Browsers ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">{translate("preferences.sections.pairedBrowsers")}</span>
        <div class="preferences__field">
          <span class="preferences__hint">{translate("preferences.pairedBrowsersHint")}</span>
          {pairedOrigins.length > 0 ? (
            <div class="preferences__server-list">
              {pairedOrigins.map((origin) => (
                <div key={origin} class="preferences__server-item">
                  <span class="preferences__server-url">{origin}</span>
                  <button
                    type="button"
                    class="preferences__server-remove-btn"
                    onClick={() => setPendingUnpairOrigin(origin)}
                    title={translate("preferences.unpairTitle")}
                    disabled={unpairingOrigin === origin}
                  >
                    {unpairingOrigin === origin ? translate("preferences.confirmUnpair.unpairing") : translate("preferences.unpairButton")}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span class="preferences__server-empty">{translate("preferences.pairedBrowsersEmpty")}</span>
          )}
        </div>
      </div>

      <hr class="preferences__divider" />

      {/* ── Editing Behavior ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">{translate("preferences.sections.editingBehavior")}</span>

        {/* Upload conflict action */}
        <div class="preferences__field">
          <label class="preferences__label" htmlFor="conflict-action">
            {translate("preferences.conflictResolutionLabel")}
          </label>
          <select id="conflict-action" class="preferences__select" value={prefs.uploadConflictAction} onChange={handleConflictActionChange}>
            {(Object.entries(conflictActionLabels) as [UploadConflictAction, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span class="preferences__hint">{translate("preferences.conflictResolutionHint")}</span>
        </div>
      </div>

      <hr class="preferences__divider" />

      {/* ── Startup ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">{translate("preferences.sections.startup")}</span>
        <label class="preferences__checkbox-row">
          <input type="checkbox" checked={prefs.autoStartOnLogin} onChange={handleAutostartChange} disabled={changingAutostart} />
          <span class="preferences__label">{translate("preferences.startupLabel")}</span>
        </label>
        <span class="preferences__hint">{translate("preferences.startupHint")}</span>
      </div>

      <hr class="preferences__divider" />

      {/* ── Notifications ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">{translate("preferences.sections.notifications")}</span>
        <label class="preferences__checkbox-row">
          <input type="checkbox" checked={prefs.showNotifications} onChange={handleNotificationsChange} />
          <span class="preferences__label">{translate("preferences.notificationsLabel")}</span>
        </label>
        <span class="preferences__hint">{translate("preferences.notificationsHint")}</span>
      </div>

      <hr class="preferences__divider" />

      {/* ── Cleanup ── */}
      <div class="preferences__section">
        <span class="preferences__section-title">{translate("preferences.sections.tempFileCleanup")}</span>
        <div class="preferences__field">
          <label class="preferences__label" htmlFor="retention-days">
            {translate("preferences.retentionLabel")}
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
          <span class="preferences__hint">{translate("preferences.retentionHint")}</span>
        </div>
      </div>

      {/* ── Save indicator ── */}
      <div class="preferences__footer">
        {showSaved && <span class="preferences__saved-indicator">{translate("preferences.savedIndicator")}</span>}
      </div>

      {pendingUnpairOrigin && (
        <ModalDialog
          role="alertdialog"
          titleId="unpair-dialog-title"
          onRequestClose={handleCancelUnpair}
          initialFocusRef={cancelUnpairButtonRef}
          panelClassName="preferences__confirm-panel"
        >
          <h3 id="unpair-dialog-title" class="preferences__confirm-title">
            {translate("preferences.confirmUnpair.title")}
          </h3>
          <p class="preferences__confirm-body">
            <strong>{translate("preferences.confirmUnpair.body", { origin: pendingUnpairOrigin })}</strong>
          </p>
          <div class="preferences__confirm-actions">
            <button
              type="button"
              class="preferences__confirm-btn preferences__confirm-btn--ghost"
              ref={cancelUnpairButtonRef}
              onClick={handleCancelUnpair}
              disabled={Boolean(unpairingOrigin)}
            >
              {translate("common.actions.cancel")}
            </button>
            <button
              type="button"
              class="preferences__confirm-btn preferences__confirm-btn--danger"
              onClick={handleConfirmUnpair}
              disabled={Boolean(unpairingOrigin)}
            >
              {unpairingOrigin ? translate("preferences.confirmUnpair.unpairing") : translate("preferences.unpairButton")}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
