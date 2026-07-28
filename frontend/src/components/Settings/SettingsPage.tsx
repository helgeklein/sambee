import { Box, type SxProps, type Theme, useMediaQuery, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel, type SettingsCategory } from "./settingsNavigation";

interface SettingsPageProps {
  category: SettingsCategory;
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  dialogSafeHeader?: boolean;
  contentSx?: SxProps<Theme>;
}

/** Shared category frame so settings pages inherit consistent sizing and spacing. */
export function SettingsPage({ category, children, description, actions, dialogSafeHeader = false, contentSx }: SettingsPageProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const baseContentSx: SxProps<Theme> = {
    flex: 1,
    overflow: "auto",
    px: { xs: 2, sm: 3, md: 4 },
    pt: 1.5,
    pb: isMobile ? 2 : 3,
  };
  const resolvedContentSx: SxProps<Theme> = Array.isArray(contentSx)
    ? [baseContentSx, ...contentSx]
    : contentSx
      ? [baseContentSx, contentSx]
      : baseContentSx;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel(category)}
        description={description ?? getSettingsCategoryDescription(category)}
        actions={isMobile ? undefined : actions}
        dialogSafe={dialogSafeHeader}
        showTitle={!isMobile}
      />
      <Box sx={resolvedContentSx}>{children}</Box>
    </Box>
  );
}
