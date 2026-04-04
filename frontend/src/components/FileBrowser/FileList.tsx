import { Box, Typography } from "@mui/material";
import type { Virtualizer } from "@tanstack/react-virtual";
import React from "react";
import { useTranslation } from "react-i18next";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { FileRow } from "./FileRow";

interface FileListProps {
  files: FileEntry[];
  showEmptyState?: boolean;
  focusedIndex: number;
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry, index?: number) => void;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  parentRef: React.RefObject<HTMLDivElement>;
  listContainerRef: (node: HTMLDivElement | null) => void;
  fileRowStyles: {
    iconBox: Record<string, unknown>;
    contentBox: Record<string, unknown>;
    buttonSelected: Record<string, unknown>;
    buttonNotSelected: Record<string, unknown>;
    buttonMultiSelected: Record<string, unknown>;
    buttonFocusedMultiSelected: Record<string, unknown>;
  };
  viewMode: ViewMode;
  /** Called when "Open in app" is chosen from a file's context menu */
  onOpenInApp?: (file: FileEntry, index: number) => void;
  /** Called when "Rename" is chosen from the context menu */
  onRename?: (file: FileEntry, index: number) => void;
} //
// FileList
//
export const FileList = React.memo(
  ({
    files,
    showEmptyState = true,
    focusedIndex,
    selectedFiles,
    onFileClick,
    rowVirtualizer,
    parentRef,
    listContainerRef,
    fileRowStyles,
    viewMode,
    onOpenInApp,
    onRename,
  }: FileListProps) => {
    const { t } = useTranslation();
    const virtualItemsForRender = rowVirtualizer.getVirtualItems();

    return (
      <Box
        ref={listContainerRef}
        data-testid="file-list-container"
        tabIndex={0}
        sx={{
          flex: 1,
          minWidth: 300,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          "&:focus": {
            outline: "none",
          },
        }}
      >
        {files.length === 0 && showEmptyState ? (
          <Box sx={{ p: 4, textAlign: "center", flex: 1 }}>
            <Typography color="text.secondary">{t("fileBrowser.list.emptyDirectory")}</Typography>
          </Box>
        ) : files.length === 0 ? null : (
          <div
            ref={parentRef}
            data-testid="virtual-list"
            style={{
              flex: 1,
              overflow: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItemsForRender.map((virtualItem: ReturnType<typeof rowVirtualizer.getVirtualItems>[number]) => {
                const file = files[virtualItem.index];
                if (!file) return null;
                return (
                  <FileRow
                    ref={rowVirtualizer.measureElement}
                    key={virtualItem.key}
                    file={file}
                    index={virtualItem.index}
                    isSelected={virtualItem.index === focusedIndex}
                    isMultiSelected={selectedFiles.has(file.name)}
                    virtualStart={virtualItem.start}
                    virtualSize={virtualItem.size}
                    onClick={onFileClick}
                    fileRowStyles={fileRowStyles}
                    viewMode={viewMode}
                    onOpenInApp={onOpenInApp}
                    onRename={onRename}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Box>
    );
  }
);

FileList.displayName = "FileList";
