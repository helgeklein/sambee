import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { Box, Button, Divider, Menu, MenuItem, Typography, useMediaQuery, useTheme } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import type { SortField } from "../../pages/FileBrowser/types";
import { getSecondaryToolbarMenuPaperStyle, pillButtonStyle } from "../../theme/commonStyles";
import { SORT_CONTROLS_STRINGS } from "./sortControlsStrings";

interface SortControlsProps {
  sortBy: SortField;
  onSortChange: (field: SortField) => void;
  sortDirection: "asc" | "desc";
  onDirectionChange: () => void;
  onAfterChange?: () => void;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
}

//
// SortControls
//
export function SortControls({
  sortBy,
  onSortChange,
  sortDirection,
  onDirectionChange,
  onAfterChange,
  disableTabFocus,
}: SortControlsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { anchorEl, open, handleClick, handleKeyDown, handleKeyUp, handleClose } = usePillButtonMenu(onAfterChange);

  const handleCriterionChange = (field: SortField) => {
    if (field !== sortBy) {
      onSortChange(field);
    }
    handleClose();
  };

  const handleDirectionToggle = () => {
    onDirectionChange();
    handleClose();
  };

  const currentLabel = SORT_CONTROLS_STRINGS.fieldLabel(sortBy);
  const directionIcon = sortDirection === "asc" ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />;

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <Button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        size="small"
        tabIndex={disableTabFocus ? -1 : undefined}
        sx={{
          ...pillButtonStyle,
          color: "text.secondary",
          minHeight: isMobile ? "44px" : undefined,
          px: 2,
        }}
        aria-label={SORT_CONTROLS_STRINGS.ARIA_LABEL}
        aria-controls={open ? "sort-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        <Box display="flex" alignItems="center" gap={0.5}>
          {directionIcon}
          <Typography variant="body2">{currentLabel}</Typography>
        </Box>
      </Button>
      <Menu
        id="sort-menu"
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
              minWidth: 180,
            }),
          },
        }}
      >
        <MenuItem onClick={() => handleCriterionChange("name")} selected={sortBy === "name"}>
          {SORT_CONTROLS_STRINGS.fieldLabel("name")}
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("size")} selected={sortBy === "size"}>
          {SORT_CONTROLS_STRINGS.fieldLabel("size")}
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("modified")} selected={sortBy === "modified"}>
          {SORT_CONTROLS_STRINGS.fieldLabel("modified")}
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("type")} selected={sortBy === "type"}>
          {SORT_CONTROLS_STRINGS.fieldLabel("type")}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={handleDirectionToggle}
          selected={sortDirection === "asc"}
          sx={{
            display: "flex",
            gap: 1,
          }}
        >
          <ArrowUpwardIcon fontSize="small" />
          {SORT_CONTROLS_STRINGS.ASCENDING}
        </MenuItem>
        <MenuItem
          onClick={handleDirectionToggle}
          selected={sortDirection === "desc"}
          sx={{
            display: "flex",
            gap: 1,
          }}
        >
          <ArrowDownwardIcon fontSize="small" />
          {SORT_CONTROLS_STRINGS.DESCENDING}
        </MenuItem>
      </Menu>
    </Box>
  );
}
