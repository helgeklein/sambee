import { Box, Typography } from "@mui/material";
import type React from "react";
import type { Connection } from "../../types";
import { SambeeLogo } from "../SambeeLogo";
import { ConnectionSelector } from "./ConnectionSelector";
import { DesktopToolbarActions } from "./DesktopToolbarActions";
import { SearchBar } from "./SearchBar";

interface DesktopToolbarProps {
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  showSearch: boolean;
  onOpenSettings: () => void;
  onAfterMenuClose?: () => void;
}

//
// DesktopToolbar
//
export function DesktopToolbar({
  connections,
  selectedConnectionId,
  onConnectionChange,
  searchQuery,
  onSearchChange,
  searchInputRef,
  showSearch,
  onOpenSettings,
  onAfterMenuClose,
}: DesktopToolbarProps) {
  return (
    <>
      <SambeeLogo sx={{ mr: 2 }} />

      <Typography variant="h6" component="div">
        Sambee
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      {showSearch && (
        <Box sx={{ flexGrow: 0, width: "100%", maxWidth: { sm: 400, md: 500, lg: 600 }, mx: 2 }}>
          <SearchBar value={searchQuery} onChange={onSearchChange} inputRef={searchInputRef} useCompactLayout={false} />
        </Box>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <ConnectionSelector
        connections={connections}
        selectedConnectionId={selectedConnectionId}
        onConnectionChange={onConnectionChange}
        onAfterChange={onAfterMenuClose}
      />

      <DesktopToolbarActions onOpenSettings={onOpenSettings} />
    </>
  );
}
