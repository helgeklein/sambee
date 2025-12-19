import ViewList from "@mui/icons-material/ViewList";
import ViewModule from "@mui/icons-material/ViewModule";
import { Box, Button, Divider, Menu, MenuItem, Typography } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import type { ViewMode } from "../../pages/FileBrowser/types";
import { pillButtonStyle } from "../../theme/commonStyles";

interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAfterChange?: () => void;
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  list: "List",
  details: "Details",
};

//
// ViewModeSelector
//
export function ViewModeSelector({ viewMode, onViewModeChange, onAfterChange }: ViewModeSelectorProps) {
  const { anchorEl, open, handleClick, handleClose } = usePillButtonMenu(onAfterChange);

  const handleModeChange = (mode: ViewMode) => {
    if (mode !== viewMode) {
      onViewModeChange(mode);
    }
    handleClose();
  };

  const currentLabel = VIEW_MODE_LABELS[viewMode];
  const icon =
    viewMode === "list" ? <ViewList fontSize="small" sx={{ display: "flex" }} /> : <ViewModule fontSize="small" sx={{ display: "flex" }} />;

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <Button
        onClick={handleClick}
        size="small"
        sx={{
          ...pillButtonStyle,
          color: "text.secondary",
          px: 2,
        }}
        aria-label="View mode options"
        aria-controls={open ? "view-mode-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        <Box display="flex" alignItems="center" gap={0.5}>
          {icon}
          <Typography variant="body2" sx={{ lineHeight: 1.43 }}>
            {currentLabel}
          </Typography>
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
            sx: {
              minWidth: 160,
            },
          },
        }}
      >
        <MenuItem onClick={() => handleModeChange("list")} selected={viewMode === "list"}>
          <Box display="flex" alignItems="center" gap={1}>
            <ViewList fontSize="small" sx={{ display: "flex" }} />
            <Typography variant="body2" sx={{ lineHeight: 1.43 }}>
              List
            </Typography>
          </Box>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleModeChange("details")} selected={viewMode === "details"}>
          <Box display="flex" alignItems="center" gap={1}>
            <ViewModule fontSize="small" sx={{ display: "flex" }} />
            <Typography variant="body2" sx={{ lineHeight: 1.43 }}>
              Details
            </Typography>
          </Box>
        </MenuItem>
      </Menu>
    </Box>
  );
}
