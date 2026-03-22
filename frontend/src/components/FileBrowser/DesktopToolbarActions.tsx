import SettingsIcon from "@mui/icons-material/Settings";
import { IconButton } from "@mui/material";
import { translate } from "../../i18n";
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
      title={translate("fileBrowser.chrome.toolbar.openSettings")}
      aria-label={translate("fileBrowser.chrome.toolbar.openSettings")}
      tabIndex={disableTabFocus ? -1 : undefined}
    >
      <SettingsIcon />
    </IconButton>
  );
}
