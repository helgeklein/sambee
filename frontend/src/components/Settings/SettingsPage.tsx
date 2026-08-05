import { Box, type SxProps, type Theme, useMediaQuery, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import { SettingsActionBar } from "./SettingsActionBar";
import { SettingsCategoryDescription } from "./SettingsCategoryDescription";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { getSettingsCategoryLabel, type SettingsCategory } from "./settingsNavigation";
import { getSettingsPageSurfaceColor } from "./settingsSurface";

interface SettingsPageProps {
  category: SettingsCategory;
  title?: string;
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footerPrimaryActions?: ReactNode;
  footerSecondaryActions?: ReactNode;
  dialogSafeHeader?: boolean;
  contentSx?: SxProps<Theme>;
}

/** Shared category frame so settings pages inherit consistent sizing and spacing. */
export function SettingsPage({
  category,
  title,
  children,
  description,
  actions,
  footerPrimaryActions,
  footerSecondaryActions,
  dialogSafeHeader = false,
  contentSx,
}: SettingsPageProps) {
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
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: getSettingsPageSurfaceColor, overflow: "hidden" }}>
      <SettingsSectionHeader
        title={title ?? getSettingsCategoryLabel(category)}
        description={description ?? <SettingsCategoryDescription category={category} />}
        actions={isMobile ? undefined : actions}
        dialogSafe={dialogSafeHeader}
        showTitle={!isMobile}
      />
      <Box data-testid="settings-page-content" tabIndex={-1} sx={resolvedContentSx}>
        {children}
      </Box>
      {(footerPrimaryActions || footerSecondaryActions) && (
        <SettingsActionBar primaryActions={footerPrimaryActions} secondaryActions={footerSecondaryActions} />
      )}
    </Box>
  );
}
