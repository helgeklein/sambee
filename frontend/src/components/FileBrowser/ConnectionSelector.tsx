import { Button, Menu, MenuItem } from "@mui/material";
import { useState } from "react";
import type { Connection } from "../../types";

interface ConnectionSelectorProps {
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
}

//
// ConnectionSelector
//
export function ConnectionSelector({ connections, selectedConnectionId, onConnectionChange }: ConnectionSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  if (connections.length === 0) {
    return null;
  }

  const selectedConnection = connections.find((conn) => conn.id === selectedConnectionId);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (connectionId: string) => {
    onConnectionChange(connectionId);
    handleClose();
  };

  return (
    <>
      <Button
        onClick={handleClick}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? "connection-menu" : undefined}
        sx={{
          color: "inherit",
          textTransform: "none",
          fontSize: "0.9375rem",
          fontWeight: 400,
          mr: 0,
          "&:hover": {
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.08)"),
          },
        }}
      >
        {selectedConnection?.name || "Select Connection"}
      </Button>
      <Menu
        id="connection-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          role: "listbox",
        }}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        {connections.map((conn: Connection) => (
          <MenuItem key={conn.id} onClick={() => handleSelect(conn.id)} selected={conn.id === selectedConnectionId}>
            {conn.name} ({conn.host}/{conn.share_name})
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
