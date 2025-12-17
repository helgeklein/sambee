import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type React from "react";
import type { Connection } from "../../types";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  connection: Connection | null;
}

const DeleteDialog: React.FC<DeleteDialogProps> = ({ open, onClose, onConfirm, connection }) => {
  if (!connection) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          bgcolor: "background.default",
        },
      }}
    >
      <DialogTitle>Delete Connection</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>
          Are you sure you want to delete the connection <strong>{connection.name}</strong>?
        </DialogContentText>
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
