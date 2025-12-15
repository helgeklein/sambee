import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DataUsageIcon from "@mui/icons-material/DataUsage";
import RefreshIcon from "@mui/icons-material/Refresh";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { SortField } from "../../pages/FileBrowser/types";

interface SortControlsProps {
  sortBy: SortField;
  onSortChange: (field: SortField) => void;
  sortDirection: "asc" | "desc";
  onDirectionChange: () => void;
  onRefresh: () => void;
}

//
// SortControls
//
export function SortControls({ sortBy, onSortChange, sortDirection, onDirectionChange, onRefresh }: SortControlsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <IconButton onClick={onRefresh} size="small" aria-label="refresh files" sx={{ minWidth: "44px", minHeight: "44px" }}>
        <RefreshIcon />
      </IconButton>
      <Typography variant="body2" color="text.secondary">
        Sort by:
      </Typography>
      <ToggleButtonGroup
        value={sortBy}
        exclusive
        onChange={(_e, value: SortField | null) => {
          if (value !== null) {
            onSortChange(value);
          }
        }}
        size="small"
        sx={{
          "& .MuiToggleButton-root": {
            minWidth: isMobile ? "44px" : undefined,
            minHeight: isMobile ? "44px" : undefined,
          },
        }}
      >
        <ToggleButton value="name" aria-label="sort by name">
          <SortByAlphaIcon fontSize="small" />
        </ToggleButton>
        <ToggleButton value="size" aria-label="sort by size">
          <DataUsageIcon fontSize="small" />
        </ToggleButton>
        <ToggleButton value="modified" aria-label="sort by modified date">
          <AccessTimeIcon fontSize="small" />
        </ToggleButton>
      </ToggleButtonGroup>
      <IconButton
        onClick={onDirectionChange}
        size="small"
        aria-label={`sort direction ${sortDirection}`}
        sx={{ minWidth: "44px", minHeight: "44px" }}
      >
        {sortDirection === "asc" ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
      </IconButton>
    </Box>
  );
}
