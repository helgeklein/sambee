//
// FileRow
//

import { Box, Typography } from "@mui/material";
import React from "react";
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
}

/**
 * Individual file row component for virtualized list
 * Optimized with React.memo and custom comparison
 */
export const FileRow = React.memo(
  React.forwardRef<HTMLDivElement, FileRowProps>(({ file, index, isSelected, virtualStart, virtualSize, onClick, fileRowStyles }, ref) => {
    // Secondary info removed for cleaner, more compact display
    // Will be added back when implementing multiple view modes (list, detail, thumbnail)
    const secondaryText = "";

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
          aria-label={`${file.type === "directory" ? "Folder" : "File"}: ${file.name}${secondaryText ? `, ${secondaryText}` : ""}`}
        >
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
            {secondaryText ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {secondaryText}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </div>
    );
  }),
  // Custom comparison for optimal re-renders
  (prev, next) =>
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.file.name === next.file.name &&
    prev.file.modified_at === next.file.modified_at &&
    prev.file.size === next.file.size &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize
);

FileRow.displayName = "FileRow";
