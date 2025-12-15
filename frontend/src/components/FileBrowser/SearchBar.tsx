//
// SearchBar
//

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, Paper, TextField } from "@mui/material";
import type React from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  useCompactLayout?: boolean;
}

/**
 * Search bar component for filtering files
 * Shows clear button when there's text, with mobile-optimized touch targets
 */
export function SearchBar({ value, onChange, inputRef, useCompactLayout = false }: SearchBarProps) {
  return (
    <Paper
      elevation={1}
      sx={{
        mb: 2,
        position: "sticky",
        top: 0,
        zIndex: 10,
        backgroundColor: "background.paper",
      }}
    >
      <TextField
        fullWidth
        size="small"
        placeholder={useCompactLayout ? "Search..." : "Search files and folders... (press / to focus)"}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        inputRef={inputRef}
        sx={{
          "& .MuiInputBase-root": {
            fontSize: { xs: "16px", sm: "14px" }, // Prevent zoom on iOS
          },
          "& .MuiInputBase-input": {
            padding: { xs: "10px 14px", sm: "8.5px 14px" }, // Ensure min 44px touch target
          },
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize={useCompactLayout ? "medium" : "small"} />
            </InputAdornment>
          ),
          endAdornment: value && (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={() => onChange("")}
                edge="end"
                sx={{
                  minWidth: { xs: 44, sm: "auto" },
                  minHeight: { xs: 44, sm: "auto" },
                }}
                aria-label="Clear search"
              >
                <ClearIcon fontSize={useCompactLayout ? "medium" : "small"} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Paper>
  );
}
