import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SettingsIcon from "@mui/icons-material/Settings";
import { IconButton, Tooltip } from "@mui/material";
import { createEscapeHandler } from "../../utils/keyboardUtils";

//
// DesktopToolbarActions
//

interface DesktopToolbarActionsProps {
  onOpenSettings: () => void;
  /** Called when ESC is pressed on the settings button */
  onEscape?: () => void;
  /** Whether the Open in App button should be shown (file is selected) */
  showOpenInApp?: boolean;
  /** Called when the "Open in App" button is clicked */
  onOpenInApp?: () => void;
  /** Whether companion URI generation is in progress */
  openInAppLoading?: boolean;
}

export function DesktopToolbarActions({
  onOpenSettings,
  onEscape,
  showOpenInApp,
  onOpenInApp,
  openInAppLoading,
}: DesktopToolbarActionsProps) {
  return (
    <>
      {showOpenInApp && (
        <Tooltip title="Open in companion app (Ctrl+Enter)">
          <span>
            <IconButton
              color="inherit"
              onClick={onOpenInApp}
              disabled={openInAppLoading}
              onKeyDown={createEscapeHandler(onEscape)}
              aria-label="Open in companion app"
            >
              <OpenInNewIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <IconButton color="inherit" onClick={onOpenSettings} onKeyDown={createEscapeHandler(onEscape)} title="Settings">
        <SettingsIcon />
      </IconButton>
    </>
  );
}
