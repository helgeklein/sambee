import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import { translate } from "../../i18n";
import { secondaryToolbarMenuPaperSx } from "../../theme/commonStyles";
import { ToolbarIconButton } from "./ToolbarIconButton";

interface HelpMenuProps {
  onOpenHelp: () => void;
  onOpenDocumentation: () => void;
  onEscape?: () => void;
  tabIndex?: number;
  menuId: string;
}

export function HelpMenu({ onOpenHelp, onOpenDocumentation, onEscape, tabIndex, menuId }: HelpMenuProps) {
  const { anchorEl, open, handleClick, handleKeyDown, handleKeyUp, handleClose } = usePillButtonMenu(onEscape);

  return (
    <>
      <ToolbarIconButton
        label={translate("fileBrowser.chrome.toolbar.help")}
        tooltip={translate("fileBrowser.chrome.toolbar.help")}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        tabIndex={tabIndex}
        ariaControls={open ? menuId : undefined}
        ariaExpanded={open}
        ariaHaspopup="menu"
      >
        <HelpOutlineIcon />
      </ToolbarIconButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        disableRestoreFocus
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
          <ListItemIcon>
            <KeyboardIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.keyboardShortcuts")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleClose();
            onOpenDocumentation();
          }}
        >
          <ListItemIcon>
            <DescriptionOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={translate("fileBrowser.chrome.helpMenu.documentation")} />
        </MenuItem>
      </Menu>
    </>
  );
}
