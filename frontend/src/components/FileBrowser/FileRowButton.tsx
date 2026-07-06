import { ButtonBase } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import React from "react";

interface FileRowButtonProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  tabIndex?: number;
  ariaLabel?: string;
  dataSelected?: string;
}

const fileRowButtonBaseSx: SxProps<Theme> = {
  alignItems: "stretch",
  appearance: "none",
  backgroundColor: "transparent",
  border: "none",
  borderRadius: 0,
  boxSizing: "border-box",
  color: "inherit",
  display: "flex",
  font: "inherit",
  justifyContent: "flex-start",
  margin: 0,
  minWidth: 0,
  padding: 0,
  textAlign: "left",
  textTransform: "none",
  WebkitAppearance: "none",
  WebkitTapHighlightColor: "transparent",
  width: "100%",
};

export const FileRowButton = React.forwardRef<HTMLButtonElement, FileRowButtonProps>(
  ({ children, sx, onClick, onContextMenu, tabIndex = -1, ariaLabel, dataSelected }, ref) => (
    <ButtonBase
      ref={ref}
      type="button"
      disableRipple
      disableTouchRipple
      focusRipple={false}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      data-selected={dataSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={[fileRowButtonBaseSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    >
      {children}
    </ButtonBase>
  )
);

FileRowButton.displayName = "FileRowButton";
