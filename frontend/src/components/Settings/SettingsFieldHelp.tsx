import { FormHelperText, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

interface SettingsFieldHelpProps {
  children: ReactNode;
  sx?: SxProps<Theme>;
}

/** Use below settings controls when their explanation is not provided by TextField. */
export function SettingsFieldHelp({ children, sx }: SettingsFieldHelpProps) {
  return <FormHelperText sx={sx}>{children}</FormHelperText>;
}
