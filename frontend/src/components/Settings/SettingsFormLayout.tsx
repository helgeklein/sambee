import { Alert, alpha, Box, FormLabel, type SxProps, type Theme, Tooltip, Typography } from "@mui/material";
import { forwardRef, type ReactNode } from "react";
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

interface DialogFormNoticeProps {
  message: string | null | undefined;
  severity?: "error" | "warning";
  testId?: string;
}

interface DialogFormNoticeRegionProps {
  notices: readonly DialogFormNoticeProps[];
  testId?: string;
}

interface DialogFieldFeedbackProps {
  message: string | null | undefined;
}

const dialogFeedbackMessageSx = {
  display: "block",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const dialogFormHelperTextSx = {
  "&.MuiFormHelperText-root": {
    height: "1.25rem",
    lineHeight: "1.25rem",
    mb: 0,
    mt: 0.5,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
};

export const settingsFormFieldControlSx = {
  display: "flex",
  justifyContent: { md: "flex-end" },
  justifySelf: { md: "end" },
  width: "100%",
};
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

export function DialogFieldFeedback({ message }: DialogFieldFeedbackProps) {
  if (!message) {
    return <span aria-hidden="true">&nbsp;</span>;
  }

  return (
    <Tooltip title={message} disableFocusListener disableTouchListener>
      <Box component="span" aria-label={message} sx={dialogFeedbackMessageSx}>
        {message}
      </Box>
    </Tooltip>
  );
}

export const DialogFormNotice = forwardRef<HTMLDivElement, DialogFormNoticeProps>(function DialogFormNotice(
  { message, severity = "error", testId },
  ref
) {
  const isVisible = Boolean(message);
  const notice = (
    <Alert
      ref={ref}
      aria-hidden={!isVisible}
      data-testid={testId}
      severity={severity}
      sx={{
        alignItems: "center",
        minHeight: "2.5rem",
        visibility: isVisible ? "visible" : "hidden",
        "& .MuiAlert-message": dialogFeedbackMessageSx,
      }}
      tabIndex={isVisible ? -1 : undefined}
    >
      {message ?? " "}
    </Alert>
  );

  return isVisible ? (
    <Tooltip title={message} disableFocusListener disableTouchListener>
      {notice}
    </Tooltip>
  ) : (
    notice
  );
});

/** Reserves one notice line until multiple visible notices genuinely need more room. */
export function DialogFormNoticeRegion({ notices, testId }: DialogFormNoticeRegionProps) {
  const visibleNotices = notices.filter((notice) => Boolean(notice.message));

  if (visibleNotices.length === 0) {
    return (
      <Box data-testid={testId}>
        <DialogFormNotice message={null} />
      </Box>
    );
  }

  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {visibleNotices.map((notice) => (
        <DialogFormNotice key={`${notice.severity ?? "error"}\u0000${notice.message}`} {...notice} />
      ))}
    </Box>
  );
}
