import ComputerIcon from "@mui/icons-material/Computer";
import LanIcon from "@mui/icons-material/Lan";
import { Box, Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import type { CompanionStatus } from "../../hooks/useCompanion";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import { CONNECTION_TYPE_LOCAL, isLocalDrive } from "../../services/backendRouter";
import { pillButtonStyle } from "../../theme/commonStyles";
import type { Connection } from "../../types";
import { LOCAL_DRIVES_MENU_ACTION_LABEL } from "../Settings/localDrivesCopy";

interface ConnectionSelectorProps {
  connections: Connection[];
  selectedConnectionId: string;
  onConnectionChange: (connectionId: string) => void;
  /** Called when menu closes or ESC is pressed on button */
  onAfterChange?: () => void;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
  /** Companion pairing status — when unavailable or unpaired, shows management entry. */
  companionStatus?: CompanionStatus;
  /** Callback to open settings for local drive management. */
  onManageLocalDrives?: () => void;
  /** Optional ref to the trigger button for keyboard focus management. */
  buttonRef?: React.Ref<HTMLButtonElement>;
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
  companionStatus,
  onManageLocalDrives,
  buttonRef,
}: ConnectionSelectorProps) {
  const { anchorEl, open, handleClick, handleKeyDown, handleKeyUp, handleClose } = usePillButtonMenu(onAfterChange);

  if (connections.length === 0) {
    return null;
  }

  const selectedConnection = connections.find((conn) => conn.id === selectedConnectionId);
  const isSelectedLocal = selectedConnection ? isLocalDrive(selectedConnection.id) : false;

  /** Icon for the pill button — reflects whether the active connection is local or SMB. */
  const ActiveIcon = isSelectedLocal ? ComputerIcon : LanIcon;

  const handleSelect = (connectionId: string) => {
    onConnectionChange(connectionId);
    handleClose();
  };

  const handleManageLocalDrives = () => {
    handleClose();
    onManageLocalDrives?.();
  };

  // Split connections into SMB and local groups for visual separation
  const smbConnections = connections.filter((c) => c.type !== CONNECTION_TYPE_LOCAL);
  const localConnections = connections.filter((c) => c.type === CONNECTION_TYPE_LOCAL);
  const showDivider = smbConnections.length > 0 && localConnections.length > 0;

  return (
    <>
      <Button
        ref={buttonRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        role="combobox"
        size="small"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? "connection-menu" : undefined}
        tabIndex={disableTabFocus ? -1 : undefined}
        sx={{
          ...pillButtonStyle,
          color: "text.secondary",
          px: 2,
        }}
      >
        <Box display="flex" alignItems="center" gap={0.5}>
          <ActiveIcon fontSize="small" sx={{ display: "flex" }} />
          <Typography variant="body2" sx={{ lineHeight: 1.43 }}>
            {selectedConnection?.name || "Select Connection"}
          </Typography>
        </Box>
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
        {/* SMB connections */}
        {smbConnections.map((conn: Connection) => (
          <MenuItem key={conn.id} onClick={() => handleSelect(conn.id)} selected={conn.id === selectedConnectionId}>
            <ListItemIcon>
              <LanIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {conn.name} ({conn.host}/{conn.share_name})
            </ListItemText>
          </MenuItem>
        ))}

        {/* Divider between SMB and local drives */}
        {showDivider && <Divider />}

        {/* Local drives */}
        {localConnections.map((conn: Connection) => (
          <MenuItem key={conn.id} onClick={() => handleSelect(conn.id)} selected={conn.id === selectedConnectionId}>
            <ListItemIcon>
              <ComputerIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{conn.name}</ListItemText>
          </MenuItem>
        ))}

        {/* Local drives management action */}
        {(companionStatus === "unpaired" || companionStatus === "unavailable") && (
          <>
            <Divider />
            <MenuItem onClick={handleManageLocalDrives}>
              <ListItemIcon>
                <ComputerIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{LOCAL_DRIVES_MENU_ACTION_LABEL}</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}
