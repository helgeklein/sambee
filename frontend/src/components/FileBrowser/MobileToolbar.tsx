import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { IconButton, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { SambeeLogo } from "../SambeeLogo";

interface MobileToolbarProps {
  currentDirectoryName: string;
  onOpenMenu: () => void;
  onNavigateUp: () => void;
  canNavigateUp: boolean;
}

//
// MobileToolbar
//
export function MobileToolbar({ currentDirectoryName, onOpenMenu, onNavigateUp, canNavigateUp }: MobileToolbarProps) {
  const { t } = useTranslation();

  return (
    <>
      <IconButton
        color="inherit"
        edge="start"
        onClick={onOpenMenu}
        sx={{
          mr: 1,
          minWidth: 44,
          minHeight: 44,
        }}
        aria-label={t("fileBrowser.chrome.mobileToolbar.openMenu")}
      >
        <SambeeLogo />
      </IconButton>

      <Typography
        variant="body1"
        component="div"
        sx={{
          flexGrow: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: "bold",
        }}
      >
        {currentDirectoryName}
      </Typography>

      <IconButton
        color="inherit"
        onClick={onNavigateUp}
        disabled={!canNavigateUp}
        title={t("fileBrowser.chrome.mobileToolbar.navigateUpTitle")}
        aria-label={t("fileBrowser.chrome.mobileToolbar.navigateUpAriaLabel")}
        sx={{
          minWidth: 44,
          minHeight: 44,
        }}
      >
        <ArrowUpwardIcon />
      </IconButton>
    </>
  );
}
