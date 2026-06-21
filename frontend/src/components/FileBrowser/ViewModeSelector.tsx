import ViewList from "@mui/icons-material/ViewList";
import ViewModule from "@mui/icons-material/ViewModule";
import { Box, Button, Divider, Menu, MenuItem, Typography } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import type { ViewMode } from "../../pages/FileBrowser/types";
import {
  getSecondaryToolbarMenuPaperStyle,
  secondaryStripButtonContentSx,
  secondaryStripButtonIconSx,
  secondaryStripButtonLabelSx,
  secondaryStripButtonSx,
} from "../../theme/commonStyles";
import { VIEW_MODE_SELECTOR_STRINGS } from "./viewModeSelectorStrings";

interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAfterChange?: () => void;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

//
// ViewModeSelector
//
export function ViewModeSelector({ viewMode, onViewModeChange, onAfterChange, disableTabFocus }: ViewModeSelectorProps) {
  const { anchorEl, open, handleClick, handleKeyDown, handleKeyUp, handleClose } = usePillButtonMenu(onAfterChange);

  const handleModeChange = (mode: ViewMode) => {
    if (mode !== viewMode) {
      onViewModeChange(mode);
    }
    handleClose();
  };

  const currentLabel = VIEW_MODE_SELECTOR_STRINGS.optionLabel(viewMode);
  const icon = viewMode === "list" ? <ViewList sx={secondaryStripButtonIconSx} /> : <ViewModule sx={secondaryStripButtonIconSx} />;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        size="small"
        tabIndex={disableTabFocus ? -1 : undefined}
        sx={{
          ...secondaryStripButtonSx,
          color: "text.secondary",
        }}
        aria-label={VIEW_MODE_SELECTOR_STRINGS.ARIA_LABEL}
        aria-controls={open ? "view-mode-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        <Box sx={secondaryStripButtonContentSx}>
          {icon}
          <Typography sx={secondaryStripButtonLabelSx}>{currentLabel}</Typography>
        </Box>
      </Button>
      <Menu
        id="view-mode-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        slotProps={{
          paper: {
            sx: (theme) => ({
              ...getSecondaryToolbarMenuPaperStyle(theme),
              minWidth: 160,
            }),
          },
        }}
      >
        <MenuItem onClick={() => handleModeChange("list")} selected={viewMode === "list"} sx={{ display: "flex", gap: 1 }}>
          <ViewList fontSize="small" sx={{ display: "flex" }} />
          {VIEW_MODE_SELECTOR_STRINGS.optionLabel("list")}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleModeChange("details")} selected={viewMode === "details"} sx={{ display: "flex", gap: 1 }}>
          <ViewModule fontSize="small" sx={{ display: "flex" }} />
          {VIEW_MODE_SELECTOR_STRINGS.optionLabel("details")}
        </MenuItem>
      </Menu>
    </Box>
  );
}
