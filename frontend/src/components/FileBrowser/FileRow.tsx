//
// FileRow
//

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ShortcutIcon from "@mui/icons-material/Shortcut";
import { Box, IconButton, Typography } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatFileSize } from "../../pages/FileBrowser/formatters";
import type { ViewMode } from "../../pages/FileBrowser/types";
import { COMPACT_LAYOUT_SIZE } from "../../theme/constants";
import type { FileEntry } from "../../types";
import { isShortcutFile } from "../../utils/fileEntries";
import { getFileIcon } from "../../utils/fileIcons";
import { abbreviatePath } from "../../utils/pathDisplay";
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
  showCompactActions?: boolean;
  onOpenItemActions?: (file: FileEntry, index: number, anchorElement: HTMLElement) => void;
}

export const shortenTargetPath = abbreviatePath;

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
      <Typography variant="body2" component="span" noWrap sx={{ ...rowTextSx, color: "text.secondary", flex: "0 0 auto", mx: 1 }}>
        {"\u2192"}
      </Typography>
      <Typography
        ref={labelRef}
        variant="body2"
        component="span"
        noWrap
        title={path}
        sx={{ ...rowTextSx, color: "text.secondary", flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
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
        showCompactActions = false,
        onOpenItemActions,
      },
      ref
    ) => {
      const { t } = useTranslation();
      const isListMode = viewMode === "list";
      const linkTarget = file.link_target?.target;
      const isShortcut = isShortcutFile(file);
      const isUnavailableArchiveEntry = file.archive_entry_state !== undefined && !file.is_readable;
      const rowTextSx = useCompactLayout ? { fontSize: `${COMPACT_LAYOUT_SIZE.FILE_ROW_TEXT_PX}px` } : undefined;
      const fileIconSize = useCompactLayout ? COMPACT_LAYOUT_SIZE.FILE_ROW_ICON_PX : 24;
      const canOpenItemActions = showCompactActions && !isUnavailableArchiveEntry && onOpenItemActions !== undefined;
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

      const fileName = (
        <Box sx={{ display: "flex", minWidth: 0, width: "100%" }}>
          <Typography
            variant="body2"
            component="span"
            noWrap
            title={file.name}
            sx={{ ...rowTextSx, color: "text.primary", flex: linkTargetPath ? "0 1 auto" : 1, minWidth: 0 }}
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
            disabled={isUnavailableArchiveEntry}
            sx={[rowStyle, canOpenItemActions ? { pr: 7 } : {}, isUnavailableArchiveEntry ? { cursor: "not-allowed", opacity: 0.5 } : {}]}
            dataSelected={isSelected ? "true" : undefined}
            ariaLabel={ariaLabel}
          >
            {/* Icon: show checkmark when multi-selected, file icon otherwise */}
            {(() => {
              const icon = (() => {
                if (isMultiSelected) {
                  return <CheckCircleIcon sx={{ fontSize: fileIconSize, color: "primary.main" }} />;
                }

                if (isShortcut) {
                  return <ShortcutIcon sx={{ fontSize: fileIconSize, color: "text.secondary" }} />;
                }

                return getFileIcon({
                  filename: file.name,
                  isDirectory: file.type === "directory",
                  size: fileIconSize,
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
                    gridTemplateColumns: `${fileIconSize}px 1fr auto auto`,
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
          {canOpenItemActions ? (
            <IconButton
              aria-label={t("fileBrowser.compactActions.moreActionsFor", { name: file.name })}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                onOpenItemActions(file, index, event.currentTarget);
              }}
              sx={{ position: "absolute", top: "50%", right: 8, width: 44, height: 44, transform: "translateY(-50%)" }}
            >
              <MoreVertIcon />
            </IconButton>
          ) : null}
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
    prev.file.is_readable === next.file.is_readable &&
    prev.file.archive_entry_state === next.file.archive_entry_state &&
    prev.file.link_kind === next.file.link_kind &&
    prev.file.link_target === next.file.link_target &&
    prev.virtualStart === next.virtualStart &&
    prev.virtualSize === next.virtualSize &&
    prev.viewMode === next.viewMode &&
    prev.showCompactActions === next.showCompactActions &&
    prev.onOpenItemActions === next.onOpenItemActions
);

FileRow.displayName = "FileRow";
