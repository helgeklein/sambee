import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fileNamePillSx } from "../../theme/commonStyles";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemName?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
}

const DeleteDialog: React.FC<DeleteDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  confirmLabel,
  cancelLabel,
}) => {
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("common.actions.delete");
  const resolvedCancelLabel = cancelLabel ?? t("common.actions.cancel");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>{description}</DialogContentText>
        {itemName && <Box sx={{ ...fileNamePillSx, mt: 0.5 }}>{itemName}</Box>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: "warning.main" }}>
          {resolvedCancelLabel}
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained">
          {resolvedConfirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteDialog;
