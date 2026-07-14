import SettingsIcon from "@mui/icons-material/Settings";
import { Box, IconButton, ListItemText, Menu, MenuItem } from "@mui/material";
import { type MouseEvent, useState } from "react";
import { BROWSER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { translate } from "../../i18n";
import { createEscapeHandler } from "../../utils/keyboardUtils";
import { HelpCircleOutlineIcon } from "../HelpCircleOutlineIcon";

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
  const [helpMenuAnchorEl, setHelpMenuAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpenHelpMenu = (event: MouseEvent<HTMLElement>) => {
    setHelpMenuAnchorEl(event.currentTarget);
  };

  const handleCloseHelpMenu = () => {
    setHelpMenuAnchorEl(null);
  };

  const handleMenuClose = (_event: unknown, reason: string) => {
    handleCloseHelpMenu();
    if (reason === "escapeKeyDown") {
      onEscape?.();
    }
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <IconButton
        color="inherit"
        onClick={handleOpenHelpMenu}
        onKeyDown={createEscapeHandler(onEscape)}
        title={translate("fileBrowser.chrome.toolbar.help")}
        aria-label={translate("fileBrowser.chrome.toolbar.help")}
        tabIndex={disableTabFocus ? -1 : undefined}
      >
        <HelpCircleOutlineIcon />
      </IconButton>
      <Menu
        anchorEl={helpMenuAnchorEl}
        open={helpMenuAnchorEl !== null}
        onClose={handleMenuClose}
        slotProps={{
          paper: {
            sx: {
              bgcolor: "background.paper",
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            handleCloseHelpMenu();
            onOpenHelp();
          }}
        >
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.keyboardShortcuts")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleCloseHelpMenu();
            onOpenDocumentation();
          }}
        >
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.documentation")} />
        </MenuItem>
      </Menu>
      <IconButton
        color="inherit"
        onClick={onOpenSettings}
        onKeyDown={createEscapeHandler(onEscape)}
        title={withShortcut(BROWSER_SHORTCUTS.OPEN_SETTINGS)}
        aria-label={translate("fileBrowser.chrome.toolbar.openSettings")}
        tabIndex={disableTabFocus ? -1 : undefined}
      >
        <SettingsIcon />
      </IconButton>
    </Box>
  );
}
