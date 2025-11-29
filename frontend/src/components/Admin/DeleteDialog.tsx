import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from "@mui/material";
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
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Connection</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete the connection <strong>"{connection.name}"</strong>?
        </DialogContentText>
        <Typography variant="body2" color="error" sx={{ mt: 2 }}>
          This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color="error" variant="contained">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteDialog;
