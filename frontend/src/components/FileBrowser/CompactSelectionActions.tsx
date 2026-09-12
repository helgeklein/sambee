import ClearIcon from "@mui/icons-material/Clear";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileOperationAction } from "../../pages/FileBrowser/fileOperationActions";

interface CompactSelectionActionsProps {
  actions: readonly FileOperationAction[];
  getActions?: () => readonly FileOperationAction[];
  selectedCount: number;
  onClearSelection: () => void;
}

export function CompactSelectionActions({ actions, getActions, selectedCount, onClearSelection }: CompactSelectionActionsProps) {
  const { t } = useTranslation();
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const [menuActions, setMenuActions] = useState<readonly FileOperationAction[]>([]);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pointerEvents: "auto" }}>
      <Typography aria-live="polite" aria-atomic="true" variant="body2" sx={{ whiteSpace: "nowrap" }}>
        {t("fileBrowser.compactActions.selectedCount", { count: selectedCount })}
      </Typography>
      <Tooltip title={t("fileBrowser.compactActions.clearSelection")}>
        <IconButton aria-label={t("fileBrowser.compactActions.clearSelection")} onClick={onClearSelection} sx={{ width: 44, height: 44 }}>
          <ClearIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={t("fileBrowser.compactActions.selectionActions")}>
        <IconButton
          aria-label={t("fileBrowser.compactActions.selectionActions")}
          aria-haspopup="menu"
          aria-expanded={anchorElement ? "true" : undefined}
          onClick={(event) => {
            setMenuActions(getActions?.() ?? actions);
            setAnchorElement(event.currentTarget);
          }}
          sx={{ width: 44, height: 44 }}
        >
          <MoreVertIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorElement} open={Boolean(anchorElement)} onClose={() => setAnchorElement(null)}>
        {menuActions.map((action) => (
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
    </Box>
  );
}
