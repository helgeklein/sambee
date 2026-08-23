//
// FileRow
//

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ShortcutIcon from "@mui/icons-material/Shortcut";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Box, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { isShortcutFile } from "../../utils/fileEntries";
import { getFileIcon } from "../../utils/fileIcons";
import { FileRowButton } from "./FileRowButton";

interface FileRowProps {
  file: FileEntry;
  useCompactLayout?: boolean;
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
  onOpenAssociatedViewer?: (file: FileEntry, index: number) => void;
  onOpenViewerPicker?: (file: FileEntry, index: number) => void;
  onOpenAssociatedNativeApp?: (file: FileEntry, index: number) => void;
  onOpenNativePicker?: (file: FileEntry, index: number) => void;
  /** Called when "Rename" is chosen from the context menu */
  onRename?: (file: FileEntry, index: number) => void;
}

const ELLIPSIS = "...";

type TextMeasurer = (text: string) => number;

/** Preserve the end of a label when its complete text cannot fit. */
function shortenTextFromStart(text: string, availableWidth: number, measureText: TextMeasurer): string {
  if (availableWidth <= 0 || measureText(text) <= availableWidth) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (measureText(`${ELLIPSIS}${text.slice(middle)}`) <= availableWidth) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return `${ELLIPSIS}${text.slice(low)}`;
}

/** Preserve the target basename while collapsing ancestor directories to fit. */
export function shortenTargetPath(path: string, availableWidth: number, measureText: TextMeasurer): string {
  if (availableWidth <= 0 || measureText(path) <= availableWidth) {
    return path;
  }

  const separator = path.includes("\\") ? "\\" : "/";
  const driveMatch = path.match(/^[A-Za-z]:[\\/]/);
  const root = driveMatch ? `${driveMatch[0][0]}:${separator}` : path.startsWith(separator) ? separator : "";
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  const basename = segments.pop();
  if (!basename) {
    return path;
  }

  if (measureText(basename) > availableWidth) {
    return shortenTextFromStart(basename, availableWidth, measureText);
  }

  if (segments.length === 0) {
    return basename;
  }

  const prefix = root ? `${root}${ELLIPSIS}${separator}` : `${ELLIPSIS}${separator}`;
  let shortened = `${prefix}${basename}`;
  while (segments.length > 0) {
    const candidate = `${prefix}${segments.at(-1)}${separator}${shortened.slice(prefix.length)}`;
    if (measureText(candidate) > availableWidth) {
      break;
    }
    shortened = candidate;
    segments.pop();
  }

  return shortened;
}

function TargetPathLabel({ path, rowTextSx }: { path: string; rowTextSx?: Record<string, string> }) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [displayPath, setDisplayPath] = useState(path);

  useEffect(() => {
    const label = labelRef.current;
    const measurement = measureRef.current;
    if (!label || !measurement) return;

    const updatePath = () => {
      const availableWidth = label.clientWidth;
      if (availableWidth <= 0) {
        setDisplayPath(path);
        return;
      }
      const measureText = (text: string) => {
        measurement.textContent = text;
        return measurement.getBoundingClientRect().width;
      };
      setDisplayPath(shortenTargetPath(path, availableWidth, measureText));
    };

    updatePath();
    const observer = new ResizeObserver(updatePath);
    observer.observe(label);
    return () => observer.disconnect();
  }, [path]);

  return (
    <>
      <Typography variant="body2" component="span" noWrap sx={{ ...rowTextSx, color: "text.secondary", flex: "0 0 auto" }}>
        {" \u2192 "}
      </Typography>
      <Typography
        ref={labelRef}
        variant="body2"
        component="span"
        noWrap
        title={path}
        sx={{ ...rowTextSx, color: "text.secondary", flex: "1 1 50%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {displayPath}
      </Typography>
      <Typography
        ref={measureRef}
        aria-hidden
        component="span"
        sx={{ ...rowTextSx, left: -10000, position: "fixed", visibility: "hidden", whiteSpace: "nowrap" }}
      />
    </>
  );
}

/**
 * Individual file row component for virtualized list
 * Optimized with React.memo and custom comparison
 */
export const FileRow = React.memo(
  React.forwardRef<HTMLDivElement, FileRowProps>(
    (
      {
        file,
        useCompactLayout = false,
        index,
        isSelected,
        isMultiSelected,
        virtualStart,
        virtualSize,
        onClick,
        fileRowStyles,
        viewMode,
        onOpenAssociatedViewer,
        onOpenViewerPicker,
        onOpenAssociatedNativeApp,
        onOpenNativePicker,
        onRename,
      },
      ref
    ) => {
      const { t } = useTranslation();
      const isListMode = viewMode === "list";
      const linkTarget = file.link_target?.target;
      const isShortcut = isShortcutFile(file);
      const isFile = file.type !== "directory" && linkTarget?.type !== "directory";
      const rowTextSx = useCompactLayout ? { fontSize: "16px" } : undefined;
      const hasContextMenu = !!(
        onRename ||
        (isFile && (onOpenAssociatedViewer || onOpenViewerPicker || onOpenAssociatedNativeApp || onOpenNativePicker))
      );
      const itemTypeLabel = t(file.type === "directory" ? "fileBrowser.row.itemTypes.folder" : "fileBrowser.row.itemTypes.file");
      const linkTargetName = linkTarget?.name;
      const linkTargetPath = linkTarget?.path ?? linkTargetName;
      const ariaLabel = `${itemTypeLabel}: ${file.name}${
        linkTargetPath
          ? t("fileBrowser.row.shortcutTargetSuffix", { target: linkTargetPath })
          : isShortcut
            ? t("fileBrowser.row.shortcutSuffix")
            : ""
      }${isMultiSelected ? t("fileBrowser.row.selectedSuffix") : ""}`;

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

      const handleOpenAssociatedViewerClick = useCallback(() => {
        setContextMenu(null);
        onOpenAssociatedViewer?.(file, index);
      }, [onOpenAssociatedViewer, file, index]);

      const handleOpenViewerPickerClick = useCallback(() => {
        setContextMenu(null);
        onOpenViewerPicker?.(file, index);
      }, [onOpenViewerPicker, file, index]);

      const handleOpenAssociatedNativeAppClick = useCallback(() => {
        setContextMenu(null);
        onOpenAssociatedNativeApp?.(file, index);
      }, [onOpenAssociatedNativeApp, file, index]);

      const handleOpenNativePickerClick = useCallback(() => {
        setContextMenu(null);
        onOpenNativePicker?.(file, index);
      }, [onOpenNativePicker, file, index]);

      const handleRenameClick = useCallback(() => {
        setContextMenu(null);
        onRename?.(file, index);
      }, [onRename, file, index]);

      const fileName = (
        <Box sx={{ display: "flex", minWidth: 0, width: "100%" }}>
          <Typography
            variant="body2"
            component="span"
            noWrap
            title={file.name}
            sx={{ ...rowTextSx, color: "text.primary", flex: linkTargetPath ? "1 1 50%" : 1, minWidth: 0 }}
          >
            {file.name}
          </Typography>
          {linkTargetPath ? <TargetPathLabel path={linkTargetPath} rowTextSx={rowTextSx} /> : null}
        </Box>
      );

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
          <FileRowButton
            tabIndex={-1}
            onClick={() => onClick(file, index)}
            onContextMenu={handleContextMenu}
            sx={rowStyle}
            dataSelected={isSelected ? "true" : undefined}
            ariaLabel={ariaLabel}
          >
            {/* Icon: show checkmark when multi-selected, file icon otherwise */}
            {(() => {
              const icon = (() => {
                if (isMultiSelected) {
                  return <CheckCircleIcon sx={{ fontSize: 24, color: "primary.main" }} />;
                }

                if (isShortcut) {
                  return <ShortcutIcon sx={{ fontSize: 24, color: "text.secondary" }} />;
                }

                return getFileIcon({
                  filename: file.name,
                  isDirectory: file.type === "directory",
                  size: 24,
                });
              })();

              return isListMode ? (
                // List mode: icon + name only
                <>
                  <Box sx={fileRowStyles.iconBox}>{icon}</Box>
                  <Box sx={{ ...fileRowStyles.contentBox, minWidth: 0 }}>{fileName}</Box>
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
                  <Box sx={{ ...fileRowStyles.contentBox, minWidth: 0 }}>{fileName}</Box>
                  <Typography
                    variant="body2"
                    sx={{ textAlign: "right", minWidth: "80px", ml: 1, mr: 3, ...rowTextSx, color: "text.secondary" }}
                    noWrap
                  >
                    {file.type === "directory" ? "" : formatFileSize(file.size)}
                  </Typography>
                  <Typography variant="body2" sx={{ ...rowTextSx, color: "text.secondary" }} noWrap>
                    {formatDate(file.modified_at)}
                  </Typography>
                </Box>
              );
            })()}
          </FileRowButton>

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
                  <ListItemText>{t("common.actions.rename")}</ListItemText>
                </MenuItem>
              )}
              {isFile && onOpenAssociatedViewer && (
                <MenuItem onClick={handleOpenAssociatedViewerClick}>
                  <ListItemIcon>
                    <VisibilityIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t("fileBrowser.row.openInBrowserViewer")}</ListItemText>
                </MenuItem>
              )}
              {isFile && onOpenViewerPicker && (
                <MenuItem onClick={handleOpenViewerPickerClick}>
                  <ListItemIcon>
                    <VisibilityIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t("fileBrowser.row.chooseBrowserViewer")}</ListItemText>
                </MenuItem>
              )}
              {isFile && onOpenAssociatedNativeApp && (
                <MenuItem onClick={handleOpenAssociatedNativeAppClick}>
                  <ListItemIcon>
                    <OpenInNewIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t("fileBrowser.row.openInNativeApp")}</ListItemText>
                </MenuItem>
              )}
              {isFile && onOpenNativePicker && (
                <MenuItem onClick={handleOpenNativePickerClick}>
                  <ListItemIcon>
                    <OpenInNewIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t("fileBrowser.row.chooseNativeApp")}</ListItemText>
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
    prev.useCompactLayout === next.useCompactLayout &&
    prev.isSelected === next.isSelected &&
    prev.isMultiSelected === next.isMultiSelected &&
    prev.file.name === next.file.name &&
    prev.file.modified_at === next.file.modified_at &&
    prev.file.size === next.file.size &&
    prev.file.link_kind === next.file.link_kind &&
    prev.file.link_target === next.file.link_target &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.viewMode === next.viewMode &&
    prev.onOpenAssociatedViewer === next.onOpenAssociatedViewer &&
    prev.onOpenViewerPicker === next.onOpenViewerPicker &&
    prev.onOpenAssociatedNativeApp === next.onOpenAssociatedNativeApp &&
    prev.onOpenNativePicker === next.onOpenNativePicker &&
    prev.onRename === next.onRename
);

FileRow.displayName = "FileRow";
