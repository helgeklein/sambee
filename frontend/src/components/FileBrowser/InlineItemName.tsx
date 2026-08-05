import { alpha, Box } from "@mui/material";
import type { ReactNode } from "react";
import { DIALOG_FORM_SURFACE_CSS_VARIABLE, getModeAdjustedSurfaceColor } from "../../theme/palette";

interface InlineItemNameProps {
  children: ReactNode;
  testId?: string;
}

export function InlineItemName({ children, testId }: InlineItemNameProps) {
  return (
    <Box
      component="code"
      data-testid={testId}
      sx={{
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
      }}
    >
      {children}
    </Box>
  );
}
