import SettingsIcon from "@mui/icons-material/Settings";
import { IconButton } from "@mui/material";

//
// DesktopToolbarActions
//

interface DesktopToolbarActionsProps {
  onOpenSettings: () => void;
}

export function DesktopToolbarActions({ onOpenSettings }: DesktopToolbarActionsProps) {
  return (
    <IconButton color="inherit" onClick={onOpenSettings} title="Settings">
      <SettingsIcon />
    </IconButton>
  );
}
