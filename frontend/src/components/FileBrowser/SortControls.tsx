import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { Box, Button, Divider, Menu, MenuItem, Typography, useMediaQuery, useTheme } from "@mui/material";
import { usePillButtonMenu } from "../../hooks/usePillButtonMenu";
import type { SortField } from "../../pages/FileBrowser/types";
import { pillButtonStyle } from "../../theme/commonStyles";

interface SortControlsProps {
  sortBy: SortField;
  onSortChange: (field: SortField) => void;
  sortDirection: "asc" | "desc";
  onDirectionChange: () => void;
  onAfterChange?: () => void;
}

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  size: "Size",
  modified: "Modified",
  type: "Type",
};

//
// SortControls
//
export function SortControls({ sortBy, onSortChange, sortDirection, onDirectionChange, onAfterChange }: SortControlsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { anchorEl, open, handleClick, handleClose } = usePillButtonMenu(onAfterChange);

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

  const currentLabel = SORT_LABELS[sortBy];
  const directionIcon = sortDirection === "asc" ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />;

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <Button
        onClick={handleClick}
        size="small"
        sx={{
          ...pillButtonStyle,
          color: "text.secondary",
          minHeight: isMobile ? "44px" : undefined,
          px: 2,
        }}
        aria-label="Sort options"
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
            sx: {
              minWidth: 180,
            },
          },
        }}
      >
        <MenuItem onClick={() => handleCriterionChange("name")} selected={sortBy === "name"}>
          Name
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("size")} selected={sortBy === "size"}>
          Size
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("modified")} selected={sortBy === "modified"}>
          Modified
        </MenuItem>
        <MenuItem onClick={() => handleCriterionChange("type")} selected={sortBy === "type"}>
          Type
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
          Ascending
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
          Descending
        </MenuItem>
      </Menu>
    </Box>
  );
}
