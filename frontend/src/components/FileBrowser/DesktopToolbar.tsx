import { Box, Typography } from "@mui/material";
import type { Connection } from "../../types";
import { SambeeLogo } from "../SambeeLogo";
import { ConnectionSelector } from "./ConnectionSelector";
import { DesktopToolbarActions } from "./DesktopToolbarActions";

interface DesktopToolbarProps {
  connections: Connection[];
  selectedConnectionId: string;
  isAdmin: boolean;
  onConnectionChange: (connectionId: string) => void;
  onShowHelp: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

//
// DesktopToolbar
//
export function DesktopToolbar({
  connections,
  selectedConnectionId,
  isAdmin,
  onConnectionChange,
  onShowHelp,
  onOpenSettings,
  onLogout,
}: DesktopToolbarProps) {
  return (
    <>
      <SambeeLogo sx={{ mr: 2 }} />

      <Typography variant="h6" component="div" sx={{ mr: 3 }}>
        Sambee
      </Typography>

      <ConnectionSelector connections={connections} selectedConnectionId={selectedConnectionId} onConnectionChange={onConnectionChange} />

      <Box sx={{ flexGrow: 1 }} />

      <DesktopToolbarActions isAdmin={isAdmin} onShowHelp={onShowHelp} onOpenSettings={onOpenSettings} onLogout={onLogout} />
    </>
  );
}
