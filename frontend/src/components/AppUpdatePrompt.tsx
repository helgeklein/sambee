import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "../i18n";
import { logger } from "../services/logger";
import { CURRENT_BUILD_INFO, hasBuildMismatch, shortenCommit } from "../utils/buildInfo";
import type { VersionInfo } from "../utils/version";
import { fetchVersionInfo } from "../utils/version";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
const VISIBILITY_RECHECK_DELAY_MS = 1_500;
const UPDATE_CHECKS_ENABLED = import.meta.env.MODE !== "development";

export function AppUpdatePrompt() {
  const [availableUpdate, setAvailableUpdate] = useState<VersionInfo | null>(null);
  const visibilityTimeoutRef = useRef<number | null>(null);
  const loggedFingerprintRef = useRef<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!UPDATE_CHECKS_ENABLED) {
      return;
    }

    const versionInfo = await fetchVersionInfo();
    if (!versionInfo || !hasBuildMismatch(versionInfo)) {
      return;
    }

    const detectedFingerprint = `${versionInfo.version}:${versionInfo.git_commit}`;
    if (loggedFingerprintRef.current !== detectedFingerprint) {
      logger.warn(
        "Detected newer frontend build on the server",
        {
          currentVersion: CURRENT_BUILD_INFO.version,
          currentCommit: CURRENT_BUILD_INFO.git_commit,
          serverVersion: versionInfo.version,
          serverCommit: versionInfo.git_commit,
        },
        "app"
      );
      loggedFingerprintRef.current = detectedFingerprint;
    }

    setAvailableUpdate(versionInfo);
  }, []);

  useEffect(() => {
    if (!UPDATE_CHECKS_ENABLED) {
      return;
    }

    void checkForUpdate();

    const intervalId = window.setInterval(() => {
      void checkForUpdate();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkForUpdate]);

  useEffect(() => {
    if (!UPDATE_CHECKS_ENABLED) {
      return;
    }

    const scheduleVisibleCheck = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (visibilityTimeoutRef.current !== null) {
        window.clearTimeout(visibilityTimeoutRef.current);
      }

      visibilityTimeoutRef.current = window.setTimeout(() => {
        visibilityTimeoutRef.current = null;
        void checkForUpdate();
      }, VISIBILITY_RECHECK_DELAY_MS);
    };

    document.addEventListener("visibilitychange", scheduleVisibleCheck);
    window.addEventListener("focus", scheduleVisibleCheck);

    return () => {
      document.removeEventListener("visibilitychange", scheduleVisibleCheck);
      window.removeEventListener("focus", scheduleVisibleCheck);
      if (visibilityTimeoutRef.current !== null) {
        window.clearTimeout(visibilityTimeoutRef.current);
      }
    };
  }, [checkForUpdate]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  const handleLater = useCallback(() => {
    setAvailableUpdate(null);
  }, []);

  if (!UPDATE_CHECKS_ENABLED) {
    return null;
  }

  return (
    <Dialog open={availableUpdate !== null} onClose={handleLater} aria-labelledby="app-update-title">
      <DialogTitle id="app-update-title">{translate("app.updateAvailable.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{translate("app.updateAvailable.description")}</DialogContentText>
          {availableUpdate && (
            <Alert severity="info">
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  {translate("app.updateAvailable.currentBuild", {
                    version: CURRENT_BUILD_INFO.version,
                    commit: shortenCommit(CURRENT_BUILD_INFO.git_commit),
                  })}
                </Typography>
                <Typography variant="body2">
                  {translate("app.updateAvailable.latestBuild", {
                    version: availableUpdate.version,
                    commit: shortenCommit(availableUpdate.git_commit),
                  })}
                </Typography>
              </Stack>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleLater}>{translate("app.updateAvailable.later")}</Button>
        <Button onClick={handleReload} variant="contained" autoFocus>
          {translate("app.updateAvailable.reload")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AppUpdatePrompt;
