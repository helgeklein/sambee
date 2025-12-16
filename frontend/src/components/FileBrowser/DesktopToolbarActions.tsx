import SettingsIcon from "@mui/icons-material/Settings";
import { IconButton } from "@mui/material";

interface DesktopToolbarActionsProps {
  onOpenSettings: () => void;
}

//
// DesktopToolbarActions
//
export function DesktopToolbarActions({ onOpenSettings }: DesktopToolbarActionsProps) {
  // Settings icon is shown for all users - non-admins can access appearance, shortcuts, and account
  return (
    <IconButton color="inherit" onClick={onOpenSettings} title="Settings">
      <SettingsIcon />
    </IconButton>
  );
}
