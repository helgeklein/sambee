import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type React from "react";
import { useMemo } from "react";
import { fileNamePillSx } from "../../theme/commonStyles";
import type { Connection } from "../../types";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  connection: Connection | null;
}

const DeleteDialog: React.FC<DeleteDialogProps> = ({ open, onClose, onConfirm, connection }) => {
  const handleKeyDown = useMemo(() => dialogEnterKeyHandler(), []);

  if (!connection) return null;

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
      <DialogTitle>Delete Connection</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>Are you sure you want to delete the connection</DialogContentText>
        <Box sx={{ ...fileNamePillSx, mt: 0.5 }}>{connection.name}</Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: "warning.main" }}>
          Cancel
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteDialog;
