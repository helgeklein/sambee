import { Box, type SxProps, type Theme, Typography, type TypographyProps } from "@mui/material";
import type { ReactNode } from "react";

interface SettingsGroupProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  titleVariant?: TypographyProps["variant"];
  sx?: SxProps<Theme>;
  headerSx?: SxProps<Theme>;
  titleSx?: SxProps<Theme>;
  actionsSx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}

export function SettingsGroup({
  title,
  actions,
  children,
  titleVariant = "h6",
  sx,
  headerSx,
  titleSx,
  actionsSx,
  contentSx,
}: SettingsGroupProps) {
  const resolvedSx: SxProps<Theme> = Array.isArray(sx)
    ? [{ display: "flex", flexDirection: "column" }, ...sx]
    : sx
      ? [{ display: "flex", flexDirection: "column" }, sx]
      : { display: "flex", flexDirection: "column" };

  return (
    <Box sx={resolvedSx}>
      {(title || actions) && (
        <Box sx={headerSx}>
          {title && (
            <Box sx={{ minWidth: 0, mb: actions ? 1.5 : 2 }}>
              <Typography variant={titleVariant} fontWeight="medium" sx={titleSx}>
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
                  mb: 2,
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
