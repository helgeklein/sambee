import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";

interface ArchiveExtractDialogProps {
  archiveName: string;
  initialDestinationName: string;
  open: boolean;
  isExtracting: boolean;
  isCancelling?: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (destinationPath: string) => void;
  onCancelExtraction?: () => void;
}

function validateDestinationPath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized) return "empty";
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return "unsafe";
  }
  return null;
}

export function ArchiveExtractDialog({
  archiveName,
  initialDestinationName,
  open,
  isExtracting,
  isCancelling = false,
  error,
  onClose,
  onConfirm,
  onCancelExtraction,
}: ArchiveExtractDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [destinationPath, setDestinationPath] = useState(initialDestinationName);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDestinationPath(initialDestinationName);
      setValidationError(null);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [initialDestinationName, open]);

  const handleConfirm = () => {
    const validation = validateDestinationPath(destinationPath);
    if (validation) {
      setValidationError(validation);
      return;
    }
    onConfirm(destinationPath.trim().replaceAll("\\", "/"));
  };

  const validationMessage =
    validationError === "empty"
      ? t("fileBrowser.archive.validationDestinationEmpty")
      : validationError === "unsafe"
        ? t("fileBrowser.archive.validationDestinationUnsafe")
        : " ";

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isExtracting}
      title={t("fileBrowser.archive.extractTitle")}
      description={t("fileBrowser.archive.extractPrompt", { archive: archiveName })}
      maxWidth="sm"
      contentSx={{ p: 2 }}
      actions={
        <>
          {isExtracting && onCancelExtraction ? (
            <Button onClick={onCancelExtraction} disabled={isCancelling}>
              {t("fileBrowser.archive.buttonCancelExtraction")}
            </Button>
          ) : (
            <Button onClick={onClose} disabled={isExtracting}>
              {t("common.actions.cancel")}
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={isExtracting}
            startIcon={isExtracting ? <CircularProgress size={16} /> : undefined}
          >
            {isExtracting ? t("fileBrowser.archive.buttonExtracting") : t("fileBrowser.archive.buttonExtract")}
          </Button>
        </>
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <SettingsFormSurface>
          <SettingsFormGroup>
            <SettingsFormRow sx={{ display: { md: "block" } }}>
              <TextField
                inputRef={inputRef}
                fullWidth
                label={t("fileBrowser.archive.destinationLabel")}
                value={destinationPath}
                onChange={(event) => {
                  setDestinationPath(event.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isExtracting) {
                    event.preventDefault();
                    handleConfirm();
                  }
                }}
                disabled={isExtracting}
                error={validationError !== null}
                helperText={validationMessage}
                sx={settingsFormOutlinedControlSx}
              />
            </SettingsFormRow>
          </SettingsFormGroup>
        </SettingsFormSurface>
      </Box>
    </ResponsiveFormDialog>
  );
}
