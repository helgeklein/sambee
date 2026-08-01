import { Alert, Box, Button, CircularProgress, Stack, TextField } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { loadNetworkSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { clearCachedAsyncData, useCachedAsyncData } from "../hooks/useCachedAsyncData";
import api from "../services/api";
import type { NetworkSettings as NetworkSettingsData } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";

const TRUSTED_PROXY_CIDRS_LABEL = "Trusted proxy CIDRs";

export function NetworkSettings() {
  const [publicUrl, setPublicUrl] = useState("");
  const [trustedProxyCidrs, setTrustedProxyCidrs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const handleLoadError = useCallback(
    (loadError: unknown) => setError(getApiErrorMessage(loadError, "Network settings could not be loaded.")),
    []
  );
  const {
    data: settings,
    loading,
    setData: setSettings,
  } = useCachedAsyncData<NetworkSettingsData>({
    cacheKey: SETTINGS_DATA_CACHE_KEYS.adminNetwork,
    load: loadNetworkSettingsData,
    refreshCachedDataOnMount: false,
    onError: handleLoadError,
  });

  useEffect(() => {
    if (!settings) return;
    setPublicUrl(settings.public_url);
    setTrustedProxyCidrs(settings.trusted_proxy_cidrs.join("\n"));
  }, [settings]);

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const updated = await api.updateNetworkSettings({
        public_url: publicUrl,
        trusted_proxy_cidrs: trustedProxyCidrs
          .split(/[,\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      clearCachedAsyncData(SETTINGS_DATA_CACHE_KEYS.adminAuthentication);
      setSettings(updated);
      setPublicUrl(updated.public_url);
      setTrustedProxyCidrs(updated.trusted_proxy_cidrs.join("\n"));
      setNotice("Network settings saved.");
    } catch (saveError: unknown) {
      setError(getApiErrorMessage(saveError, "Network settings could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage category="admin-network">
      {loading && !settings ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 5 }}>
          <CircularProgress aria-label="Loading network settings" />
        </Box>
      ) : null}
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <TextField
          required
          fullWidth
          label="Public URL"
          value={publicUrl}
          onChange={(event) => setPublicUrl(event.target.value)}
          helperText="The externally reachable HTTPS origin, without a path. Changing it cancels incomplete OIDC sign-ins."
        />
        <TextField
          fullWidth
          multiline
          minRows={3}
          label={TRUSTED_PROXY_CIDRS_LABEL}
          value={trustedProxyCidrs}
          onChange={(event) => setTrustedProxyCidrs(event.target.value)}
          helperText="One CIDR per line. Leave empty unless a reverse proxy you operate forwards client IP addresses."
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Button variant="contained" sx={{ alignSelf: "flex-start" }} onClick={() => void save()} disabled={saving || !publicUrl.trim()}>
          {saving ? "Saving..." : "Save network settings"}
        </Button>
      </Stack>
    </SettingsPage>
  );
}
