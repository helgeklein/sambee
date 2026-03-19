import { Box, type SxProps, type Theme, Typography, type TypographyProps } from "@mui/material";
import type { ReactNode } from "react";

interface SettingsGroupProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  titleVariant?: TypographyProps["variant"];
  sx?: SxProps<Theme>;
  headerSx?: SxProps<Theme>;
  titleSx?: SxProps<Theme>;
  descriptionSx?: SxProps<Theme>;
  actionsSx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
  descriptionMaxWidth?: number | string;
}

export function SettingsGroup({
  title,
  description,
  actions,
  children,
  titleVariant = "h6",
  sx,
  headerSx,
  titleSx,
  descriptionSx,
  actionsSx,
  contentSx,
  descriptionMaxWidth = 720,
}: SettingsGroupProps) {
  const resolvedSx: SxProps<Theme> = Array.isArray(sx)
    ? [{ display: "flex", flexDirection: "column" }, ...sx]
    : sx
      ? [{ display: "flex", flexDirection: "column" }, sx]
      : { display: "flex", flexDirection: "column" };

  return (
    <Box sx={resolvedSx}>
      {(title || description || actions) && (
        <Box sx={headerSx}>
          {(title || description) && (
            <Box sx={{ minWidth: 0, mb: actions ? 1.5 : 2 }}>
              {title ? (
                <Typography variant={titleVariant} fontWeight="medium" sx={titleSx}>
                  {title}
                </Typography>
              ) : null}
              {description ? (
                <Typography
                  color="text.secondary"
                  sx={[
                    { mt: title ? 0.5 : 0, maxWidth: descriptionMaxWidth },
                    ...(Array.isArray(descriptionSx) ? descriptionSx : descriptionSx ? [descriptionSx] : []),
                  ]}
                  variant="body2"
                >
                  {description}
                </Typography>
              ) : null}
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
