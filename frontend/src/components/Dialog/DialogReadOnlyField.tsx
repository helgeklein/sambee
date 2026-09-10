import { type SxProps, TextField, type Theme } from "@mui/material";
import type { ChangeEventHandler, FocusEventHandler, ReactNode, Ref } from "react";
import { FORM_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";
import { formOutlinedControlSx } from "../Form/FormLayout";

interface DialogReadOnlyFieldProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  value: string;
  editable?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  inputRef?: Ref<HTMLInputElement>;
  error?: boolean;
  helperText?: ReactNode;
  autoFocus?: boolean;
  onFocus?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  size?: "small" | "medium";
  multiline?: boolean;
  minRows?: number;
  maxRows?: number;
  showFormSurface?: boolean;
  sx?: SxProps<Theme>;
}

const dialogFormHelperTextSx = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Displays a selectable, optionally labelled value in a dialog without allowing edits. */
export function DialogReadOnlyField({
  id,
  label,
  ariaLabel,
  ariaDescribedBy,
  value,
  editable = false,
  onChange,
  inputRef,
  error = false,
  helperText,
  autoFocus = false,
  onFocus,
  size,
  multiline = false,
  minRows,
  maxRows,
  showFormSurface = false,
  sx,
}: DialogReadOnlyFieldProps) {
  return (
    <TextField
      id={id}
      label={label}
      hiddenLabel={!label}
      value={value}
      onChange={editable ? onChange : undefined}
      error={error}
      helperText={helperText}
      autoFocus={autoFocus}
      onFocus={onFocus}
      size={size}
      fullWidth
      multiline={multiline}
      minRows={minRows}
      maxRows={maxRows}
      variant="outlined"
      slotProps={{
        htmlInput: {
          ref: inputRef,
          readOnly: !editable,
          "aria-label": ariaLabel,
          "aria-describedby": ariaDescribedBy,
          "aria-readonly": !editable,
        },
        formHelperText: { sx: dialogFormHelperTextSx },
      }}
      sx={[
        formOutlinedControlSx,
        {
          "& .MuiOutlinedInput-root": {
            bgcolor: showFormSurface
              ? (theme) =>
                  `var(${FORM_SURFACE_CSS_VARIABLE}, ${getModeAdjustedSurfaceColor(theme.palette.background.default, theme.palette.mode)})`
              : "transparent",
            cursor: "default",
          },
          "& .MuiInputBase-input": { color: "text.primary", cursor: "text" },
          "& .MuiInputLabel-root.MuiInputLabel-shrink": { bgcolor: showFormSurface ? undefined : "transparent" },
          "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
