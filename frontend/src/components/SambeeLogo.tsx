import type { SxProps, Theme } from "@mui/material";
import { Box, useTheme } from "@mui/material";
import logoSvg from "../../../images/icon/icon.svg";
import logoReversedSvg from "../../../images/icon/icon-reversed.svg";

/**
 * Sambee logo icon component
 *
 * Displays the Sambee application logo by importing the actual SVG file.
 * Uses icon-reversed.svg in light mode and icon.svg in dark mode.
 */
//
// SambeeLogo
//
interface SambeeLogoProps {
  sx?: SxProps<Theme>;
}

export const SambeeLogo = ({ sx }: SambeeLogoProps) => {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === "dark";

  return (
    <Box
      component="img"
      src={isDarkMode ? logoSvg : logoReversedSvg}
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
