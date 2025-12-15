import { Alert } from "@mui/material";

interface BrowserAlertsProps {
  error: string | null;
  loadingConnections: boolean;
  connectionsCount: number;
  isAdmin: boolean;
}

//
// BrowserAlerts
//
export function BrowserAlerts({ error, loadingConnections, connectionsCount, isAdmin }: BrowserAlertsProps) {
  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loadingConnections && !error && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Loading connections...
        </Alert>
      )}

      {connectionsCount === 0 && !error && !loadingConnections && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No SMB connections configured.
          {isAdmin && " Click the settings icon to add a connection."}
          {!isAdmin && " Please contact an administrator to configure connections."}
        </Alert>
      )}
    </>
  );
}
