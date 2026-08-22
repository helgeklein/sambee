import SettingsIcon from "@mui/icons-material/Settings";
import { Box } from "@mui/material";
import { BROWSER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { translate } from "../../i18n";
import { createEscapeHandler } from "../../utils/keyboardUtils";
import { HelpMenu } from "./HelpMenu";
import { ToolbarIconButton } from "./ToolbarIconButton";

//
// DesktopToolbarActions
//

interface DesktopToolbarActionsProps {
  onOpenHelp: () => void;
  onOpenDocumentation: () => void;
  onOpenSettings: () => void;
  /** Called when ESC is pressed on the settings button */
  onEscape?: () => void;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

export function DesktopToolbarActions({
  onOpenHelp,
  onOpenDocumentation,
  onOpenSettings,
  onEscape,
  disableTabFocus,
}: DesktopToolbarActionsProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <HelpMenu
        menuId="help-menu"
        onOpenHelp={onOpenHelp}
        onOpenDocumentation={onOpenDocumentation}
        onEscape={onEscape}
        tabIndex={disableTabFocus ? -1 : undefined}
      />
      <ToolbarIconButton
        label={translate("fileBrowser.chrome.toolbar.openSettings")}
        tooltip={withShortcut(BROWSER_SHORTCUTS.OPEN_SETTINGS)}
        onClick={onOpenSettings}
        onKeyDown={createEscapeHandler(onEscape)}
        tabIndex={disableTabFocus ? -1 : undefined}
      >
        <SettingsIcon />
      </ToolbarIconButton>
    </Box>
  );
}
