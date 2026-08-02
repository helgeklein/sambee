import { Box, type SxProps, type Theme, Typography, type TypographyProps } from "@mui/material";
import type { ReactNode } from "react";

export type SettingsSectionLevel = "section" | "subsection";
export type SettingsGroupContentSpacing = "normal" | "compact";
export type SettingsGroupActionLayout = "stacked" | "inline";

const SETTINGS_SECTION_TITLE_VARIANT: Record<SettingsSectionLevel, TypographyProps["variant"]> = {
  section: "h6",
  subsection: "subtitle1",
};
const SETTINGS_SECTION_TITLE_COMPONENT: Record<SettingsSectionLevel, "h2" | "h3"> = {
  section: "h2",
  subsection: "h3",
};
const SETTINGS_SECTION_TITLE_SX: SxProps<Theme> = {
  fontWeight: 500,
};
const SETTINGS_SECTION_CONTENT_GAP: Record<SettingsGroupContentSpacing, number> = {
  normal: 2,
  compact: 1,
};
const SETTINGS_SUBSECTION_CONTENT_GAP: Record<SettingsGroupContentSpacing, number> = {
  normal: 1.5,
  compact: 1,
};

interface SettingsGroupProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  level?: SettingsSectionLevel;
  contentSpacing?: SettingsGroupContentSpacing;
  actionsLayout?: SettingsGroupActionLayout;
  sx?: SxProps<Theme>;
  headerSx?: SxProps<Theme>;
  actionsSx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}

export function SettingsGroup({
  title,
  actions,
  children,
  level = "section",
  contentSpacing = "normal",
  actionsLayout = "stacked",
  sx,
  headerSx,
  actionsSx,
  contentSx,
}: SettingsGroupProps) {
  const resolvedSx: SxProps<Theme> = Array.isArray(sx)
    ? [{ display: "flex", flexDirection: "column" }, ...sx]
    : sx
      ? [{ display: "flex", flexDirection: "column" }, sx]
      : { display: "flex", flexDirection: "column" };
  const resolvedHeaderSx: SxProps<Theme> =
    actions && actionsLayout === "inline"
      ? [
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: level === "section" ? SETTINGS_SECTION_CONTENT_GAP[contentSpacing] : SETTINGS_SUBSECTION_CONTENT_GAP[contentSpacing],
          },
          ...(Array.isArray(headerSx) ? headerSx : headerSx ? [headerSx] : []),
        ]
      : (headerSx ?? {});

  return (
    <Box sx={resolvedSx}>
      {(title || actions) && (
        <Box sx={resolvedHeaderSx}>
          {title && (
            <Box
              sx={{
                minWidth: 0,
                mb: actions
                  ? actionsLayout === "inline"
                    ? 0
                    : 1.5
                  : level === "section"
                    ? SETTINGS_SECTION_CONTENT_GAP[contentSpacing]
                    : SETTINGS_SUBSECTION_CONTENT_GAP[contentSpacing],
              }}
            >
              <Typography
                component={SETTINGS_SECTION_TITLE_COMPONENT[level]}
                variant={SETTINGS_SECTION_TITLE_VARIANT[level]}
                sx={SETTINGS_SECTION_TITLE_SX}
              >
                {title}
              </Typography>
            </Box>
          )}
          {actions ? (
            <Box
              sx={[
                {
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  justifyContent: "flex-start",
                  alignItems: "center",
                  mb: actionsLayout === "inline" ? 0 : 2,
                },
                ...(Array.isArray(actionsSx) ? actionsSx : actionsSx ? [actionsSx] : []),
              ]}
            >
              {actions}
            </Box>
          ) : null}
        </Box>
      )}
      {children ? <Box sx={contentSx}>{children}</Box> : null}
    </Box>
  );
}
