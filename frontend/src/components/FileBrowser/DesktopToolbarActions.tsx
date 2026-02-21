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
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

export function DesktopToolbarActions({ onOpenSettings, onEscape, disableTabFocus }: DesktopToolbarActionsProps) {
  return (
    <IconButton
      color="inherit"
      onClick={onOpenSettings}
      onKeyDown={createEscapeHandler(onEscape)}
      title="Settings"
      tabIndex={disableTabFocus ? -1 : undefined}
    >
      <SettingsIcon />
    </IconButton>
  );
}
