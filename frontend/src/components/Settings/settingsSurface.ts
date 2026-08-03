import type { Theme } from "@mui/material";
import { DIALOG_SURFACE_CSS_VARIABLE } from "../../theme/palette";

export function getSettingsPageSurfaceColor(theme: Theme): string {
  return `var(${DIALOG_SURFACE_CSS_VARIABLE}, ${theme.palette.background.default})`;
}
