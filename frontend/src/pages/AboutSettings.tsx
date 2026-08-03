import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Alert, IconButton, Menu, MenuItem, Table, TableBody, TableCell, TableRow, Tooltip } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsNotificationSnackbar, type SettingsNotificationState } from "../components/Settings/SettingsFeedback";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { SettingsSectionList } from "../components/Settings/SettingsSectionList";
import { SettingsLoadingState } from "../components/Settings/SettingsState";
import { loadAboutSettingsData, SETTINGS_DATA_CACHE_KEYS } from "../components/Settings/settingsDataSources";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import api from "../services/api";
import type { AboutSettings as AboutSettingsData } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";
import { formatLocalizedNumber } from "../utils/localeFormatting";
import { formatBuildTime } from "../utils/version";

interface AboutSettingsProps {
  dialogSafeHeader?: boolean;
}

interface AboutValueRowProps {
  label: string;
  value: string;
  isLast?: boolean;
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

function formatMemorySize(bytes: number): string {
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const unit = BYTE_UNITS[unitIndex] ?? BYTE_UNITS[0];
  const value = bytes / 1024 ** unitIndex;
  return `${formatLocalizedNumber(value, { maximumFractionDigits: value >= 10 ? 0 : 1 })} ${unit}`;
}

function AboutValueRow({ label, value, isLast = false }: AboutValueRowProps) {
  return (
    <TableRow sx={isLast ? { "& th, & td": { borderBottom: 0 } } : undefined}>
      <TableCell
        component="th"
        scope="row"
        sx={{
          width: { xs: "42%", sm: "32%" },
          px: 0,
          py: 1,
          pr: 2,
          verticalAlign: "top",
          color: "text.secondary",
          fontWeight: 500,
        }}
      >
        {label}
      </TableCell>
      <TableCell align="right" sx={{ px: 0, py: 1, verticalAlign: "top", overflowWrap: "anywhere" }}>
        {value}
      </TableCell>
    </TableRow>
  );
}

export function AboutSettings({ dialogSafeHeader = false }: AboutSettingsProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<SettingsNotificationState>({ open: false, message: "", severity: "success" });
  const [copyMenuAnchor, setCopyMenuAnchor] = useState<HTMLElement | null>(null);
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
  const formatOptionalMemory =
    data?.memory_bytes === null || data?.memory_bytes === undefined ? unavailable : formatMemorySize(data.memory_bytes);
  const copyAboutInformation = useCallback(() => {
    if (!data) {
      return;
    }

    const content = [
      t("settings.aboutPage.applicationTitle"),
      `${t("settings.aboutPage.versionLabel")}: ${data.version}`,
      `${t("settings.aboutPage.buildLabel")}: ${formatBuildTime(data.build_time)}`,
      `${t("settings.aboutPage.commitLabel")}: ${data.git_commit}`,
      "",
      t("settings.aboutPage.runtimeTitle"),
      `${t("settings.aboutPage.startedLabel")}: ${formatBuildTime(data.started_at)}`,
      `${t("settings.aboutPage.pythonLabel")}: ${data.python_runtime}`,
      "",
      t("settings.aboutPage.platformTitle"),
      `${t("settings.aboutPage.architectureLabel")}: ${data.architecture}`,
      `${t("settings.aboutPage.cpuCountLabel")}: ${data.logical_cpu_count === null ? unavailable : data.logical_cpu_count}`,
      `${t("settings.aboutPage.memoryLabel")}: ${formatOptionalMemory}`,
    ].join("\n");

    void navigator.clipboard.writeText(content).then(
      () => setNotification({ open: true, message: t("settings.aboutPage.copySuccess"), severity: "success" }),
      () => setNotification({ open: true, message: t("settings.aboutPage.copyError"), severity: "error" })
    );
  }, [data, formatOptionalMemory, t, unavailable]);
  const copyPublicSupportReport = useCallback(() => {
    setCopyMenuAnchor(null);
    void api.getPublicSupportReport().then(
      (report) =>
        navigator.clipboard.writeText(report.content).then(
          () => setNotification({ open: true, message: t("settings.aboutPage.copyPublicSupportReportSuccess"), severity: "success" }),
          () => setNotification({ open: true, message: t("settings.aboutPage.copyPublicSupportReportError"), severity: "error" })
        ),
      () => setNotification({ open: true, message: t("settings.aboutPage.copyPublicSupportReportError"), severity: "error" })
    );
  }, [t]);

  const handleCopyAboutInformation = useCallback(() => {
    setCopyMenuAnchor(null);
    copyAboutInformation();
  }, [copyAboutInformation]);

  return (
    <SettingsPage category="admin-about" dialogSafeHeader={dialogSafeHeader}>
      {loading && !data ? <SettingsLoadingState /> : null}
      {!loading && !data && error ? <Alert severity="error">{error}</Alert> : null}
      {data ? (
        <SettingsSectionList>
          <SettingsGroup
            title={t("settings.aboutPage.applicationTitle")}
            contentSpacing="compact"
            actionsLayout="inline"
            actions={
              <>
                <Tooltip title={t("settings.aboutPage.copyTooltip")}>
                  <IconButton
                    aria-label={t("settings.aboutPage.copyAriaLabel")}
                    onClick={(event) => setCopyMenuAnchor(event.currentTarget)}
                  >
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
                <Menu anchorEl={copyMenuAnchor} open={Boolean(copyMenuAnchor)} onClose={() => setCopyMenuAnchor(null)}>
                  <MenuItem onClick={handleCopyAboutInformation}>{t("settings.aboutPage.copyAboutMenuItem")}</MenuItem>
                  <MenuItem onClick={copyPublicSupportReport}>{t("settings.aboutPage.copyPublicSupportReportMenuItem")}</MenuItem>
                </Menu>
              </>
            }
          >
            <Table aria-label={t("settings.aboutPage.applicationTitle")} size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
              <TableBody>
                <AboutValueRow label={t("settings.aboutPage.versionLabel")} value={data.version} />
                <AboutValueRow label={t("settings.aboutPage.buildLabel")} value={formatBuildTime(data.build_time)} />
                <AboutValueRow label={t("settings.aboutPage.commitLabel")} value={data.git_commit} isLast />
              </TableBody>
            </Table>
          </SettingsGroup>
          <SettingsGroup title={t("settings.aboutPage.runtimeTitle")} contentSpacing="compact">
            <Table aria-label={t("settings.aboutPage.runtimeTitle")} size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
              <TableBody>
                <AboutValueRow label={t("settings.aboutPage.startedLabel")} value={formatBuildTime(data.started_at)} />
                <AboutValueRow label={t("settings.aboutPage.pythonLabel")} value={data.python_runtime} isLast />
              </TableBody>
            </Table>
          </SettingsGroup>
          <SettingsGroup title={t("settings.aboutPage.platformTitle")} contentSpacing="compact">
            <Table aria-label={t("settings.aboutPage.platformTitle")} size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
              <TableBody>
                <AboutValueRow label={t("settings.aboutPage.architectureLabel")} value={data.architecture} />
                <AboutValueRow
                  label={t("settings.aboutPage.cpuCountLabel")}
                  value={data.logical_cpu_count === null ? unavailable : String(data.logical_cpu_count)}
                />
                <AboutValueRow label={t("settings.aboutPage.memoryLabel")} value={formatOptionalMemory} isLast />
              </TableBody>
            </Table>
          </SettingsGroup>
        </SettingsSectionList>
      ) : null}
      <SettingsNotificationSnackbar
        notification={notification}
        onClose={() => setNotification((current) => ({ ...current, open: false }))}
      />
    </SettingsPage>
  );
}
