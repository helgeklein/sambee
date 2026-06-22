import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ViewerId } from "../../utils/FileTypeRegistry";
import { getViewerDefinitions } from "../../utils/FileTypeRegistry";

interface BrowserViewerPickerProps {
  open: boolean;
  fileName: string;
  viewerIds: ViewerId[];
  compatibleViewerIds: ViewerId[];
  preferredViewerId: ViewerId | null;
  showNativeOption: boolean;
  onClose: () => void;
  onConfirm: (selection: { viewerId: ViewerId | null; rememberSelection: boolean }) => void;
}

export function BrowserViewerPicker({
  open,
  fileName,
  viewerIds,
  compatibleViewerIds,
  preferredViewerId,
  showNativeOption,
  onClose,
  onConfirm,
}: BrowserViewerPickerProps) {
  const { t } = useTranslation();
  const viewerDefinitions = useMemo(() => getViewerDefinitions().filter((viewer) => viewerIds.includes(viewer.id)), [viewerIds]);
  const [selectedValue, setSelectedValue] = useState<string>(
    preferredViewerId ?? viewerDefinitions[0]?.id ?? (showNativeOption ? "native" : "")
  );
  const [rememberSelection, setRememberSelection] = useState(false);

  useEffect(() => {
    setSelectedValue(preferredViewerId ?? viewerDefinitions[0]?.id ?? (showNativeOption ? "native" : ""));
    setRememberSelection(false);
  }, [preferredViewerId, viewerDefinitions, showNativeOption]);

  const selectedViewerId = selectedValue === "native" ? null : (selectedValue as ViewerId);
  const canRememberSelection = selectedViewerId !== null && compatibleViewerIds.includes(selectedViewerId);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("fileBrowser.viewerPicker.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {fileName}
        </Typography>
        <List disablePadding>
          {viewerDefinitions.map((viewer) => (
            <ListItemButton key={viewer.id} selected={selectedValue === viewer.id} onClick={() => setSelectedValue(viewer.id)}>
              <ListItemIcon>
                <Radio edge="start" checked={selectedValue === viewer.id} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemIcon>
                <VisibilityIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t(viewer.translationKey)}
                secondary={
                  compatibleViewerIds.includes(viewer.id)
                    ? t("fileBrowser.viewerPicker.compatible")
                    : t("fileBrowser.viewerPicker.override")
                }
              />
            </ListItemButton>
          ))}
          {showNativeOption ? (
            <ListItemButton selected={selectedValue === "native"} onClick={() => setSelectedValue("native")}>
              <ListItemIcon>
                <Radio edge="start" checked={selectedValue === "native"} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemIcon>
                <OpenInNewIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t("fileBrowser.viewerPicker.openInNativeApp")}
                secondary={t("fileBrowser.viewerPicker.nativeDescription")}
              />
            </ListItemButton>
          ) : null}
        </List>
        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Checkbox
              checked={rememberSelection && canRememberSelection}
              onChange={(event) => setRememberSelection(event.target.checked)}
            />
          }
          disabled={!canRememberSelection}
          label={t("fileBrowser.viewerPicker.alwaysUse")}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => onConfirm({ viewerId: selectedViewerId, rememberSelection: rememberSelection && canRememberSelection })}
          disabled={!selectedValue}
        >
          {t("fileBrowser.viewerPicker.open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
