import { alpha, Box, FormLabel, type SxProps, type Theme, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { getControlAccentColor } from "../../theme/commonStyles";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, DIALOG_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";
import { SettingsGroup } from "./SettingsGroup";

interface SettingsFormContainerProps {
  children: ReactNode;
  sx?: SxProps<Theme>;
  testId?: string;
}

interface SettingsFormFieldLabelProps {
  label: string;
  description: string;
  descriptionId: string;
  htmlFor?: string;
  required?: boolean;
  id?: string;
  hasError?: boolean;
}

interface SettingsFormSectionProps {
  title: ReactNode;
}

export const settingsFormFieldControlSx = { justifySelf: { md: "end" }, width: "100%" };
export const settingsFormSelectControlSx = { justifySelf: { md: "end" }, width: { md: "fit-content" } };
export const settingsSelectSx: SxProps<Theme> = {
  "& .MuiSelect-select, & .MuiSelect-icon": {
    color: "text.primary",
  },
};
export const settingsSelectMenuProps = {
  sx: {
    "& .MuiMenuItem-root": {
      color: "text.primary",
    },
  },
};
export const settingsFormOutlinedControlSx = {
  "& .MuiOutlinedInput-root": {
    bgcolor: (theme: Theme) => `var(${DIALOG_SURFACE_CSS_VARIABLE}, ${theme.palette.background.default})`,
  },
  '& input[type="date"], & input[type="datetime-local"], & input[type="month"], & input[type="time"], & input[type="week"]': {
    colorScheme: (theme: Theme) => theme.palette.mode,
  },
  "& .MuiInputLabel-root.MuiInputLabel-shrink": {
    bgcolor: (theme: Theme) => `var(${DIALOG_SURFACE_CSS_VARIABLE}, ${theme.palette.background.default})`,
    px: 0.5,
    ml: -0.5,
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: (theme: Theme) => alpha(theme.palette.text.primary, 0.2),
  },
  "&:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: (theme: Theme) => alpha(theme.palette.text.primary, 0.35),
  },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: (theme: Theme) => getControlAccentColor(theme),
    borderWidth: 2,
  },
  "& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline": {
    borderColor: "error.main",
    borderWidth: 2,
  },
};

export function SettingsFormSurface({ children, sx, testId }: SettingsFormContainerProps) {
  return (
    <Box
      data-testid={testId}
      sx={[
        (theme) => ({
          display: "flex",
          flexDirection: "column",
          gap: 0,
          mt: { md: 1 },
          p: 2,
          bgcolor: `var(${DIALOG_FORM_SURFACE_CSS_VARIABLE}, ${getModeAdjustedSurfaceColor(theme.palette.background.default, theme.palette.mode)})`,
          borderRadius: 1,
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}

export function SettingsFormGroup({ children, sx, testId }: SettingsFormContainerProps) {
  return (
    <Box
      data-testid={testId}
      sx={[
        (theme) => ({
          display: "flex",
          flexDirection: "column",
          gap: 0,
          [theme.breakpoints.up("md")]: {
            "& > :not(:last-child)": {
              borderBottom: `1px solid ${alpha(theme.palette.text.primary, 0.2)}`,
            },
          },
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}

export function SettingsFormRow({ children, sx }: Omit<SettingsFormContainerProps, "testId">) {
  return (
    <Box
      sx={[
        {
          display: { md: "grid" },
          gridTemplateColumns: { md: "minmax(0, 1fr) minmax(0, 1fr)" },
          columnGap: { md: 2 },
          py: { xs: 1, md: 2 },
          alignItems: "start",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}

export function SettingsFormFieldLabel({
  label,
  description,
  descriptionId,
  htmlFor,
  required = false,
  id,
  hasError = false,
}: SettingsFormFieldLabelProps) {
  return (
    <Box>
      <FormLabel id={id} htmlFor={htmlFor} required={required} sx={{ textAlign: "left" }}>
        {label}
      </FormLabel>
      <Typography
        id={descriptionId}
        variant="caption"
        component="p"
        sx={{
          mt: 0,
          color: (theme) => (hasError ? theme.palette.error.main : theme.palette.text.secondary),
        }}
      >
        {description}
      </Typography>
    </Box>
  );
}

export function SettingsFormSection({ title }: SettingsFormSectionProps) {
  return (
    <SettingsGroup
      title={title}
      headerSx={{
        borderTop: (theme) => `1px solid ${alpha(theme.palette.text.primary, 0.2)}`,
        pt: 2,
      }}
      titleSx={{ mb: 0 }}
    />
  );
}
