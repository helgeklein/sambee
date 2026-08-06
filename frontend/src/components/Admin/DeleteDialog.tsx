import DeleteIcon from "@mui/icons-material/Delete";
import { Box, Button, CircularProgress } from "@mui/material";
import type React from "react";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { settingsDestructiveButtonSx, settingsPrimaryButtonSx, settingsUtilityButtonSx } from "../Settings/settingsButtonStyles";
import { adminDialogActionButtonSx, adminDialogEndActionRowSx } from "./dialogActionStyles";
import { ResponsiveFormDialog } from "./ResponsiveFormDialog";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  descriptionItemName?: string | null;
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
  descriptionItemName,
  confirmLabel,
  cancelLabel,
  confirmTone = "destructive",
  submitting = false,
}) => {
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("common.actions.delete");
  const resolvedCancelLabel = cancelLabel ?? t("common.actions.cancel");
  const confirmButtonSx = confirmTone === "primary" ? settingsPrimaryButtonSx : settingsDestructiveButtonSx;
  const handleClose = () => onClose();
  const descriptionWithItemName = descriptionItemName ? (
    <>
      {description.endsWith("?") ? description.slice(0, -1) : description}{" "}
      <Box component="strong" sx={{ fontWeight: 600 }}>
        {descriptionItemName}
      </Box>
      {description.endsWith("?") ? "?" : null}
    </>
  ) : (
    description
  );

  const actions = (
    <Box sx={adminDialogEndActionRowSx}>
      <Button
        ref={cancelButtonRef}
        onClick={handleClose}
        disabled={submitting}
        variant="outlined"
        sx={[settingsUtilityButtonSx, adminDialogActionButtonSx]}
      >
        {resolvedCancelLabel}
      </Button>
      <Button
        onClick={onConfirm}
        disabled={submitting}
        variant="contained"
        color={confirmTone === "destructive" ? "error" : "primary"}
        sx={[confirmButtonSx, adminDialogActionButtonSx]}
        startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : confirmTone === "destructive" ? <DeleteIcon /> : undefined}
      >
        {resolvedConfirmLabel}
      </Button>
    </Box>
  );

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={handleClose}
      disableClose={submitting}
      onKeyDown={handleKeyDown}
      title={title}
      description={descriptionWithItemName}
      actions={actions}
      maxWidth="xs"
      disableAutoFocus
      onTransitionEntered={() => cancelButtonRef.current?.focus()}
    >
      {null}
    </ResponsiveFormDialog>
  );
};

export default DeleteDialog;
