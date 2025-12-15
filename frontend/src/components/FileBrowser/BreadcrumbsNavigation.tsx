//
// BreadcrumbsNavigation
//

import HomeIcon from "@mui/icons-material/Home";
import { Breadcrumbs, Link, Typography, useTheme } from "@mui/material";
import { getTextColor } from "../../theme";

interface BreadcrumbsNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

/**
 * Breadcrumbs navigation component for file browser
 * Shows the current path with clickable segments to navigate back
 */
export function BreadcrumbsNavigation({ currentPath, onNavigate }: BreadcrumbsNavigationProps) {
  const theme = useTheme();
  const pathParts = currentPath ? currentPath.split("/") : [];

  const handleBreadcrumbClick = (index: number) => {
    const newPath = pathParts.slice(0, index + 1).join("/");
    onNavigate(newPath);
  };

  const handleRootClick = () => {
    onNavigate("");
  };

  return (
    <Breadcrumbs
      separator="/"
      sx={{
        flex: 1,
        minWidth: 0,
        "& .MuiBreadcrumbs-ol": {
          flexWrap: "wrap",
        },
      }}
    >
      {pathParts.length === 0 ? (
        // Root is current directory - non-clickable
        <Typography variant="body1" color={getTextColor(theme)} sx={{ display: "flex", alignItems: "center" }}>
          <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
          Root
        </Typography>
      ) : (
        // Root is clickable when in subdirectory
        <Link
          component="button"
          variant="body1"
          onClick={handleRootClick}
          sx={{ display: "flex", alignItems: "center" }}
          aria-label="Navigate to root directory"
        >
          <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
          Root
        </Link>
      )}
      {/* Show all path segments */}
      {pathParts.map((part: string, index: number) => {
        const isLast = index === pathParts.length - 1;
        if (isLast) {
          // Last segment is non-clickable
          return (
            <Typography key={pathParts.slice(0, index + 1).join("/")} variant="body1" color={getTextColor(theme)}>
              {part}
            </Typography>
          );
        }
        return (
          <Link
            key={pathParts.slice(0, index + 1).join("/")}
            component="button"
            variant="body1"
            onClick={() => handleBreadcrumbClick(index)}
            aria-label={`Navigate to ${part}`}
          >
            {part}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
