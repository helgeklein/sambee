//
// StatusBar
//

import { Box, Typography } from "@mui/material";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { FileEntry } from "../../types";
import { STATUS_BAR_STRINGS } from "./statusBarStrings";

/** Shared height constant so breadcrumb bar and status bar match exactly. */
export const STATUS_BAR_HEIGHT = 32;

interface StatusBarProps {
  files: FileEntry[];
  focusedIndex: number;
  activeFilter?: string;
}

/**
 * Status bar showing selected file info and total count
 * Desktop only component
 */
export function StatusBar({ files, focusedIndex, activeFilter }: StatusBarProps) {
  const hasActiveFilter = (activeFilter?.trim().length ?? 0) > 0;

  if (files.length === 0 && !hasActiveFilter) {
    return null;
  }

  const selectedFile = files[focusedIndex];

  return (
    <Box
      sx={{
        px: 2,
        height: STATUS_BAR_HEIGHT,
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: 1,
        borderColor: "divider",
        // Use semantic component tokens from theme - fallback to mode-based logic for backwards compatibility
        bgcolor: (theme) => theme.palette.statusBar?.background || (theme.palette.mode === "dark" ? "background.paper" : "primary.main"),
        color: (theme) => theme.palette.statusBar?.text || (theme.palette.mode === "dark" ? "text.primary" : "primary.contrastText"),
      }}
    >
      {/* Left side - Selected file info */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", minWidth: 0, flex: 1 }}>
        {(() => {
          if (!selectedFile)
            return (
              <Typography
                variant="caption"
                sx={{
                  color: (theme) => theme.palette.statusBar?.textSecondary || "inherit",
                  opacity: (theme) => (theme.palette.statusBar?.textSecondary ? 1 : 0.7),
                }}
              >
                {STATUS_BAR_STRINGS.NO_SELECTION}
              </Typography>
            );

          const parts = [];
          parts.push(selectedFile.name);

          if (selectedFile.type === "file" && selectedFile.size !== undefined && selectedFile.size !== null) {
            parts.push(formatFileSize(selectedFile.size));
          }

          if (selectedFile.modified_at) {
            parts.push(formatDate(selectedFile.modified_at));
          }

          return (
            <Box sx={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
              <Typography variant="caption" noWrap>
                {selectedFile.name}
              </Typography>
              {selectedFile.type === "file" && selectedFile.size !== undefined && selectedFile.size !== null && (
                <Typography variant="caption" noWrap>
                  {formatFileSize(selectedFile.size)}
                </Typography>
              )}
              {selectedFile.modified_at && (
                <Typography variant="caption" noWrap>
                  {formatDate(selectedFile.modified_at)}
                </Typography>
              )}
            </Box>
          );
        })()}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        {hasActiveFilter && (
          <Typography
            variant="caption"
            noWrap
            sx={{
              maxWidth: 240,
              color: (theme) => theme.palette.statusBar?.textSecondary || "inherit",
              opacity: (theme) => (theme.palette.statusBar?.textSecondary ? 1 : 0.85),
            }}
          >
            {STATUS_BAR_STRINGS.filteredBy(activeFilter)}
          </Typography>
        )}

        <Typography
          variant="caption"
          sx={{
            whiteSpace: "nowrap",
            color: (theme) => theme.palette.statusBar?.textSecondary || "inherit",
            opacity: (theme) => (theme.palette.statusBar?.textSecondary ? 1 : 0.7),
          }}
        >
          {STATUS_BAR_STRINGS.itemCount(files.length)}
        </Typography>
      </Box>
    </Box>
  );
}
