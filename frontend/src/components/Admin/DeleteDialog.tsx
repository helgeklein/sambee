import { Button, CircularProgress } from "@mui/material";
import type React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { settingsDestructiveButtonSx, settingsPrimaryButtonSx, settingsUtilityButtonSx } from "../Settings/settingsButtonStyles";
import { DialogReadOnlyField } from "./DialogReadOnlyField";
import { ResponsiveFormDialog } from "./ResponsiveFormDialog";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemName?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "destructive" | "primary";
  submitting?: boolean;
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
  confirmTone = "destructive",
  submitting = false,
}) => {
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("common.actions.delete");
  const resolvedCancelLabel = cancelLabel ?? t("common.actions.cancel");
  const confirmButtonSx = confirmTone === "primary" ? settingsPrimaryButtonSx : settingsDestructiveButtonSx;
  const handleClose = () => onClose();

  const actions = (
    <>
      <Button onClick={handleClose} disabled={submitting} variant="outlined" sx={settingsUtilityButtonSx}>
        {resolvedCancelLabel}
      </Button>
      <Button
        onClick={onConfirm}
        disabled={submitting}
        variant="contained"
        sx={confirmButtonSx}
        startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
      >
        {resolvedConfirmLabel}
      </Button>
    </>
  );

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={handleClose}
      disableClose={submitting}
      onKeyDown={handleKeyDown}
      title={title}
      description={description}
      actions={actions}
      maxWidth="xs"
    >
      {itemName ? <DialogReadOnlyField label={t("common.labels.itemToDelete")} value={itemName} sx={{ mt: 0.5 }} /> : null}
    </ResponsiveFormDialog>
  );
};

export default DeleteDialog;
