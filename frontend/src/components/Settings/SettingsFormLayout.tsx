import { Alert, type AlertColor, alpha, Box, type ReactNode, Tooltip } from "@mui/material";
import { forwardRef } from "react";
import { SettingsGroup } from "./SettingsGroup";

interface SettingsFormSectionProps {
  title: ReactNode;
}

interface DialogFieldFeedbackProps {
  message: string | null | undefined;
}

interface DialogFormNoticeProps {
  message: string | null;
  severity?: AlertColor;
  testId?: string;
}

interface DialogFormNoticeRegionProps {
  notices: readonly DialogFormNoticeProps[];
  testId?: string;
}

const dialogFeedbackMessageSx = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

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
