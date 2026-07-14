import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import SettingsIcon from "@mui/icons-material/Settings";
import { Box, ListItemText, Menu, MenuItem } from "@mui/material";
import { BROWSER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import { translate } from "../../i18n";
import { secondaryToolbarMenuPaperSx } from "../../theme/commonStyles";
import { createEscapeHandler } from "../../utils/keyboardUtils";
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
  const { anchorEl, open, handleClick, handleKeyDown, handleKeyUp, handleClose } = usePillButtonMenu(onEscape);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <ToolbarIconButton
        label={translate("fileBrowser.chrome.toolbar.help")}
        tooltip={translate("fileBrowser.chrome.toolbar.help")}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        tabIndex={disableTabFocus ? -1 : undefined}
        ariaControls={open ? "help-menu" : undefined}
        ariaExpanded={open}
        ariaHaspopup="menu"
      >
        <HelpOutlineIcon />
      </ToolbarIconButton>
      <Menu
        id="help-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        slotProps={{
          list: {
            role: "menu",
          },
          paper: {
            sx: secondaryToolbarMenuPaperSx,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            handleClose();
            onOpenHelp();
          }}
        >
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.keyboardShortcuts")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleClose();
            onOpenDocumentation();
          }}
        >
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.documentation")} />
        </MenuItem>
      </Menu>
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
