import { Box, MenuItem, type MenuItemProps, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface SettingsSelectMenuItemProps extends Omit<MenuItemProps, "children" | "value"> {
  value: string;
  label: ReactNode;
  description: ReactNode;
}

export function SettingsSelectMenuItem({ value, label, description, disabled = false, ...menuItemProps }: SettingsSelectMenuItemProps) {
  return (
    <MenuItem {...menuItemProps} value={value} disabled={disabled}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", minWidth: 0, py: 0.25 }}>
        <Typography variant="body1" sx={{ whiteSpace: "normal" }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "normal", overflowWrap: "anywhere" }}>
          {description}
        </Typography>
      </Box>
    </MenuItem>
  );
}
