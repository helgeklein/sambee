/**
 * CompanionPairingDialog
 * ======================
 *
 * Modal dialog for the Bluetooth-style pairing flow between the
 * Sambee frontend and the companion desktop app.
 *
 * Shows a 6-character hex code that the user must verify matches
 * on both the browser and the companion's native dialog before
 * confirming.
 */

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import UsbIcon from "@mui/icons-material/Usb";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../services/logger";
import { dialogEnterKeyHandler } from "../../utils/keyboardUtils";
import { COMPANION_PAIRING_DIALOG_COPY } from "../Settings/localDrivesCopy";
import { NoTransition } from "./transitions";

// ── Types ────────────────────────────────────────────────────────────────────

type PairingStep = "idle" | "showing_code" | "confirming" | "success" | "error";

interface CompanionPairingDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Close the dialog. */
  onClose: () => void;
  /** Start the pairing flow; returns the code and pairing ID. */
  onInitiate: () => Promise<{ pairingId: string; pairingCode: string }>;
  /** Confirm pairing after user verifies the code. */
  onConfirm: (pairingId: string) => Promise<void>;
}

// ── Component ────────────────────────────────────────────────────────────────

const CompanionPairingDialog: React.FC<CompanionPairingDialogProps> = ({ open, onClose, onInitiate, onConfirm }) => {
  const [step, setStep] = useState<PairingStep>("idle");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingId, setPairingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  /** Reset state when closing or retrying. */
  const resetState = useCallback(() => {
    setStep("idle");
    setPairingCode("");
    setPairingId("");
    setErrorMessage("");
  }, []);

  /** Start the pairing handshake. */
  const handleStart = useCallback(async () => {
    setStep("showing_code");
    setErrorMessage("");
    try {
      const result = await onInitiate();
      setPairingCode(result.pairingCode);
      setPairingId(result.pairingId);
    } catch (err) {
      logger.error("Pairing initiation failed", { error: err }, "companion");
      setStep("error");
      setErrorMessage(COMPANION_PAIRING_DIALOG_COPY.initiateFailed);
    }
  }, [onInitiate]);

  /** User confirms the codes match. */
  const handleConfirm = useCallback(async () => {
    setStep("confirming");
    try {
      await onConfirm(pairingId);
      setStep("success");
    } catch (err) {
      logger.error("Pairing confirmation failed", { error: err }, "companion");
      setStep("error");
      setErrorMessage(COMPANION_PAIRING_DIALOG_COPY.confirmFailed);
    }
  }, [pairingId, onConfirm]);

  /** Handle dialog close — reset state. */
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleKeyDown = useMemo(() => {
    if (step === "showing_code" && pairingCode) {
      return dialogEnterKeyHandler(handleConfirm);
    }

    if (step === "idle" || step === "error") {
      return dialogEnterKeyHandler(handleStart);
    }

    if (step === "success") {
      return dialogEnterKeyHandler(handleClose);
    }

    return dialogEnterKeyHandler();
  }, [handleClose, handleConfirm, handleStart, pairingCode, step]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const buttonToFocus =
      step === "idle"
        ? startButtonRef.current
        : step === "showing_code" && pairingCode
          ? confirmButtonRef.current
          : step === "error"
            ? retryButtonRef.current
            : step === "success"
              ? doneButtonRef.current
              : null;

    if (!buttonToFocus) {
      return;
    }

    const frame = requestAnimationFrame(() => buttonToFocus.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, pairingCode, step]);

  return (
    <Dialog open={open} onClose={handleClose} onKeyDown={handleKeyDown} maxWidth="xs" fullWidth TransitionComponent={NoTransition}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <UsbIcon />
        {COMPANION_PAIRING_DIALOG_COPY.title}
      </DialogTitle>

      <DialogContent>
        {step === "idle" && <DialogContentText>{COMPANION_PAIRING_DIALOG_COPY.intro}</DialogContentText>}

        {step === "showing_code" && !pairingCode && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {step === "showing_code" && pairingCode && (
          <Box sx={{ textAlign: "center", py: 2 }}>
            <DialogContentText sx={{ mb: 2 }}>{COMPANION_PAIRING_DIALOG_COPY.verifyCodePrompt}</DialogContentText>
            <Typography
              variant="h3"
              component="div"
              sx={{
                fontFamily: "monospace",
                fontWeight: 700,
                letterSpacing: "0.3em",
                py: 2,
                px: 3,
                bgcolor: "action.hover",
                borderRadius: 2,
                display: "inline-block",
              }}
            >
              {pairingCode}
            </Typography>
            <DialogContentText sx={{ mt: 2, fontSize: "0.85rem", color: "text.secondary" }}>
              {COMPANION_PAIRING_DIALOG_COPY.verifyCodeHelp}
            </DialogContentText>
          </Box>
        )}

        {step === "confirming" && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3, gap: 2 }}>
            <CircularProgress size={32} />
            <DialogContentText>{COMPANION_PAIRING_DIALOG_COPY.confirming}</DialogContentText>
          </Box>
        )}

        {step === "success" && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3, gap: 1 }}>
            <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
            <DialogContentText>{COMPANION_PAIRING_DIALOG_COPY.success}</DialogContentText>
          </Box>
        )}

        {step === "error" && <DialogContentText color="error">{errorMessage}</DialogContentText>}
      </DialogContent>

      <DialogActions>
        {step === "idle" && (
          <>
            <Button onClick={handleClose}>{COMPANION_PAIRING_DIALOG_COPY.cancelButton}</Button>
            <Button ref={startButtonRef} onClick={handleStart} variant="contained">
              {COMPANION_PAIRING_DIALOG_COPY.startButton}
            </Button>
          </>
        )}

        {step === "showing_code" && pairingCode && (
          <>
            <Button onClick={handleClose}>{COMPANION_PAIRING_DIALOG_COPY.cancelButton}</Button>
            <Button ref={confirmButtonRef} onClick={handleConfirm} variant="contained">
              {COMPANION_PAIRING_DIALOG_COPY.confirmButton}
            </Button>
          </>
        )}

        {step === "confirming" && (
          <Button onClick={handleClose} disabled>
            {COMPANION_PAIRING_DIALOG_COPY.cancelButton}
          </Button>
        )}

        {step === "success" && (
          <Button ref={doneButtonRef} onClick={handleClose} variant="contained">
            {COMPANION_PAIRING_DIALOG_COPY.doneButton}
          </Button>
        )}

        {step === "error" && (
          <>
            <Button onClick={handleClose}>{COMPANION_PAIRING_DIALOG_COPY.closeButton}</Button>
            <Button ref={retryButtonRef} onClick={handleStart} variant="contained">
              {COMPANION_PAIRING_DIALOG_COPY.retryButton}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CompanionPairingDialog;
