import { Alert, Stack, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { SettingsLoadingState } from "../components/Settings/SettingsState";
import { loadAboutSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import type { AboutSettings as AboutSettingsData } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";
import { formatBuildTime } from "../utils/version";

interface AboutSettingsProps {
  dialogSafeHeader?: boolean;
}

interface AboutValueRowProps {
  label: string;
  value: string;
}

function AboutValueRow({ label, value }: AboutValueRowProps) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.25, sm: 2 }} sx={{ py: 0.75 }}>
      <Typography color="text.secondary" sx={{ width: { sm: 180 }, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography sx={{ overflowWrap: "anywhere" }}>{value}</Typography>
    </Stack>
  );
}

export function AboutSettings({ dialogSafeHeader = false }: AboutSettingsProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const handleLoadError = useCallback(
    (loadError: unknown) => setError(getApiErrorMessage(loadError, t("settings.aboutPage.loadError"))),
    [t]
  );
  const { data, loading } = useCachedAsyncData<AboutSettingsData>({
    cacheKey: SETTINGS_DATA_CACHE_KEYS.adminAbout,
    load: loadAboutSettingsData,
    refreshCachedDataOnMount: false,
    onError: handleLoadError,
  });
  const unavailable = t("settings.aboutPage.unavailableValue");

  return (
    <SettingsPage category="admin-about" dialogSafeHeader={dialogSafeHeader}>
      {loading && !data ? <SettingsLoadingState /> : null}
      {!loading && !data && error ? <Alert severity="error">{error}</Alert> : null}
      {data ? (
        <SettingsSectionList>
          <SettingsGroup title={t("settings.aboutPage.applicationTitle")} contentSpacing="compact">
            <AboutValueRow label={t("settings.aboutPage.versionLabel")} value={data.version} />
            <AboutValueRow label={t("settings.aboutPage.buildLabel")} value={formatBuildTime(data.build_time)} />
            <AboutValueRow label={t("settings.aboutPage.commitLabel")} value={data.git_commit} />
          </SettingsGroup>
          <SettingsGroup title={t("settings.aboutPage.runtimeTitle")} contentSpacing="compact">
            <AboutValueRow label={t("settings.aboutPage.startedLabel")} value={formatBuildTime(data.started_at)} />
            <AboutValueRow label={t("settings.aboutPage.pythonLabel")} value={data.python_version} />
            <AboutValueRow
              label={t("settings.aboutPage.containerLabel")}
              value={data.containerized ? t("settings.aboutPage.containerizedValue") : t("settings.aboutPage.notContainerizedValue")}
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.aboutPage.platformTitle")} contentSpacing="compact">
            <AboutValueRow label={t("settings.aboutPage.operatingSystemLabel")} value={data.operating_system} />
            <AboutValueRow label={t("settings.aboutPage.architectureLabel")} value={data.architecture} />
            <AboutValueRow
              label={t("settings.aboutPage.cpuCountLabel")}
              value={data.logical_cpu_count === null ? unavailable : String(data.logical_cpu_count)}
            />
          </SettingsGroup>
        </SettingsSectionList>
      ) : null}
    </SettingsPage>
  );
}
