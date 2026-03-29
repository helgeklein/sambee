import { Alert, type AlertColor, Snackbar, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export const SETTINGS_NOTIFICATION_AUTOHIDE_MS = 6000;

export interface SettingsNotificationState {
  open: boolean;
  message: string;
  severity: AlertColor;
}

interface SettingsNotificationSnackbarProps {
  notification: SettingsNotificationState;
  onClose: () => void;
  autoHideDuration?: number;
}

interface SettingsInlineAlertProps {
  children: ReactNode;
  severity?: AlertColor;
  sx?: SxProps<Theme>;
}

export function SettingsNotificationSnackbar({
  notification,
  onClose,
  autoHideDuration = SETTINGS_NOTIFICATION_AUTOHIDE_MS,
}: SettingsNotificationSnackbarProps) {
  return (
    <Snackbar
      open={notification.open}
      autoHideDuration={autoHideDuration}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert severity={notification.severity} onClose={onClose} sx={{ width: "100%" }}>
        {notification.message}
      </Alert>
    </Snackbar>
  );
}

export function SettingsInlineAlert({ children, severity = "error", sx }: SettingsInlineAlertProps) {
  return (
    <Alert severity={severity} sx={[{ mb: 2 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>
      {children}
    </Alert>
  );
}
