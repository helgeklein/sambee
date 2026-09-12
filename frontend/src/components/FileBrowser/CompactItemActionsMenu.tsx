import { Menu, MenuItem, Tooltip } from "@mui/material";

export interface CompactItemAction {
  id: string;
  label: string;
  tooltip?: string;
  enabled?: boolean;
  onClick: () => void;
}

interface CompactItemActionsMenuProps {
  actions: readonly CompactItemAction[];
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
}

export function CompactItemActionsMenu({ actions, anchorPosition, onClose }: CompactItemActionsMenuProps) {
  return (
    <Menu anchorReference="anchorPosition" anchorPosition={anchorPosition ?? undefined} open={anchorPosition !== null} onClose={onClose}>
      {actions.map((action) => (
        <Tooltip key={action.id} title={action.tooltip ?? ""} placement="left" disableHoverListener={!action.tooltip}>
          <span>
            <MenuItem
              disabled={action.enabled === false}
              onClick={() => {
                action.onClick();
                onClose();
              }}
            >
              {action.label}
            </MenuItem>
          </span>
        </Tooltip>
      ))}
    </Menu>
  );
}
