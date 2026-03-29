import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ComputerIcon from "@mui/icons-material/Computer";
import DownloadIcon from "@mui/icons-material/Download";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import UsbIcon from "@mui/icons-material/Usb";
import { Box, Button, Chip, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import CompanionPairingDialog from "../components/FileBrowser/CompanionPairingDialog";
import { LOCAL_DRIVES_PAGE_COPY } from "../components/Settings/localDrivesCopy";
import { SettingsInlineAlert, SettingsNotificationSnackbar, type SettingsNotificationState } from "../components/Settings/SettingsFeedback";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { SettingsLoadingState } from "../components/Settings/SettingsState";
import {
  settingsDestructiveButtonSx,
  settingsMetadataChipSx,
  settingsPrimaryButtonSx,
  settingsUtilityButtonSx,
} from "../components/Settings/settingsButtonStyles";
import {
  type LocalDrivesSettingsData,
  loadLocalDrivesSettingsData,
  SETTINGS_DATA_CACHE_KEYS,
} from "../components/Settings/settingsDataSources";
import { useCachedAsyncData } from "../hooks/useCachedAsyncData";
import companionService, { clearStoredSecret, hasStoredSecret, type PairTestResponse } from "../services/companion";
import { logger } from "../services/logger";
import type { CompanionDownloadPlatform } from "../types";

const COMPANION_PLATFORM_LABELS: Record<CompanionDownloadPlatform, string> = {
  "windows-x64": "Windows (x64)",
  "windows-arm64": "Windows (ARM64)",
  "macos-arm64": "macOS (Apple Silicon)",
  "linux-x64": "Linux (x64)",
};

const COMPANION_PLATFORM_ORDER: CompanionDownloadPlatform[] = ["windows-x64", "windows-arm64", "macos-arm64", "linux-x64"];
const LOCAL_DRIVES_STATUS_POLL_INTERVAL_MS = 1_000;
const IOS_USER_AGENT_TOKENS = ["iphone", "ipad", "ipod"] as const;
const MAC_PLATFORM_TOKEN = "macintel";
const ANDROID_USER_AGENT_TOKEN = "android";

function detectCurrentPlatform(): CompanionDownloadPlatform | null {
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) {
    return userAgent.includes("arm") ? "windows-arm64" : "windows-x64";
  }
  if (userAgent.includes("mac os x") || userAgent.includes("macintosh")) {
    return "macos-arm64";
  }
  if (userAgent.includes("linux") && !userAgent.includes("android")) {
    return "linux-x64";
  }
  return null;
}

function isUnsupportedMobileCompanionPlatform(): boolean {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  const maxTouchPoints = window.navigator.maxTouchPoints;

  const isAndroid = userAgent.includes(ANDROID_USER_AGENT_TOKEN);
  const isIos = IOS_USER_AGENT_TOKENS.some((token) => userAgent.includes(token));
  const isIpadOs = platform === MAC_PLATFORM_TOKEN && maxTouchPoints > 1;

  return isAndroid || isIos || isIpadOs;
}

interface LocalDrivesSettingsProps {
  onConnectionsChanged?: () => void;
  sectionTitle?: string;
  sectionDescription?: string;
}

const EMPTY_LOCAL_DRIVES_STATE: LocalDrivesSettingsData = {
  companionAvailable: false,
  currentPairStatus: null,
  downloadMetadata: null,
  downloadError: null,
};

/**
 * LocalDrivesSettings
 *
 * Browser-side management UI for the Sambee Companion pairing that exposes
 * local drives inside the file browser.
 */
export function LocalDrivesSettings({ onConnectionsChanged, sectionTitle, sectionDescription }: LocalDrivesSettingsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const companionUnsupportedOnCurrentDevice = useMemo(() => isUnsupportedMobileCompanionPlatform(), []);
  const [testing, setTesting] = useState(false);
  const [pairingDialogOpen, setPairingDialogOpen] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [notification, setNotification] = useState<SettingsNotificationState>({
    open: false,
    message: "",
    severity: "info",
  });

  const currentOrigin = window.location.origin;
  const browserHasStoredSecret = hasStoredSecret();
  const currentPlatform = useMemo(() => detectCurrentPlatform(), []);
  const {
    data: cachedState,
    loading,
    hasResolved,
    refresh,
  } = useCachedAsyncData<LocalDrivesSettingsData>({
    cacheKey: SETTINGS_DATA_CACHE_KEYS.localDrives,
    load: loadLocalDrivesSettingsData,
    enabled: !companionUnsupportedOnCurrentDevice,
  });
  const state = cachedState ?? EMPTY_LOCAL_DRIVES_STATE;

  const showNotification = useCallback((message: string, severity: "success" | "error" | "info") => {
    setNotification({ open: true, message, severity });
  }, []);

  useEffect(() => {
    if (companionUnsupportedOnCurrentDevice) {
      return;
    }

    let intervalId: number | null = null;

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPolling = () => {
      if (document.visibilityState !== "visible" || intervalId !== null) {
        return;
      }

      intervalId = window.setInterval(() => {
        void refresh();
      }, LOCAL_DRIVES_STATUS_POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        startPolling();
        return;
      }

      stopPolling();
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
    };
  }, [companionUnsupportedOnCurrentDevice, refresh]);

  const handleConfirmPairing = useCallback(
    async (pairingId: string) => {
      await companionService.confirmPairing(pairingId);
      await refresh();
      onConnectionsChanged?.();
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingCreated, "success");
    },
    [onConnectionsChanged, refresh, showNotification]
  );

  const handleTestPairing = useCallback(async () => {
    setTesting(true);
    try {
      const result: PairTestResponse = await companionService.testPairing();
      await refresh();
      showNotification(result.message, "success");
    } catch (error) {
      logger.error("Companion pairing test failed", { error }, "companion");
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingTestFailed, "error");
    } finally {
      setTesting(false);
    }
  }, [refresh, showNotification]);

  const handleUnpairCurrentBrowser = useCallback(async () => {
    setUnpairing(true);

    try {
      await companionService.unpairOrigin(currentOrigin);
      clearStoredSecret();
      await refresh();
      onConnectionsChanged?.();
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingRemoved, "success");
    } catch (error) {
      logger.error("Failed to remove current browser companion pairing", { error, origin: currentOrigin }, "companion");
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingRemoveFailed, "error");
    } finally {
      setUnpairing(false);
    }
  }, [currentOrigin, onConnectionsChanged, refresh, showNotification]);

  const currentOriginPaired = state.currentPairStatus?.current_origin_paired ?? false;
  const currentOriginRecoverable = currentOriginPaired && !browserHasStoredSecret;
  const browserFullyPaired = currentOriginPaired && browserHasStoredSecret;
  const downloadEntries = useMemo(
    () =>
      COMPANION_PLATFORM_ORDER.flatMap((platformKey) => {
        const assetUrl = state.downloadMetadata?.assets[platformKey];
        return assetUrl ? [[platformKey, assetUrl] as const] : [];
      }),
    [state.downloadMetadata]
  );
  const primaryDownload = useMemo(() => {
    if (downloadEntries.length === 0) {
      return null;
    }
    if (!currentPlatform) {
      return downloadEntries[0] ?? null;
    }
    return downloadEntries.find(([platformKey]) => platformKey === currentPlatform) ?? downloadEntries[0] ?? null;
  }, [currentPlatform, downloadEntries]);
  const alternateDownloads = useMemo(
    () => downloadEntries.filter(([platformKey]) => platformKey !== primaryDownload?.[0]),
    [downloadEntries, primaryDownload]
  );
  const showUnpairAction = browserFullyPaired;
  const showStatusContent = hasResolved || cachedState !== null;
  const cardActionRowSx = {
    display: "flex",
    flexWrap: "wrap",
    gap: 1,
    alignItems: "center",
    alignSelf: "flex-start",
  };

  const downloadSourceLabel =
    state.downloadMetadata?.source === "pin"
      ? LOCAL_DRIVES_PAGE_COPY.downloadPinSourceLabel
      : LOCAL_DRIVES_PAGE_COPY.downloadFeedSourceLabel;
  const statusChecklist = useMemo(
    () => [
      {
        label: LOCAL_DRIVES_PAGE_COPY.companionRunningChecklistLabel,
        complete: state.companionAvailable,
      },
      {
        label: LOCAL_DRIVES_PAGE_COPY.browserFullyPairedChecklistLabel,
        complete: browserFullyPaired,
      },
    ],
    [browserFullyPaired, state.companionAvailable]
  );
  const summaryState = useMemo(() => {
    if (!state.companionAvailable) {
      return {
        badgeLabel: LOCAL_DRIVES_PAGE_COPY.statusLabelUnavailable,
        badgeVariant: "warning" as const,
        title: LOCAL_DRIVES_PAGE_COPY.summaryUnavailableTitle,
        message: LOCAL_DRIVES_PAGE_COPY.statusUnavailable,
      };
    }

    if (browserFullyPaired) {
      return {
        badgeLabel: LOCAL_DRIVES_PAGE_COPY.statusLabelReady,
        badgeVariant: "success" as const,
        title: LOCAL_DRIVES_PAGE_COPY.summaryReadyTitle,
        message: LOCAL_DRIVES_PAGE_COPY.statusPaired,
      };
    }

    if (currentOriginRecoverable) {
      return {
        badgeLabel: LOCAL_DRIVES_PAGE_COPY.statusLabelActionRequired,
        badgeVariant: "themed" as const,
        title: LOCAL_DRIVES_PAGE_COPY.summaryRepairTitle,
        message: LOCAL_DRIVES_PAGE_COPY.statusRecoverable,
      };
    }

    return {
      badgeLabel: LOCAL_DRIVES_PAGE_COPY.statusLabelActionRequired,
      badgeVariant: "themed" as const,
      title: LOCAL_DRIVES_PAGE_COPY.summaryPairingRequiredTitle,
      message: LOCAL_DRIVES_PAGE_COPY.statusUnpaired,
    };
  }, [browserFullyPaired, currentOriginRecoverable, state.companionAvailable]);
  const sectionCardSx = {
    border: 1,
    borderColor: "divider",
    borderRadius: 2,
    px: { xs: 2, sm: 2.5 },
    py: 2,
    bgcolor: "background.default",
  };
  const summaryBadgeSx =
    summaryState.badgeVariant === "themed"
      ? settingsMetadataChipSx
      : {
          ...settingsMetadataChipSx,
          color: `${summaryState.badgeVariant}.main`,
          borderColor: `${summaryState.badgeVariant}.main`,
          bgcolor: (theme: import("@mui/material").Theme) =>
            summaryState.badgeVariant === "success"
              ? theme.palette.success.main + (theme.palette.mode === "dark" ? "29" : "14")
              : theme.palette.warning.main + (theme.palette.mode === "dark" ? "29" : "14"),
        };
  const shouldShowInstallSection = showStatusContent && !loading && !state.companionAvailable;
  const shouldShowPairingSection = showStatusContent && !loading && state.companionAvailable && !browserFullyPaired;
  const shouldShowVerificationSection = showStatusContent && !loading && browserFullyPaired;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={sectionTitle ?? LOCAL_DRIVES_PAGE_COPY.headerTitle}
        description={sectionDescription ?? LOCAL_DRIVES_PAGE_COPY.headerDescription}
        showTitle={!isMobile}
      />

      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        {companionUnsupportedOnCurrentDevice ? (
          <SettingsGroup
            title={LOCAL_DRIVES_PAGE_COPY.unsupportedMobileTitle}
            description={LOCAL_DRIVES_PAGE_COPY.unsupportedMobileDescription}
            sx={{ mb: 0 }}
          >
            <SettingsInlineAlert severity="info" sx={{ mb: 0 }}>
              {LOCAL_DRIVES_PAGE_COPY.unsupportedMobileAlert}
            </SettingsInlineAlert>
          </SettingsGroup>
        ) : (
          <>
            <SettingsGroup
              title={LOCAL_DRIVES_PAGE_COPY.summaryTitle}
              description={LOCAL_DRIVES_PAGE_COPY.summaryDescription}
              sx={{ mb: 4 }}
            >
              <Box sx={{ ...sectionCardSx, px: { xs: 2, sm: 3 }, py: 3 }}>
                {showStatusContent ? (
                  <Stack spacing={2.5}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
                      <Chip label={summaryState.badgeLabel} size="small" variant="outlined" sx={summaryBadgeSx} />
                    </Stack>

                    <Box>
                      <Typography variant="h6" fontWeight="medium">
                        {summaryState.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
                        {summaryState.message}
                      </Typography>
                    </Box>

                    <Stack spacing={1}>
                      {statusChecklist.map((item) => (
                        <Stack key={item.label} direction="row" spacing={1.25} alignItems="center">
                          {item.complete ? (
                            <CheckCircleOutlineIcon color="success" fontSize="small" />
                          ) : (
                            <RadioButtonUncheckedIcon sx={{ color: "text.disabled" }} fontSize="small" />
                          )}
                          <Typography variant="body2" color={item.complete ? "text.primary" : "text.secondary"}>
                            {item.label}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Stack>
                ) : (
                  <SettingsLoadingState compact />
                )}
              </Box>
            </SettingsGroup>

            {shouldShowInstallSection && (
              <SettingsGroup
                title={LOCAL_DRIVES_PAGE_COPY.downloadSectionTitle}
                description={LOCAL_DRIVES_PAGE_COPY.downloadSectionDescription}
                sx={{ mb: 4 }}
              >
                <Box sx={sectionCardSx}>
                  <Stack spacing={2}>
                    {state.downloadMetadata ? (
                      <Stack spacing={1.5}>
                        <Typography variant="body2" color="text.secondary">
                          {LOCAL_DRIVES_PAGE_COPY.downloadVersionLabel}: {state.downloadMetadata.version}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {LOCAL_DRIVES_PAGE_COPY.downloadSectionSourcePrefix}: {downloadSourceLabel}
                        </Typography>

                        {primaryDownload && (
                          <Stack spacing={1} alignItems="flex-start">
                            <Chip
                              label={LOCAL_DRIVES_PAGE_COPY.downloadRecommendedLabel}
                              size="small"
                              variant="outlined"
                              sx={settingsMetadataChipSx}
                            />
                            <Button
                              component="a"
                              href={primaryDownload[1]}
                              target="_blank"
                              rel="noopener noreferrer"
                              variant="contained"
                              startIcon={<DownloadIcon />}
                              sx={settingsPrimaryButtonSx}
                            >
                              {LOCAL_DRIVES_PAGE_COPY.downloadPrimaryButton} ({COMPANION_PLATFORM_LABELS[primaryDownload[0]]})
                            </Button>
                          </Stack>
                        )}

                        {alternateDownloads.length > 0 && (
                          <Stack spacing={1}>
                            <Typography variant="body2" color="text.secondary">
                              {LOCAL_DRIVES_PAGE_COPY.downloadOtherPlatformsLabel}
                            </Typography>
                            <Box sx={cardActionRowSx}>
                              {alternateDownloads.map(([platformKey, assetUrl]) => (
                                <Button
                                  key={platformKey}
                                  component="a"
                                  href={assetUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  variant="outlined"
                                  startIcon={<OpenInNewIcon />}
                                  sx={settingsUtilityButtonSx}
                                >
                                  {COMPANION_PLATFORM_LABELS[platformKey]}
                                </Button>
                              ))}
                            </Box>
                          </Stack>
                        )}
                      </Stack>
                    ) : state.downloadError ? (
                      <SettingsInlineAlert severity="warning" sx={{ mb: 0 }}>
                        {state.downloadError}
                      </SettingsInlineAlert>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {LOCAL_DRIVES_PAGE_COPY.downloadUnavailable}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </SettingsGroup>
            )}

            {shouldShowPairingSection && (
              <SettingsGroup
                title={LOCAL_DRIVES_PAGE_COPY.pairingSectionTitle}
                description={LOCAL_DRIVES_PAGE_COPY.pairingSectionDescription}
                sx={{ mb: 4 }}
              >
                <Box sx={sectionCardSx}>
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      {LOCAL_DRIVES_PAGE_COPY.pairingSectionRequired}
                    </Typography>
                    <Box sx={cardActionRowSx}>
                      <Button
                        variant="contained"
                        startIcon={<UsbIcon />}
                        onClick={() => setPairingDialogOpen(true)}
                        sx={settingsPrimaryButtonSx}
                      >
                        {LOCAL_DRIVES_PAGE_COPY.pairThisBrowserButton}
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              </SettingsGroup>
            )}

            {shouldShowVerificationSection && (
              <SettingsGroup
                title={LOCAL_DRIVES_PAGE_COPY.verificationSectionTitle}
                description={LOCAL_DRIVES_PAGE_COPY.verificationSectionDescription}
                sx={{ mb: 4 }}
              >
                <Box sx={sectionCardSx}>
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      {LOCAL_DRIVES_PAGE_COPY.verificationSectionReady}
                    </Typography>
                    <Box sx={cardActionRowSx}>
                      <Button
                        variant="contained"
                        startIcon={<ComputerIcon />}
                        onClick={() => void handleTestPairing()}
                        disabled={testing}
                        sx={settingsPrimaryButtonSx}
                      >
                        {testing ? LOCAL_DRIVES_PAGE_COPY.testingButton : LOCAL_DRIVES_PAGE_COPY.testCurrentPairingButton}
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              </SettingsGroup>
            )}

            {showUnpairAction && (
              <SettingsGroup
                title={LOCAL_DRIVES_PAGE_COPY.troubleshootingSectionTitle}
                description={LOCAL_DRIVES_PAGE_COPY.troubleshootingSectionDescription}
                sx={{ mb: 0 }}
              >
                <Box sx={sectionCardSx}>
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      {LOCAL_DRIVES_PAGE_COPY.troubleshootingSectionReady}
                    </Typography>
                    <Box sx={cardActionRowSx}>
                      <Button
                        color="error"
                        variant="outlined"
                        startIcon={<LinkOffIcon />}
                        onClick={() => void handleUnpairCurrentBrowser()}
                        disabled={unpairing}
                        sx={settingsDestructiveButtonSx}
                      >
                        {unpairing ? LOCAL_DRIVES_PAGE_COPY.unpairingButton : LOCAL_DRIVES_PAGE_COPY.unpairThisBrowserButton}
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              </SettingsGroup>
            )}
          </>
        )}
      </Box>

      {!companionUnsupportedOnCurrentDevice && (
        <CompanionPairingDialog
          open={pairingDialogOpen}
          onClose={() => setPairingDialogOpen(false)}
          onInitiate={companionService.initiatePairing}
          onConfirm={handleConfirmPairing}
        />
      )}

      <SettingsNotificationSnackbar
        notification={notification}
        onClose={() => setNotification((current) => ({ ...current, open: false }))}
      />
    </Box>
  );
}
