import type { Theme } from "@mui/material";
import { OVERLAY_SURFACE_CSS_VARIABLE } from "../../theme/palette";

export function getSettingsPageSurfaceColor(theme: Theme): string {
  return `var(${OVERLAY_SURFACE_CSS_VARIABLE}, ${theme.palette.background.default})`;
}
