import type { SxProps, Theme } from "@mui/material";
import { Box } from "@mui/material";
import logoSvg from "./sambee-logo.svg";

/**
 * Sambee logo icon component
 *
 * Displays the Sambee application logo by importing the actual SVG file.
 */
//
// SambeeLogo
//
interface SambeeLogoProps {
  sx?: SxProps<Theme>;
}

export const SambeeLogo = ({ sx }: SambeeLogoProps) => {
  return (
    <Box
      component="img"
      src={logoSvg}
      alt="Sambee"
      sx={{
        width: 24,
        height: 24,
        display: "inline-block",
        ...sx,
      }}
    />
  );
};
