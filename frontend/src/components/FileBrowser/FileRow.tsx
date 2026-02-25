//
// FileRow
//

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Box, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import React, { useCallback, useState } from "react";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { getFileIcon } from "../../utils/fileIcons";

interface FileRowProps {
  file: FileEntry;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  virtualStart: number;
  virtualSize: number;
  onClick: (file: FileEntry, index: number) => void;
  fileRowStyles: {
    buttonSelected: Record<string, unknown>;
    buttonNotSelected: Record<string, unknown>;
    buttonMultiSelected: Record<string, unknown>;
    buttonFocusedMultiSelected: Record<string, unknown>;
    iconBox: Record<string, unknown>;
    contentBox: Record<string, unknown>;
  };
  viewMode: ViewMode;
  /** Called when "Open in app" is chosen from the context menu */
  onOpenInApp?: (file: FileEntry, index: number) => void;
  /** Called when "Rename" is chosen from the context menu */
  onRename?: (file: FileEntry, index: number) => void;
}

/**
 * Individual file row component for virtualized list
 * Optimized with React.memo and custom comparison
 */
export const FileRow = React.memo(
  React.forwardRef<HTMLDivElement, FileRowProps>(
    (
      { file, index, isSelected, isMultiSelected, virtualStart, virtualSize, onClick, fileRowStyles, viewMode, onOpenInApp, onRename },
      ref
    ) => {
      const isListMode = viewMode === "list";
      const isFile = file.type !== "directory";
      const hasContextMenu = !!(onRename || (isFile && onOpenInApp));

      // Compute the correct row style based on focused + multi-selected state
      const rowStyle =
        isSelected && isMultiSelected
          ? fileRowStyles.buttonFocusedMultiSelected
          : isMultiSelected
            ? fileRowStyles.buttonMultiSelected
            : isSelected
              ? fileRowStyles.buttonSelected
              : fileRowStyles.buttonNotSelected;

      // Context menu state
      const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

      const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
          if (!hasContextMenu) return;
          e.preventDefault();
          setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
        },
        [hasContextMenu]
      );

      const handleContextMenuClose = useCallback(() => {
        setContextMenu(null);
      }, []);

      const handleOpenInAppClick = useCallback(() => {
        setContextMenu(null);
        onOpenInApp?.(file, index);
      }, [onOpenInApp, file, index]);

      const handleRenameClick = useCallback(() => {
        setContextMenu(null);
        onRename?.(file, index);
      }, [onRename, file, index]);

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
            onContextMenu={handleContextMenu}
            sx={rowStyle}
            aria-label={`${file.type === "directory" ? "Folder" : "File"}: ${file.name}${isMultiSelected ? " (selected)" : ""}`}
          >
            {/* Icon: show checkmark when multi-selected, file icon otherwise */}
            {(() => {
              const icon = isMultiSelected ? (
                <CheckCircleIcon sx={{ fontSize: 24, color: "primary.main" }} />
              ) : (
                getFileIcon({
                  filename: file.name,
                  isDirectory: file.type === "directory",
                  size: 24,
                })
              );

              return isListMode ? (
                // List mode: icon + name only
                <>
                  <Box sx={fileRowStyles.iconBox}>{icon}</Box>
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
                    columnGap: 1,
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  <Box sx={fileRowStyles.iconBox}>{icon}</Box>
                  <Box sx={{ ...fileRowStyles.contentBox, minWidth: 0 }}>
                    <Typography variant="body2" noWrap title={file.name} color="text.primary">
                      {file.name}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "right", minWidth: "80px", ml: 1, mr: 3 }} noWrap>
                    {file.type === "directory" ? "" : formatFileSize(file.size)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {formatDate(file.modified_at)}
                  </Typography>
                </Box>
              );
            })()}
          </Box>

          {/* Context menu */}
          {hasContextMenu && (
            <Menu
              open={contextMenu !== null}
              onClose={handleContextMenuClose}
              anchorReference="anchorPosition"
              anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
            >
              {onRename && (
                <MenuItem onClick={handleRenameClick}>
                  <ListItemIcon>
                    <EditIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>Rename</ListItemText>
                </MenuItem>
              )}
              {isFile && onOpenInApp && (
                <MenuItem onClick={handleOpenInAppClick}>
                  <ListItemIcon>
                    <OpenInNewIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>Open in companion app</ListItemText>
                </MenuItem>
              )}
            </Menu>
          )}
        </div>
      );
    }
  ),
  // Custom comparison for optimal re-renders
  (prev, next) =>
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.isMultiSelected === next.isMultiSelected &&
    prev.file.name === next.file.name &&
    prev.file.modified_at === next.file.modified_at &&
    prev.file.size === next.file.size &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.viewMode === next.viewMode &&
    prev.onOpenInApp === next.onOpenInApp &&
    prev.onRename === next.onRename
);

FileRow.displayName = "FileRow";
