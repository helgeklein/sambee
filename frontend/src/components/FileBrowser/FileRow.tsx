//
// FileRow
//

import { Box, Typography } from "@mui/material";
import React from "react";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { getFileIcon } from "../../utils/fileIcons";

interface FileRowProps {
  file: FileEntry;
  index: number;
  isSelected: boolean;
  virtualStart: number;
  virtualSize: number;
  onClick: (file: FileEntry, index: number) => void;
  fileRowStyles: {
    buttonSelected: Record<string, unknown>;
    buttonNotSelected: Record<string, unknown>;
    iconBox: Record<string, unknown>;
    contentBox: Record<string, unknown>;
  };
  viewMode: ViewMode;
}

/**
 * Individual file row component for virtualized list
 * Optimized with React.memo and custom comparison
 */
export const FileRow = React.memo(
  React.forwardRef<HTMLDivElement, FileRowProps>(
    ({ file, index, isSelected, virtualStart, virtualSize, onClick, fileRowStyles, viewMode }, ref) => {
      const isListMode = viewMode === "list";

      return (
        <div
          ref={ref}
          data-index={index}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: `${virtualSize}px`,
            transform: `translateY(${virtualStart}px)`,
            willChange: "transform", // GPU acceleration hint
          }}
        >
          <Box
            component="button"
            tabIndex={-1}
            onClick={() => onClick(file, index)}
            sx={isSelected ? fileRowStyles.buttonSelected : fileRowStyles.buttonNotSelected}
            aria-label={`${file.type === "directory" ? "Folder" : "File"}: ${file.name}`}
          >
            {isListMode ? (
              // List mode: icon + name only
              <>
                <Box sx={fileRowStyles.iconBox}>
                  {getFileIcon({
                    filename: file.name,
                    isDirectory: file.type === "directory",
                    size: 24,
                  })}
                </Box>
                <Box sx={fileRowStyles.contentBox}>
                  <Typography variant="body2" noWrap title={file.name} color="text.primary">
                    {file.name}
                  </Typography>
                </Box>
              </>
            ) : (
              // Details mode: icon + name + size + date in grid layout
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr auto auto",
                  gap: 2,
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <Box sx={fileRowStyles.iconBox}>
                  {getFileIcon({
                    filename: file.name,
                    isDirectory: file.type === "directory",
                    size: 24,
                  })}
                </Box>
                <Box sx={{ ...fileRowStyles.contentBox, minWidth: 0 }}>
                  <Typography variant="body2" noWrap title={file.name} color="text.primary">
                    {file.name}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "right", minWidth: "80px", mr: 3 }} noWrap>
                  {file.type === "directory" ? "" : formatFileSize(file.size)}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {formatDate(file.modified_at)}
                </Typography>
              </Box>
            )}
          </Box>
        </div>
      );
    }
  ),
  // Custom comparison for optimal re-renders
  (prev, next) =>
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.file.name === next.file.name &&
    prev.file.modified_at === next.file.modified_at &&
    prev.file.size === next.file.size &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.viewMode === next.viewMode
);

FileRow.displayName = "FileRow";
