//
// NameInputDialog
//

/**
 * Name Input Dialog
 * =================
 *
 * Shared modal dialog for entering a file or directory name.
 * Used as the base for both the Rename dialog and the Create Item dialog.
 *
 * Features:
 * - Text field with optional initial value and auto-select range
 * - Client-side validation via a pluggable validate function
 * - API error display via Alert
 * - Enter to submit, Escape to cancel
 * - Auto-focus on open and re-focus on new API errors
 */

import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ResponsiveFormDialog } from "../Admin/ResponsiveFormDialog";
import { SettingsFormGroup, SettingsFormRow, SettingsFormSurface, settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";
import { FILENAME_FIELD_PROPS, FILENAME_INPUT_PROPS, FILENAME_INPUT_SX } from "./filenameFieldProps";
import { NAME_DIALOG_STRINGS, validateItemName } from "./nameDialogStrings";

// ============================================================================
// Props
// ============================================================================

interface NameInputDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Dialog title (e.g. "Rename file", "New directory") */
  title: string;
  /** Optional description describing the pending operation. */
  description?: React.ReactNode;
  /** Label for the text field */
  inputLabel: string;
  /** Initial value for the text field (empty string for create) */
  initialValue: string;
  /** Label for the submit button (e.g. "Rename", "Create") */
  submitLabel: string;
  /** Label for the submit button while in progress (e.g. "Renaming…", "Creating…") */
  submittingLabel: string;
  /** Optional content that replaces the form during an active operation. */
  submittingContent?: React.ReactNode;
  /** Whether an operation is in progress */
  isSubmitting: boolean;
  /** Whether cancellation of an active operation is in progress. */
  isCancelling?: boolean;
  /** Called when the user cancels */
  onClose: () => void;
  /** Cancels an active operation while retaining the dialog until it settles. */
  onCancelSubmitting?: () => void;
  /** Optional active-operation cancellation label. */
  cancelSubmittingLabel?: string;
  /** Called when the user confirms with the validated name */
  onConfirm: (name: string) => void;
  /** Error message from the API */
  apiError?: string | null;
  /**
   * Custom validation function. Receives the trimmed name and returns
   * an error message string or null if valid. Called in addition to
   * the base validation (empty, invalid chars, etc.).
   */
  extraValidate?: (name: string) => string | null;
  /**
   * Optional auto-select range [start, end] applied after the dialog opens.
   * If not provided, the entire value is selected.
   */
  autoSelectRange?: [number, number];
}

// ============================================================================
// Component
// ============================================================================

const NameInputDialog: React.FC<NameInputDialogProps> = ({
  open,
  title,
  description,
  inputLabel,
  initialValue,
  submitLabel,
  submittingLabel,
  submittingContent,
  isSubmitting,
  isCancelling = false,
  onClose,
  onCancelSubmitting,
  cancelSubmittingLabel,
  onConfirm,
  apiError,
  extraValidate,
  autoSelectRange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset value when dialog opens with a new initial value
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setValidationError(null);
    }
  }, [open, initialValue]);

  // Auto-select text when the dialog opens
  const selectText = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (autoSelectRange) {
      input.setSelectionRange(autoSelectRange[0], autoSelectRange[1]);
    } else {
      input.setSelectionRange(0, input.value.length);
    }
  }, [autoSelectRange]);

  // Focus and select text immediately when dialog opens (no transition delay)
  useEffect(() => {
    if (open) {
      // Use rAF to ensure the DOM has rendered the dialog content
      const frame = requestAnimationFrame(() => selectText());
      return () => cancelAnimationFrame(frame);
    }
  }, [open, selectText]);

  // Re-focus and select when a *new* API error arrives
  const prevApiErrorRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    const isNewError = apiError && apiError !== prevApiErrorRef.current;
    prevApiErrorRef.current = apiError;
    if (isNewError && open) {
      selectText();
    }
  }, [apiError, open, selectText]);

  //
  // handleChange
  //
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      if (validationError) {
        setValidationError(null);
      }
    },
    [validationError]
  );

  //
  // handleSubmit
  //
  const handleSubmit = useCallback(() => {
    // Run base validation
    const baseError = validateItemName(value);
    if (baseError) {
      setValidationError(baseError);
      return;
    }

    // Run extra validation (e.g. "name unchanged" for rename)
    if (extraValidate) {
      const extraError = extraValidate(value);
      if (extraError) {
        setValidationError(extraError);
        return;
      }
    }

    onConfirm(value);
  }, [value, extraValidate, onConfirm]);

  //
  // handleKeyDown
  //
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isSubmitting) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [isSubmitting, handleSubmit]
  );

  const hasError = validationError !== null || (apiError != null && apiError !== "");
  const showApiError = apiError != null && apiError !== "" && !validationError;

  const formContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <SettingsFormSurface>
        <SettingsFormGroup>
          <SettingsFormRow sx={{ display: { md: "block" } }}>
            <TextField
              id="name-input-dialog-field"
              inputRef={inputRef}
              label={inputLabel}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              error={hasError}
              helperText={validationError ?? " "}
              variant="outlined"
              {...FILENAME_FIELD_PROPS}
              slotProps={{ htmlInput: FILENAME_INPUT_PROPS }}
              sx={[settingsFormOutlinedControlSx, FILENAME_INPUT_SX]}
            />
          </SettingsFormRow>
        </SettingsFormGroup>
      </SettingsFormSurface>
      <Alert
        aria-hidden={!showApiError}
        data-testid="name-input-api-error"
        severity="error"
        sx={{ visibility: showApiError ? "visible" : "hidden" }}
      >
        {apiError ?? " "}
      </Alert>
    </Box>
  );

  return (
    <ResponsiveFormDialog
      open={open}
      onClose={onClose}
      disableClose={isSubmitting}
      title={title}
      description={description}
      actions={
        isSubmitting && submittingContent ? (
          onCancelSubmitting ? (
            <Button onClick={onCancelSubmitting} disabled={isCancelling}>
              {cancelSubmittingLabel ?? NAME_DIALOG_STRINGS.BUTTON_CANCEL}
            </Button>
          ) : null
        ) : (
          <>
            {isSubmitting && onCancelSubmitting ? (
              <Button onClick={onCancelSubmitting} disabled={isCancelling}>
                {cancelSubmittingLabel ?? NAME_DIALOG_STRINGS.BUTTON_CANCEL}
              </Button>
            ) : (
              <Button onClick={onClose} disabled={isSubmitting}>
                {NAME_DIALOG_STRINGS.BUTTON_CANCEL}
              </Button>
            )}
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={isSubmitting || hasError}
              startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
            >
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          </>
        )
      }
      maxWidth="sm"
    >
      {isSubmitting && submittingContent ? submittingContent : formContent}
    </ResponsiveFormDialog>
  );
};

export default NameInputDialog;
