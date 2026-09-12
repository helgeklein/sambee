import AddIcon from "@mui/icons-material/Add";
import { Fab, Menu, MenuItem, Tooltip } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileOperationAction } from "../../pages/FileBrowser/fileOperationActions";

interface CompactCreateMenuProps {
  actions: readonly FileOperationAction[];
}

export function CompactCreateMenu({ actions }: CompactCreateMenuProps) {
  const { t } = useTranslation();
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);

  if (actions.length === 0 || !actions.some((action) => action.enabled)) return null;

  return (
    <>
      <Tooltip title={t("fileBrowser.compactActions.createNewItem")}>
        <Fab
          aria-label={t("fileBrowser.compactActions.createNewItem")}
          aria-haspopup="menu"
          aria-expanded={anchorElement ? "true" : undefined}
          color="primary"
          onClick={(event) => setAnchorElement(event.currentTarget)}
          size="medium"
          sx={{ pointerEvents: "auto" }}
        >
          <AddIcon />
        </Fab>
      </Tooltip>
      <Menu anchorEl={anchorElement} open={Boolean(anchorElement)} onClose={() => setAnchorElement(null)}>
        {actions.map((action) => (
          <Tooltip key={action.id} title={action.tooltip} placement="left">
            <span>
              <MenuItem
                disabled={!action.enabled}
                onClick={() => {
                  action.onClick();
                  setAnchorElement(null);
                }}
              >
                {action.label}
              </MenuItem>
            </span>
          </Tooltip>
        ))}
      </Menu>
    </>
  );
}
