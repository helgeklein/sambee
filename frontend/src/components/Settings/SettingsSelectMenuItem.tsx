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
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", py: 0.25 }}>
        <Typography variant="body1">{label}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {description}
        </Typography>
      </Box>
    </MenuItem>
  );
}
