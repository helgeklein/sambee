//
// StatusBar
//

import { Box, Typography, useTheme } from "@mui/material";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import { getBarTextColor, getStatusBarStyles } from "../../theme";
import type { FileEntry } from "../../types";

interface StatusBarProps {
  files: FileEntry[];
  focusedIndex: number;
}

/**
 * Status bar showing selected file info and total count
 * Desktop only component
 */
export function StatusBar({ files, focusedIndex }: StatusBarProps) {
  const theme = useTheme();

  if (files.length === 0) {
    return null;
  }

  const selectedFile = files[focusedIndex];

  return (
    <Box sx={getStatusBarStyles(theme)}>
      {/* Left side - Selected file info */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", minWidth: 0, flex: 1 }}>
        {(() => {
          if (!selectedFile)
            return (
              <Typography variant="caption" color={getBarTextColor(theme, "secondary")}>
                No selection
              </Typography>
            );

          const parts = [];
          parts.push(selectedFile.name);

          if (selectedFile.type === "file" && selectedFile.size) {
            parts.push(formatFileSize(selectedFile.size));
          }

          if (selectedFile.modified_at) {
            parts.push(formatDate(selectedFile.modified_at));
          }

          return (
            <Box sx={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
              <Typography variant="caption" color={getBarTextColor(theme, "primary")} noWrap>
                {selectedFile.name}
              </Typography>
              {selectedFile.type === "file" && selectedFile.size && (
                <Typography variant="caption" color={getBarTextColor(theme, "primary")} noWrap>
                  {formatFileSize(selectedFile.size)}
                </Typography>
              )}
              {selectedFile.modified_at && (
                <Typography variant="caption" color={getBarTextColor(theme, "primary")} noWrap>
                  {formatDate(selectedFile.modified_at)}
                </Typography>
              )}
            </Box>
          );
        })()}
      </Box>

      {/* Right side - Total count */}
      <Typography variant="caption" color={getBarTextColor(theme, "secondary")} sx={{ whiteSpace: "nowrap" }}>
        {files.length} item{files.length !== 1 ? "s" : ""}
      </Typography>
    </Box>
  );
}
