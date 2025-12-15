import KeyboardIcon from "@mui/icons-material/KeyboardOutlined";
import SettingsIcon from "@mui/icons-material/Settings";
import { Button, IconButton } from "@mui/material";
import { ThemeSelector } from "../ThemeSelector";

interface DesktopToolbarActionsProps {
  isAdmin: boolean;
  onShowHelp: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

//
// DesktopToolbarActions
//
export function DesktopToolbarActions({ isAdmin, onShowHelp, onOpenSettings, onLogout }: DesktopToolbarActionsProps) {
  return (
    <>
      <ThemeSelector />

      <IconButton color="inherit" onClick={onShowHelp} sx={{ mr: 1 }} title="Keyboard Shortcuts (?)">
        <KeyboardIcon />
      </IconButton>

      {isAdmin && (
        <IconButton color="inherit" onClick={onOpenSettings} sx={{ mr: 1 }} title="Settings">
          <SettingsIcon />
        </IconButton>
      )}

      <Button color="inherit" onClick={onLogout}>
        Logout
      </Button>
    </>
  );
}
