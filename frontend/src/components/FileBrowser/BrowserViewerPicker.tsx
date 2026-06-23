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
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelectableListbox } from "../../hooks/useSelectableListbox";
import type { ViewerId } from "../../utils/FileTypeRegistry";
import { getViewerDefinitions } from "../../utils/FileTypeRegistry";

interface BrowserViewerPickerProps {
  open: boolean;
  fileName: string;
  viewerIds: ViewerId[];
  defaultViewerId: ViewerId | null;
  preferredViewerId: ViewerId | null;
  showNativeOption: boolean;
  onClose: () => void;
  onConfirm: (selection: { viewerId: ViewerId | null; rememberSelection: boolean }) => void;
}

export function BrowserViewerPicker({
  open,
  fileName,
  viewerIds,
  defaultViewerId,
  preferredViewerId,
  showNativeOption,
  onClose,
  onConfirm,
}: BrowserViewerPickerProps) {
  const { t } = useTranslation();
  const viewerDefinitions = useMemo(() => getViewerDefinitions().filter((viewer) => viewerIds.includes(viewer.id)), [viewerIds]);
  const viewerOptions = useMemo(
    () => [
      ...viewerDefinitions.map((viewer) => ({ value: viewer.id, viewer })),
      ...(showNativeOption ? [{ value: "native", viewer: null }] : []),
    ],
    [showNativeOption, viewerDefinitions]
  );
  const [selectedValue, setSelectedValue] = useState<string>(
    preferredViewerId ?? defaultViewerId ?? viewerDefinitions[0]?.id ?? (showNativeOption ? "native" : "")
  );
  const [rememberSelection, setRememberSelection] = useState(false);

  useEffect(() => {
    setSelectedValue(preferredViewerId ?? defaultViewerId ?? viewerDefinitions[0]?.id ?? (showNativeOption ? "native" : ""));
    setRememberSelection(preferredViewerId !== null);
  }, [defaultViewerId, preferredViewerId, viewerDefinitions, showNativeOption]);

  const selectedViewerId = selectedValue === "native" ? null : (selectedValue as ViewerId);
  const canRememberSelection = selectedViewerId !== null;
  const pickerOptionSx = {
    transition: "none",
    "& .MuiTouchRipple-root": {
      display: "none",
    },
    "& .MuiSvgIcon-root": {
      transition: "none",
    },
    "& .MuiRadioButtonIcon-root": {
      transition: "none",
    },
  };

  const handleConfirm = () => {
    if (!selectedValue) {
      return;
    }

    onConfirm({ viewerId: selectedViewerId, rememberSelection: rememberSelection && canRememberSelection });
  };

  const {
    listRef,
    focusList,
    onKeyDown: handleListKeyDown,
  } = useSelectableListbox({
    open,
    options: viewerOptions,
    selectedValue,
    onSelectValue: setSelectedValue,
    onConfirm: handleConfirm,
  });

  const handleDialogKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLButtonElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleConfirm();
  };

  return (
    <Dialog open={open} onClose={onClose} onKeyDown={handleDialogKeyDown} fullWidth maxWidth="sm" disableAutoFocus>
      <DialogTitle>{t("fileBrowser.viewerPicker.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {fileName}
        </Typography>
        <List
          ref={listRef}
          disablePadding
          role="listbox"
          tabIndex={0}
          autoFocus
          aria-activedescendant={selectedValue ? `browser-viewer-picker-option-${selectedValue}` : undefined}
          onKeyDown={handleListKeyDown}
          sx={{
            "&:focus": {
              outline: "none",
            },
          }}
        >
          {viewerDefinitions.map((viewer) => (
            <ListItemButton
              key={viewer.id}
              id={`browser-viewer-picker-option-${viewer.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={selectedValue === viewer.id}
              selected={selectedValue === viewer.id}
              disableRipple
              disableTouchRipple
              sx={pickerOptionSx}
              onClick={() => {
                setSelectedValue(viewer.id);
                focusList();
              }}
            >
              <ListItemIcon>
                <Radio edge="start" checked={selectedValue === viewer.id} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemIcon>
                <VisibilityIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t(viewer.translationKey)}
                secondary={viewer.id === defaultViewerId ? t("fileBrowser.viewerPicker.default") : undefined}
              />
            </ListItemButton>
          ))}
          {showNativeOption ? (
            <ListItemButton
              id="browser-viewer-picker-option-native"
              role="option"
              tabIndex={-1}
              aria-selected={selectedValue === "native"}
              selected={selectedValue === "native"}
              disableRipple
              disableTouchRipple
              sx={pickerOptionSx}
              onClick={() => {
                setSelectedValue("native");
                focusList();
              }}
            >
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
        <Button variant="contained" onClick={handleConfirm} disabled={!selectedValue}>
          {t("fileBrowser.viewerPicker.open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
