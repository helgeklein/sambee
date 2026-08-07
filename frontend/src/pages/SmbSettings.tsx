import { Alert, Box, Button, CircularProgress, MenuItem, TextField } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { loadSmbSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import api from "../services/api";
import type { SmbAuthenticationMode, SmbEncryptionMode, SmbPolicySettings, SmbSettings as SmbSettingsData } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";

interface SmbSettingsProps {
  dialogSafeHeader?: boolean;
}

interface SmbSettingsFormState {
  authenticationMode: SmbAuthenticationMode;
  encryptionMode: SmbEncryptionMode;
  connectionTimeoutSeconds: string;
  readChunkSizeBytes: string;
}

function createFormState(settings: SmbSettingsData): SmbSettingsFormState {
  return {
    authenticationMode: settings.policy.authentication_mode,
    encryptionMode: settings.policy.encryption_mode,
    connectionTimeoutSeconds: String(settings.policy.connection_timeout_seconds),
    readChunkSizeBytes: String(settings.read_chunk_size_bytes.value),
  };
}

function buildPolicy(formState: SmbSettingsFormState): SmbPolicySettings | null {
  const timeout = Number(formState.connectionTimeoutSeconds);

  if (!Number.isInteger(timeout)) {
    return null;
  }

  return {
    authentication_mode: formState.authenticationMode,
    encryption_mode: formState.encryptionMode,
    connection_timeout_seconds: timeout,
  };
}

export function SmbSettings({ dialogSafeHeader = false }: SmbSettingsProps) {
  const { t } = useTranslation();
  const [formState, setFormState] = useState<SmbSettingsFormState | null>(null);
  const [savedState, setSavedState] = useState<SmbSettingsFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const handleLoadError = useCallback(
    (loadError: unknown) => setError(getApiErrorMessage(loadError, t("settings.smbSettings.loadFailed"))),
    [t]
  );
  const {
    data: settings,
    loading,
    refresh,
    setData: setSettings,
  } = useCachedAsyncData<SmbSettingsData>({
    cacheKey: SETTINGS_DATA_CACHE_KEYS.adminSmb,
    load: loadSmbSettingsData,
    onError: handleLoadError,
  });

  useEffect(() => {
    if (!settings) {
      return;
    }
    const nextState = createFormState(settings);
    setFormState(nextState);
    setSavedState(nextState);
  }, [settings]);

  const policy = useMemo(() => (formState ? buildPolicy(formState) : null), [formState]);
  const readChunkSize = formState ? Number(formState.readChunkSizeBytes) : Number.NaN;
  const readChunkSizeSetting = settings?.read_chunk_size_bytes;
  const hasValidInput =
    Boolean(policy) &&
    Number.isInteger(readChunkSize) &&
    readChunkSizeSetting !== undefined &&
    readChunkSize >= readChunkSizeSetting.min_value &&
    readChunkSize <= readChunkSizeSetting.max_value;
  const hasUnsavedChanges = Boolean(formState && savedState && JSON.stringify(formState) !== JSON.stringify(savedState));

  const updateFormState = <Key extends keyof SmbSettingsFormState>(key: Key, value: SmbSettingsFormState[Key]) => {
    setFormState((current) => (current ? { ...current, [key]: value } : current));
  };

  const retryLoad = async () => {
    setError(null);
    await refresh(true);
  };

  const save = async () => {
    if (!formState || !policy || !hasValidInput) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const updated = await api.updateSmbSettings({ read_chunk_size_bytes: readChunkSize, policy });
      const nextState = createFormState(updated);
      setSettings(updated);
      setFormState(nextState);
      setSavedState(nextState);
      setNotice(t("settings.smbSettings.saveSuccess"));
    } catch (saveError: unknown) {
      setError(getApiErrorMessage(saveError, t("settings.smbSettings.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const reset = async (resetPolicy: boolean) => {
    try {
      setSaving(true);
      setError(null);
      const updated = await api.updateSmbSettings(resetPolicy ? { reset_policy: true } : { reset_read_chunk_size_bytes: true });
      const nextState = createFormState(updated);
      setSettings(updated);
      setFormState(nextState);
      setSavedState(nextState);
      setNotice(t("settings.smbSettings.saveSuccess"));
    } catch (resetError: unknown) {
      setError(getApiErrorMessage(resetError, t("settings.smbSettings.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage
      category="admin-smb"
      dialogSafeHeader={dialogSafeHeader}
      footerPrimaryActions={
        <Button variant="contained" onClick={() => void save()} disabled={!hasUnsavedChanges || !hasValidInput || saving}>
          {saving ? <CircularProgress size={18} color="inherit" /> : t("settings.smbSettings.saveChanges")}
        </Button>
      }
    >
      {loading && !settings ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 5 }}>
          <CircularProgress aria-label={t("settings.smbSettings.loadFailed")} />
        </Box>
      ) : null}
      {error && !settings ? (
        <Box sx={{ pt: 3 }}>
          <Alert
            severity="error"
            action={
              <Button onClick={() => void retryLoad()} disabled={loading}>
                {t("common.actions.retry")}
              </Button>
            }
          >
            {error}
          </Alert>
        </Box>
      ) : null}
      {formState && settings ? (
        <SettingsSectionList>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          <SettingsGroup title={t("settings.smbSettings.sections.protection")}>
            <TextField
              select
              fullWidth
              label={t("settings.smbSettings.fields.authenticationMode")}
              value={formState.authenticationMode}
              onChange={(event) => updateFormState("authenticationMode", event.target.value as SmbAuthenticationMode)}
              helperText={t("settings.smbSettings.helper.authenticationMode")}
            >
              <MenuItem value="negotiate">{t("settings.smbSettings.options.negotiate")}</MenuItem>
              <MenuItem value="kerberos_required">{t("settings.smbSettings.options.kerberosRequired")}</MenuItem>
            </TextField>
            <TextField
              select
              fullWidth
              label={t("settings.smbSettings.fields.encryptionMode")}
              value={formState.encryptionMode}
              onChange={(event) => updateFormState("encryptionMode", event.target.value as SmbEncryptionMode)}
              helperText={t("settings.smbSettings.helper.encryptionMode")}
            >
              <MenuItem value="signing_only">{t("settings.smbSettings.options.signingOnly")}</MenuItem>
              <MenuItem value="encryption_required">{t("settings.smbSettings.options.encryptionRequired")}</MenuItem>
            </TextField>
            {settings.policy_source === "database" ? (
              <Button variant="outlined" onClick={() => void reset(true)} disabled={saving}>
                {t("settings.smbSettings.resetOverride")}
              </Button>
            ) : null}
          </SettingsGroup>
          <SettingsGroup title={t("settings.smbSettings.sections.connectionBehavior")}>
            <TextField
              fullWidth
              type="number"
              label={t("settings.smbSettings.fields.connectionTimeout")}
              value={formState.connectionTimeoutSeconds}
              onChange={(event) => updateFormState("connectionTimeoutSeconds", event.target.value)}
              helperText={t("settings.smbSettings.helper.connectionTimeout")}
              slotProps={{ htmlInput: { min: 5, max: 120, step: 1 } }}
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.smbSettings.sections.fileStreaming")}>
            <TextField
              fullWidth
              type="number"
              label={t("settings.smbSettings.fields.readChunkSize")}
              value={formState.readChunkSizeBytes}
              onChange={(event) => updateFormState("readChunkSizeBytes", event.target.value)}
              helperText={t("settings.smbSettings.helper.readChunkSize")}
              slotProps={{
                htmlInput: {
                  min: settings.read_chunk_size_bytes.min_value,
                  max: settings.read_chunk_size_bytes.max_value,
                  step: settings.read_chunk_size_bytes.step,
                },
              }}
            />
            {settings.read_chunk_size_bytes.source === "database" ? (
              <Button variant="outlined" onClick={() => void reset(false)} disabled={saving}>
                {t("settings.smbSettings.resetOverride")}
              </Button>
            ) : null}
          </SettingsGroup>
        </SettingsSectionList>
      ) : null}
    </SettingsPage>
  );
}
