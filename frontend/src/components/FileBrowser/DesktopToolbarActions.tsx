import SettingsIcon from "@mui/icons-material/Settings";
import { IconButton } from "@mui/material";
import { createEscapeHandler } from "../../utils/keyboardUtils";

//
// DesktopToolbarActions
//

interface DesktopToolbarActionsProps {
  onOpenSettings: () => void;
  /** Called when ESC is pressed on the settings button */
  onEscape?: () => void;
}

export function DesktopToolbarActions({ onOpenSettings, onEscape }: DesktopToolbarActionsProps) {
  return (
    <IconButton color="inherit" onClick={onOpenSettings} onKeyDown={createEscapeHandler(onEscape)} title="Settings">
      <SettingsIcon />
    </IconButton>
  );
}
