import { Box, Button, Menu, MenuItem, Tooltip } from "@mui/material";
import React, { useLayoutEffect, useRef, useState } from "react";
import type { FileOperationAction } from "../../pages/FileBrowser/fileOperationActions";
import { fileOperationsToolbarButtonSx, fileOperationsToolbarSx } from "../../theme/commonStyles";

const BUTTON_GAP_PX = 8;

interface FileOperationsToolbarProps {
  actions: readonly FileOperationAction[];
  moreLabel: string;
}

function CommandButton({ action }: { action: FileOperationAction }) {
  return (
    <Tooltip title={action.tooltip}>
      <span>
        <Button disabled={!action.enabled} onClick={action.onClick} sx={fileOperationsToolbarButtonSx}>
          {action.label}
        </Button>
      </span>
    </Tooltip>
  );
}

export function FileOperationsToolbar({ actions, moreLabel }: FileOperationsToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const measurements = measurementRef.current;
    if (!toolbar || !measurements) return;

    const updateVisibleCount = () => {
      const availableWidth = toolbar.getBoundingClientRect().width;
      const actionWidths = actions.map(
        (action) => measurements.querySelector<HTMLElement>(`[data-operation-id="${action.id}"]`)?.getBoundingClientRect().width ?? 0
      );
      const moreWidth = measurements.querySelector<HTMLElement>("[data-more-button]")?.getBoundingClientRect().width ?? 0;

      if (availableWidth <= 0 || actionWidths.some((width) => width <= 0) || moreWidth <= 0) {
        setVisibleCount(actions.length);
        return;
      }

      const allActionsWidth = actionWidths.reduce((total, width) => total + width, 0) + BUTTON_GAP_PX * Math.max(0, actions.length - 1);
      if (allActionsWidth <= availableWidth) {
        setVisibleCount(actions.length);
        return;
      }

      let usedWidth = moreWidth;
      let nextVisibleCount = 0;
      for (const width of actionWidths) {
        const nextWidth = usedWidth + BUTTON_GAP_PX + width;
        if (nextWidth > availableWidth) break;
        usedWidth = nextWidth;
        nextVisibleCount += 1;
      }
      setVisibleCount(nextVisibleCount);
    };

    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [actions]);

  const visibleActions = actions.slice(0, visibleCount);
  const overflowActions = actions.slice(visibleCount);

  React.useEffect(() => {
    if (overflowActions.length === 0) {
      setMoreAnchor(null);
    }
  }, [overflowActions.length]);

  return (
    <Box sx={fileOperationsToolbarSx}>
      <Box
        ref={toolbarRef}
        data-testid="file-operations-toolbar"
        sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden" }}
      >
        {visibleActions.map((action) => (
          <CommandButton key={action.id} action={action} />
        ))}
        {overflowActions.length > 0 && (
          <Button
            aria-haspopup="menu"
            aria-expanded={moreAnchor ? "true" : undefined}
            onClick={(event) => setMoreAnchor(event.currentTarget)}
            sx={fileOperationsToolbarButtonSx}
          >
            {moreLabel}
          </Button>
        )}
      </Box>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        {overflowActions.map((action) => (
          <Tooltip key={action.id} title={action.tooltip} placement="right">
            <span>
              <MenuItem
                disabled={!action.enabled}
                onClick={() => {
                  action.onClick();
                  setMoreAnchor(null);
                }}
              >
                {action.label}
              </MenuItem>
            </span>
          </Tooltip>
        ))}
      </Menu>

      <Box
        ref={measurementRef}
        aria-hidden="true"
        sx={{ position: "fixed", top: 0, left: 0, visibility: "hidden", display: "flex", gap: 1, pointerEvents: "none" }}
      >
        {actions.map((action) => (
          <Button key={action.id} data-operation-id={action.id} sx={fileOperationsToolbarButtonSx}>
            {action.label}
          </Button>
        ))}
        <Button data-more-button sx={fileOperationsToolbarButtonSx}>
          {moreLabel}
        </Button>
      </Box>
    </Box>
  );
}
