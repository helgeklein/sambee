import ComputerIcon from "@mui/icons-material/Computer";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import UsbIcon from "@mui/icons-material/Usb";
import { Alert, Box, Button, Snackbar, Stack, useMediaQuery, useTheme } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import CompanionPairingDialog from "../components/FileBrowser/CompanionPairingDialog";
import { LOCAL_DRIVES_PAGE_COPY } from "../components/Settings/localDrivesCopy";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { settingsDestructiveButtonSx, settingsPrimaryButtonSx, settingsUtilityButtonSx } from "../components/Settings/settingsButtonStyles";
import companionService, {
  clearStoredSecret,
  hasStoredSecret,
  type PairStatusResponse,
  type PairTestResponse,
} from "../services/companion";
import { logger } from "../services/logger";

const LOCAL_DRIVES_SETTINGS_HEADER = {
  title: "Local Drives",
  description: "Pair Sambee Companion and control local-drive access from this browser.",
};

interface LocalDrivesSettingsProps {
  onConnectionsChanged?: () => void;
  dialogSafeHeader?: boolean;
  showHeader?: boolean;
  sectionTitle?: string;
  sectionDescription?: string;
}

interface LocalDrivesState {
  companionAvailable: boolean;
  currentPairStatus: PairStatusResponse | null;
}

/**
 * LocalDrivesSettings
 *
 * Browser-side management UI for the Sambee Companion pairing that exposes
 * local drives inside the file browser.
 */
export function LocalDrivesSettings({
  onConnectionsChanged,
  dialogSafeHeader = false,
  showHeader = true,
  sectionTitle,
  sectionDescription,
}: LocalDrivesSettingsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [state, setState] = useState<LocalDrivesState>({
    companionAvailable: false,
    currentPairStatus: null,
  });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [pairingDialogOpen, setPairingDialogOpen] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info";
  }>({
    open: false,
    message: "",
    severity: "info",
  });

  const currentOrigin = window.location.origin;
  const browserHasStoredSecret = hasStoredSecret();

  const showNotification = useCallback((message: string, severity: "success" | "error" | "info") => {
    setNotification({ open: true, message, severity });
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);

    try {
      const health = await companionService.checkHealth();

      if (!health) {
        setState({
          companionAvailable: false,
          currentPairStatus: null,
        });
        return;
      }

      const currentPairStatus = await companionService.getPairStatus();

      setState({
        companionAvailable: true,
        currentPairStatus,
      });
    } catch (error) {
      logger.error("Failed to load local drives settings", { error }, "companion");
      setState({
        companionAvailable: false,
        currentPairStatus: null,
      });
      showNotification(LOCAL_DRIVES_PAGE_COPY.loadError, "error");
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleConfirmPairing = useCallback(
    async (pairingId: string) => {
      await companionService.confirmPairing(pairingId);
      await loadState();
      onConnectionsChanged?.();
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingCreated, "success");
    },
    [loadState, onConnectionsChanged, showNotification]
  );

  const handleTestPairing = useCallback(async () => {
    setTesting(true);
    try {
      const result: PairTestResponse = await companionService.testPairing();
      await loadState();
      showNotification(result.message, "success");
    } catch (error) {
      logger.error("Companion pairing test failed", { error }, "companion");
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingTestFailed, "error");
    } finally {
      setTesting(false);
    }
  }, [loadState, showNotification]);

  const handleUnpairCurrentBrowser = useCallback(async () => {
    setUnpairing(true);

    try {
      await companionService.unpairOrigin(currentOrigin);
      clearStoredSecret();
      await loadState();
      onConnectionsChanged?.();
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingRemoved, "success");
    } catch (error) {
      logger.error("Failed to remove current browser companion pairing", { error, origin: currentOrigin }, "companion");
      showNotification(LOCAL_DRIVES_PAGE_COPY.pairingRemoveFailed, "error");
    } finally {
      setUnpairing(false);
    }
  }, [currentOrigin, loadState, onConnectionsChanged, showNotification]);

  const currentOriginPaired = state.currentPairStatus?.current_origin_paired ?? false;
  const currentOriginRecoverable = currentOriginPaired && !browserHasStoredSecret;
  const browserFullyPaired = currentOriginPaired && browserHasStoredSecret;
  const showTestAction = browserFullyPaired;
  const showPairAction = state.companionAvailable && !browserFullyPaired;
  const showUnpairAction = browserFullyPaired;
  const actionButtons = (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
      <Button
        variant="outlined"
        startIcon={<RefreshIcon />}
        onClick={() => void loadState()}
        disabled={loading}
        sx={settingsUtilityButtonSx}
      >
        {LOCAL_DRIVES_PAGE_COPY.refreshButton}
      </Button>
      {showTestAction && (
        <Button
          variant="outlined"
          startIcon={<ComputerIcon />}
          onClick={() => void handleTestPairing()}
          disabled={testing}
          sx={settingsUtilityButtonSx}
        >
          {testing ? LOCAL_DRIVES_PAGE_COPY.testingButton : LOCAL_DRIVES_PAGE_COPY.testCurrentPairingButton}
        </Button>
      )}
      {showPairAction && (
        <Button variant="contained" startIcon={<UsbIcon />} onClick={() => setPairingDialogOpen(true)} sx={settingsPrimaryButtonSx}>
          {LOCAL_DRIVES_PAGE_COPY.pairThisBrowserButton}
        </Button>
      )}
      {showUnpairAction && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<LinkOffIcon />}
          onClick={() => void handleUnpairCurrentBrowser()}
          disabled={unpairing}
          sx={settingsDestructiveButtonSx}
        >
          {unpairing ? LOCAL_DRIVES_PAGE_COPY.unpairingButton : LOCAL_DRIVES_PAGE_COPY.unpairThisBrowserButton}
        </Button>
      )}
    </Stack>
  );

  const statusAlert = useMemo(() => {
    if (!state.companionAvailable) {
      return {
        severity: "warning" as const,
        message: LOCAL_DRIVES_PAGE_COPY.statusUnavailable,
      };
    }

    if (currentOriginPaired && browserHasStoredSecret) {
      return {
        severity: "success" as const,
        message: LOCAL_DRIVES_PAGE_COPY.statusPaired,
      };
    }

    if (currentOriginRecoverable) {
      return {
        severity: "warning" as const,
        message: LOCAL_DRIVES_PAGE_COPY.statusRecoverable,
      };
    }

    return {
      severity: "info" as const,
      message: LOCAL_DRIVES_PAGE_COPY.statusUnpaired,
    };
  }, [browserHasStoredSecret, currentOriginPaired, currentOriginRecoverable, state.companionAvailable]);

  return (
    <Box
      sx={{
        height: showHeader ? "100%" : "auto",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: showHeader ? "hidden" : "visible",
      }}
    >
      {showHeader ? (
        <SettingsSectionHeader
          title={LOCAL_DRIVES_SETTINGS_HEADER.title}
          description={LOCAL_DRIVES_SETTINGS_HEADER.description}
          dialogSafe={dialogSafeHeader}
          showTitle={!isMobile}
          actions={actionButtons}
        />
      ) : (
        <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, pb: 2 }}>
          <SettingsGroup title={sectionTitle} description={sectionDescription} actions={actionButtons} />
        </Box>
      )}

      <Box sx={{ flex: showHeader ? 1 : undefined, overflow: showHeader ? "auto" : "visible", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <Alert severity={statusAlert.severity} sx={{ mb: 3 }}>
          {statusAlert.message}
        </Alert>
      </Box>

      <CompanionPairingDialog
        open={pairingDialogOpen}
        onClose={() => setPairingDialogOpen(false)}
        onInitiate={companionService.initiatePairing}
        onConfirm={handleConfirmPairing}
      />

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={() => setNotification((current) => ({ ...current, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={notification.severity}
          onClose={() => setNotification((current) => ({ ...current, open: false }))}
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
