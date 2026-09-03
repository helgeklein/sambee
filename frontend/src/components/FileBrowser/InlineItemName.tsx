import { alpha, Box, type SxProps, type Theme } from "@mui/material";
import { forwardRef, type ReactNode } from "react";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";

export type InlineItemNameVariant = "prose" | "metadata";

interface InlineItemNameProps {
  children: ReactNode;
  testId?: string;
  title?: string;
  variant?: InlineItemNameVariant;
  sx?: SxProps<Theme>;
}

export const InlineItemName = forwardRef<HTMLElement, InlineItemNameProps>(function InlineItemName(
  { children, testId, title, variant, sx },
  ref
) {
  const variantSx =
    variant === "prose"
      ? { whiteSpace: "nowrap" }
      : variant === "metadata"
        ? { display: "block", maxWidth: "100%", whiteSpace: "nowrap" }
        : {};

  return (
    <Box
      component="code"
      data-testid={testId}
      ref={ref}
      title={title}
      sx={[
        {
          bgcolor: (theme) =>
            `var(${DIALOG_FORM_SURFACE_CSS_VARIABLE}, ${getModeAdjustedSurfaceColor(theme.palette.background.default, theme.palette.mode)})`,
          border: (theme) => `1px solid ${alpha(theme.palette.text.primary, 0.2)}`,
          borderRadius: 0.5,
          color: "text.primary",
          fontFamily: "monospace",
          fontSize: "0.875em",
          mx: 0.25,
          px: 0.5,
          py: 0.125,
        },
        variantSx,
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
});
