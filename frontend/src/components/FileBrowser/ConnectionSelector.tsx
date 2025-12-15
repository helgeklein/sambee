import { FormControl, MenuItem, Select } from "@mui/material";
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
  if (connections.length === 0) {
    return null;
  }

  return (
    <FormControl
      size="small"
      sx={{
        minWidth: 250,
        mr: 2,
      }}
    >
      <Select
        value={selectedConnectionId}
        onChange={(e) => onConnectionChange(e.target.value)}
        displayEmpty
        sx={{
          color: "primary.contrastText",
          ".MuiOutlinedInput-notchedOutline": {
            borderColor: "primary.contrastText",
            opacity: 0.23,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "primary.contrastText",
            opacity: 0.4,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "primary.contrastText",
            opacity: 1,
          },
          ".MuiSvgIcon-root": {
            color: "primary.contrastText",
          },
        }}
      >
        {connections.map((conn: Connection) => (
          <MenuItem key={conn.id} value={conn.id}>
            {conn.name} ({conn.host}/{conn.share_name})
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
