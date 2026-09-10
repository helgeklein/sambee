import { Alert, Box } from "@mui/material";
import type { ReactNode } from "react";

export interface DialogNoticeProps {
  message: ReactNode | null | undefined;
  severity?: "error" | "warning";
  role?: "alert" | "status";
  testId?: string;
}

export function DialogNotice({ message, severity = "error", role, testId }: DialogNoticeProps) {
  if (!message) {
    return null;
  }

  return (
    <Alert data-testid={testId} severity={severity} role={role ?? (severity === "warning" ? "status" : undefined)}>
      {message}
    </Alert>
  );
}

interface DialogNoticeRegionProps {
  notices: readonly DialogNoticeProps[];
  testId?: string;
}

export function DialogNoticeRegion({ notices, testId }: DialogNoticeRegionProps) {
  const visibleNotices = notices.filter((notice) => Boolean(notice.message));

  if (visibleNotices.length === 0) {
    return null;
  }

  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {visibleNotices.map((notice) => (
        <DialogNotice key={`${notice.severity ?? "error"}\u0000${String(notice.message)}`} {...notice} />
      ))}
    </Box>
  );
}
