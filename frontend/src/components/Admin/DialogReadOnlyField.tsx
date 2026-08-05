import type { SxProps, Theme } from "@mui/material";
import { TextField } from "@mui/material";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";
import { settingsFormOutlinedControlSx } from "../Settings/SettingsFormLayout";

interface DialogReadOnlyFieldProps {
  label?: string;
  ariaLabel?: string;
  value: string;
  multiline?: boolean;
  minRows?: number;
  maxRows?: number;
  codeBlock?: boolean;
  showFormSurface?: boolean;
  sx?: SxProps<Theme>;
}

/** Displays a selectable, optionally labelled value in a dialog without allowing edits. */
export function DialogReadOnlyField({
  label,
  ariaLabel,
  value,
  multiline = false,
  minRows,
  maxRows,
  codeBlock = false,
  showFormSurface = false,
  sx,
}: DialogReadOnlyFieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      multiline={multiline}
      minRows={minRows}
      maxRows={maxRows}
      variant="outlined"
      slotProps={{ htmlInput: { readOnly: true, "aria-label": ariaLabel, "aria-readonly": true, wrap: codeBlock ? "off" : undefined } }}
      sx={[
        settingsFormOutlinedControlSx,
        {
          "& .MuiOutlinedInput-root": {
            bgcolor: showFormSurface
              ? (theme) =>
                  `var(${DIALOG_FORM_SURFACE_CSS_VARIABLE}, ${getModeAdjustedSurfaceColor(theme.palette.background.default, theme.palette.mode)})`
              : "transparent",
            cursor: "default",
          },
          "& .MuiInputBase-input": {
            color: "text.primary",
            cursor: "text",
            ...(codeBlock
              ? {
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  lineHeight: 1.5,
                  overflow: "auto !important",
                  whiteSpace: "pre",
                }
              : {}),
          },
          "& .MuiInputLabel-root.MuiInputLabel-shrink": {
            bgcolor: showFormSurface ? undefined : "transparent",
          },
          "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "divider",
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
