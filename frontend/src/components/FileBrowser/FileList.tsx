import { Box, Button, Typography } from "@mui/material";
import type { Virtualizer } from "@tanstack/react-virtual";
import React from "react";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { FileRow } from "./FileRow";

interface FileListProps {
  files: FileEntry[];
  focusedIndex: number;
  searchQuery: string;
  onClearSearch: () => void;
  onFileClick: (file: FileEntry, index?: number) => void;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  parentRef: React.RefObject<HTMLDivElement>;
  listContainerRef: (node: HTMLDivElement | null) => void;
  fileRowStyles: {
    iconBox: Record<string, unknown>;
    contentBox: Record<string, unknown>;
    buttonSelected: Record<string, unknown>;
    buttonNotSelected: Record<string, unknown>;
  };
  viewMode: ViewMode;
} //
// FileList
//
export const FileList = React.memo(
  ({
    files,
    focusedIndex,
    searchQuery,
    onClearSearch,
    onFileClick,
    rowVirtualizer,
    parentRef,
    listContainerRef,
    fileRowStyles,
    viewMode,
  }: FileListProps) => {
    const virtualItemsForRender = rowVirtualizer.getVirtualItems();

    return (
      <Box
        ref={listContainerRef}
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
        {files.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center", flex: 1 }}>
            <Typography color="text.secondary">{searchQuery ? `No files matching "${searchQuery}"` : "This directory is empty"}</Typography>
            {searchQuery && (
              <Button size="small" onClick={onClearSearch} sx={{ mt: 1 }}>
                Clear search
              </Button>
            )}
          </Box>
        ) : (
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
                    virtualStart={virtualItem.start}
                    virtualSize={virtualItem.size}
                    onClick={onFileClick}
                    fileRowStyles={fileRowStyles}
                    viewMode={viewMode}
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
