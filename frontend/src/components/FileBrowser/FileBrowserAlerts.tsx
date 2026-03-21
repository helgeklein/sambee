//
// FileBrowserAlerts
//

import { Alert, Box, Link, Typography } from "@mui/material";
import type { BackendAvailabilityStatus } from "../../services/backendAvailability";
import { useSambeeTheme } from "../../theme/ThemeContext";
import { EmptyStateIllustration } from "./EmptyStateIllustration";

interface FileBrowserAlertsProps {
  error: string | null;
  loadingConnections: boolean;
  connectionsCount: number;
  isAdmin: boolean;
  backendAvailabilityStatus: BackendAvailabilityStatus;
  /** Callback when user wants to open settings with connections tab */
  onOpenConnectionsSettings?: () => void;
}

/**
 * FileBrowserAlerts
 *
 * Displays contextual alerts and messages in the file browser.
 * Includes:
 * - Error messages
 * - Loading states
 * - Welcome/onboarding for new users with no connections
 */
export function FileBrowserAlerts({
  error,
  loadingConnections,
  connectionsCount,
  isAdmin,
  backendAvailabilityStatus,
  onOpenConnectionsSettings,
}: FileBrowserAlertsProps) {
  const { currentTheme } = useSambeeTheme();
  const alertStyles = currentTheme.components?.alert;

  // Get themed alert colors with fallbacks
  const getAlertStyles = (severity: "info" | "warning" | "error") => {
    const styles = alertStyles?.[severity];
    if (styles) {
      return {
        backgroundColor: styles.background,
        color: styles.text,
        "& .MuiAlert-icon": {
          color: styles.icon,
        },
      };
    }
    return {};
  };

  // Show welcome/onboarding when no connections
  if (connectionsCount === 0 && !error && !loadingConnections && backendAvailabilityStatus === "available") {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          pt: "15vh",
          px: 3,
          textAlign: "center",
          flex: 1,
        }}
      >
        <EmptyStateIllustration width={180} sx={{ mb: 3, color: "text.secondary" }} />

        <Typography variant="h5" gutterBottom sx={{ fontWeight: 500 }}>
          Welcome to Sambee!
        </Typography>

        {isAdmin ? (
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
            Get started by{" "}
            {onOpenConnectionsSettings ? (
              <Link
                component="button"
                variant="body1"
                onClick={onOpenConnectionsSettings}
                sx={{
                  fontWeight: 600,
                  cursor: "pointer",
                  verticalAlign: "baseline",
                }}
              >
                adding your first SMB network share
              </Link>
            ) : (
              "adding your first SMB network share"
            )}
            . You'll be able to browse and view files from your network storage.
          </Typography>
        ) : (
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
            Sambee lets you browse and view files from network shares. Please contact an administrator to set up network shares.
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2, mx: 2, ...getAlertStyles("error") }}>
          {error}
        </Alert>
      )}

      {backendAvailabilityStatus === "unavailable" && (
        <Alert severity="warning" sx={{ mb: 2, mx: 2, ...getAlertStyles("warning") }}>
          Backend connection lost. The current UI remains available, but refreshes and live updates may fail until the connection returns.
        </Alert>
      )}

      {backendAvailabilityStatus === "reconnecting" && (
        <Alert severity="info" sx={{ mb: 2, mx: 2, ...getAlertStyles("info") }}>
          Reconnecting to backend. Live updates may be delayed for a moment.
        </Alert>
      )}

      {loadingConnections && !error && (
        <Alert severity="info" sx={{ mb: 2, mx: 2, ...getAlertStyles("info") }}>
          Loading connections...
        </Alert>
      )}
    </>
  );
}
