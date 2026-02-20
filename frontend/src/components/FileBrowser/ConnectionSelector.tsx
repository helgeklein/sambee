import { Button, Menu, MenuItem } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import { pillButtonStyle } from "../../theme/commonStyles";
import type { Connection } from "../../types";
import { createEscapeHandler } from "../../utils/keyboardUtils";

interface ConnectionSelectorProps {
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  /** Called when menu closes or ESC is pressed on button */
  onAfterChange?: () => void;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

//
// ConnectionSelector
//
export function ConnectionSelector({
  connections,
  selectedConnectionId,
  onConnectionChange,
  onAfterChange,
  disableTabFocus,
}: ConnectionSelectorProps) {
  const { anchorEl, open, handleClick, handleClose } = usePillButtonMenu(onAfterChange);

  if (connections.length === 0) {
    return null;
  }

  const selectedConnection = connections.find((conn) => conn.id === selectedConnectionId);

  const handleSelect = (connectionId: string) => {
    onConnectionChange(connectionId);
    handleClose();
  };

  return (
    <>
      <Button
        onClick={handleClick}
        onKeyDown={createEscapeHandler(onAfterChange)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? "connection-menu" : undefined}
        tabIndex={disableTabFocus ? -1 : undefined}
        sx={{
          ...pillButtonStyle,
          color: "inherit",
          fontSize: "0.9375rem",
          fontWeight: 400,
          mr: 0,
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
