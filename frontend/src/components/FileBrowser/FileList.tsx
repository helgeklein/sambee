import { Box, Typography } from "@mui/material";
import type { Virtualizer } from "@tanstack/react-virtual";
import React, { type ReactNode, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileOperationAction } from "../../pages/FileBrowser/fileOperationActions";
import type { ViewMode } from "../../pages/FileBrowser/types";
import type { FileEntry } from "../../types";
import { type CompactItemAction, CompactItemActionsMenu } from "./CompactItemActionsMenu";
import { COMPACT_SELECTION_DOCK_HEIGHT_PX } from "./CompactSelectionActions";
import { FileRow } from "./FileRow";

type CompactOverlayLayout = "dock" | "floating";

interface FileListProps {
  files: FileEntry[];
  showEmptyState?: boolean;
  useCompactLayout?: boolean;
  compactOverlay?: ReactNode;
  compactOverlayLayout?: CompactOverlayLayout;
  focusedIndex: number;
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry, index?: number) => void;
  onToggleItemSelection?: (file: FileEntry, index: number) => void;
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
  onOpenAssociatedViewer?: (file: FileEntry, index: number) => void;
  onOpenViewerPicker?: (file: FileEntry, index: number) => void;
  canOpenInBrowserViewer?: (file: FileEntry) => boolean;
  onOpenAssociatedNativeApp?: (file: FileEntry, index: number) => void;
  onOpenNativePicker?: (file: FileEntry, index: number) => void;
  getCompactItemActions?: (file: FileEntry, index: number) => readonly FileOperationAction[];
  onSelectItem?: (file: FileEntry, index: number) => void;
} //
// FileList
//
export const FileList = React.memo(
  ({
    files,
    showEmptyState = true,
    useCompactLayout = false,
    compactOverlay,
    compactOverlayLayout = "floating",
    focusedIndex,
    selectedFiles,
    onFileClick,
    onToggleItemSelection,
    rowVirtualizer,
    parentRef,
    listContainerRef,
    fileRowStyles,
    viewMode,
    onOpenAssociatedViewer,
    onOpenViewerPicker,
    canOpenInBrowserViewer,
    onOpenAssociatedNativeApp,
    onOpenNativePicker,
    getCompactItemActions,
    onSelectItem,
  }: FileListProps) => {
    const { t } = useTranslation();
    const listElementRef = useRef<HTMLDivElement>(null);
    const [itemMenu, setItemMenu] = useState<{
      actions: CompactItemAction[];
      anchorPosition: { top: number; left: number };
      triggerElement: HTMLElement;
    } | null>(null);
    const virtualItemsForRender = rowVirtualizer.getVirtualItems();

    const closeItemMenu = useCallback(() => {
      const triggerElement = itemMenu?.triggerElement;
      setItemMenu(null);
      if (triggerElement?.isConnected) {
        triggerElement.focus();
      } else {
        listElementRef.current?.focus({ preventScroll: true });
      }
    }, [itemMenu]);

    const openItemActions = useCallback(
      (file: FileEntry, index: number, anchorElement: HTMLElement) => {
        const isFile = file.type !== "directory" && file.link_target?.target?.type !== "directory";
        const browserViewerAllowed = isFile && (canOpenInBrowserViewer?.(file) ?? true);
        const actions: CompactItemAction[] = [
          {
            id: selectedFiles.has(file.path) ? "deselect" : "select",
            label: selectedFiles.has(file.path) ? t("fileBrowser.compactActions.deselect") : t("fileBrowser.compactActions.select"),
            onClick: () => {
              if (selectedFiles.has(file.path)) {
                onToggleItemSelection?.(file, index);
              } else {
                onSelectItem?.(file, index);
              }
            },
          },
        ];
        if (browserViewerAllowed && onOpenAssociatedViewer) {
          actions.push({
            id: "open-associated-viewer",
            label: t("fileBrowser.row.openInBrowserViewer"),
            onClick: () => onOpenAssociatedViewer(file, index),
          });
        }
        if (browserViewerAllowed && onOpenViewerPicker) {
          actions.push({
            id: "open-viewer-picker",
            label: t("fileBrowser.row.chooseBrowserViewer"),
            onClick: () => onOpenViewerPicker(file, index),
          });
        }
        if (isFile && onOpenAssociatedNativeApp) {
          actions.push({
            id: "open-associated-native-app",
            label: t("fileBrowser.row.openInNativeApp"),
            onClick: () => onOpenAssociatedNativeApp(file, index),
          });
        }
        if (isFile && onOpenNativePicker) {
          actions.push({
            id: "open-native-picker",
            label: t("fileBrowser.row.chooseNativeApp"),
            onClick: () => onOpenNativePicker(file, index),
          });
        }
        actions.push(...(getCompactItemActions?.(file, index) ?? []));

        const anchorBounds = anchorElement.getBoundingClientRect();
        setItemMenu({
          actions,
          anchorPosition: { top: anchorBounds.bottom, left: anchorBounds.right },
          triggerElement: anchorElement,
        });
      },
      [
        canOpenInBrowserViewer,
        getCompactItemActions,
        onOpenAssociatedNativeApp,
        onOpenAssociatedViewer,
        onOpenNativePicker,
        onOpenViewerPicker,
        onSelectItem,
        onToggleItemSelection,
        selectedFiles,
        t,
      ]
    );

    return (
      <Box
        ref={(node) => {
          listElementRef.current = node;
          listContainerRef(node);
        }}
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
            <Typography sx={{ color: "text.secondary" }}>{t("fileBrowser.list.emptyDirectory")}</Typography>
          </Box>
        ) : files.length === 0 ? null : (
          <div
            ref={parentRef}
            data-testid="virtual-list"
            style={{
              flex: 1,
              overflow: "auto",
              paddingBottom: compactOverlay
                ? compactOverlayLayout === "dock"
                  ? `calc(${COMPACT_SELECTION_DOCK_HEIGHT_PX}px + env(safe-area-inset-bottom))`
                  : "calc(56px + 16px + env(safe-area-inset-bottom))"
                : undefined,
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
                    key={virtualItem.key}
                    file={file}
                    useCompactLayout={useCompactLayout}
                    index={virtualItem.index}
                    isSelected={virtualItem.index === focusedIndex}
                    isMultiSelected={selectedFiles.has(file.path)}
                    selectionMode={useCompactLayout && selectedFiles.size > 0}
                    virtualStart={virtualItem.start}
                    virtualSize={virtualItem.size}
                    onClick={useCompactLayout && selectedFiles.size > 0 && onToggleItemSelection ? onToggleItemSelection : onFileClick}
                    fileRowStyles={fileRowStyles}
                    viewMode={viewMode}
                    showCompactActions={useCompactLayout}
                    onOpenItemActions={openItemActions}
                    onLongPressSelect={useCompactLayout ? onSelectItem : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
        {compactOverlay ? (
          <Box
            sx={{
              position: "absolute",
              ...(compactOverlayLayout === "dock"
                ? { left: 0, right: 0, bottom: 0 }
                : { right: 16, bottom: "max(16px, env(safe-area-inset-bottom))" }),
              pointerEvents: "none",
            }}
          >
            {compactOverlay}
          </Box>
        ) : null}
        <CompactItemActionsMenu
          actions={itemMenu?.actions ?? []}
          anchorPosition={itemMenu?.anchorPosition ?? null}
          onClose={closeItemMenu}
        />
      </Box>
    );
  }
);

FileList.displayName = "FileList";
