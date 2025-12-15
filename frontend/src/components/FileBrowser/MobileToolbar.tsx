import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import MenuIcon from "@mui/icons-material/Menu";
import { IconButton, Typography } from "@mui/material";

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
        aria-label="Open menu"
      >
        <MenuIcon />
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
        title="Navigate up"
        aria-label="Navigate to parent directory"
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
