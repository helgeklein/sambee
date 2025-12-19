//
// BreadcrumbsNavigation
//

import { Breadcrumbs, Link, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";

interface BreadcrumbsNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  connectionName: string;
}

/**
 * Truncate a directory name with ellipsis at the beginning if needed
 */
function truncateSegment(segment: string, maxChars: number): string {
  if (segment.length <= maxChars) {
    return segment;
  }
  return `…${segment.slice(-(maxChars - 1))}`;
}

/**
 * Calculate truncation based on priority:
 * - Try to show all segments fully
 * - If space is limited, truncate only ONE segment at a time
 * - Prioritize from right to left (current directory has highest priority)
 * - Only truncate earlier ancestors if necessary
 */
function calculateTruncation(pathParts: string[], availableWidth: number): string[] {
  if (pathParts.length === 0) return [];

  // Estimate character width (approximate)
  const charWidth = 8; // Average character width in pixels
  const rootWidth = 80; // Approximate width for "Root" with icon

  // Calculate available characters
  let availableChars = Math.floor((availableWidth - rootWidth) / charWidth);
  availableChars -= pathParts.length * 3; // Account for separators

  if (availableChars < 0) availableChars = 5 * pathParts.length; // Minimum

  // Total characters needed
  const totalChars = pathParts.reduce((sum, part) => sum + part.length, 0);

  // If everything fits, return as-is
  if (totalChars <= availableChars) {
    return pathParts;
  }

  // Strategy: Keep as many segments intact as possible, truncate only one
  const truncated = [...pathParts];
  const minChars = 5; // Minimum characters to show per segment

  // Try to fit by truncating only the leftmost (earliest ancestor) segment
  for (let truncateIndex = 0; truncateIndex < pathParts.length; truncateIndex++) {
    // Calculate space needed if we keep all others full
    let spaceNeeded = 0;
    for (let i = 0; i < pathParts.length; i++) {
      if (i === truncateIndex) {
        spaceNeeded += minChars; // Reserve minimum for truncated segment
      } else {
        const part = pathParts[i];
        if (part) {
          spaceNeeded += part.length; // Keep full
        }
      }
    }

    // If it fits with just this one segment truncated
    if (spaceNeeded <= availableChars) {
      const allowedChars = availableChars - (spaceNeeded - minChars);
      const partToTruncate = pathParts[truncateIndex];
      if (partToTruncate) {
        truncated[truncateIndex] = truncateSegment(partToTruncate, Math.max(minChars, allowedChars));
      }
      return truncated;
    }
  }

  // If we still can't fit, truncate multiple segments starting from left
  let remaining = availableChars;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (!part) continue;
    const budget = Math.max(minChars, Math.min(part.length, remaining));
    if (part.length > budget) {
      truncated[i] = truncateSegment(part, budget);
    }
    remaining -= budget;
    if (remaining <= 0) break;
  }

  return truncated;
}

/**
 * Breadcrumbs navigation component for file browser
 * Shows the current path with clickable segments to navigate back.
 * Intelligently truncates segments when space is limited, prioritizing
 * the current directory (highest), parent (second), etc.
 */
export function BreadcrumbsNavigation({ currentPath, onNavigate, connectionName }: BreadcrumbsNavigationProps) {
  const pathParts = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(800);

  // Measure available width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setAvailableWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Calculate truncated segments
  const displayParts = calculateTruncation(pathParts, availableWidth);

  const handleBreadcrumbClick = (index: number) => {
    const newPath = pathParts.slice(0, index + 1).join("/");
    onNavigate(newPath);
  };

  const handleRootClick = () => {
    onNavigate("");
  };

  return (
    <Breadcrumbs
      ref={containerRef}
      separator="/"
      sx={{
        flex: 1,
        minWidth: 0,
        "& .MuiBreadcrumbs-separator": {
          color: "text.secondary",
          display: "flex",
          alignItems: "center",
        },
        "& .MuiBreadcrumbs-ol": {
          flexWrap: "nowrap",
          overflow: "hidden",
          alignItems: "center",
        },
        "& .MuiBreadcrumbs-li": {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
        },
      }}
    >
      {pathParts.length === 0 ? (
        // Root is current directory - non-clickable
        <Typography variant="body1" color="text.primary" sx={{ fontWeight: "bold" }}>
          {connectionName}
        </Typography>
      ) : (
        // Root is clickable when in subdirectory
        <Link
          component="button"
          variant="body1"
          onClick={handleRootClick}
          sx={{ fontWeight: "regular" }}
          aria-label="Navigate to root directory"
        >
          {connectionName}
        </Link>
      )}
      {/* Show path segments with intelligent truncation */}
      {displayParts.map((part: string, index: number) => {
        const isLast = index === pathParts.length - 1;
        const fullPath = pathParts.slice(0, index + 1).join("/");
        const fullSegmentName = pathParts[index];

        if (isLast) {
          // Last segment is non-clickable
          return (
            <Typography
              key={fullPath}
              variant="body1"
              color="text.primary"
              title={fullSegmentName}
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: "bold",
              }}
            >
              {part}
            </Typography>
          );
        }
        return (
          <Link
            key={fullPath}
            component="button"
            variant="body1"
            onClick={() => handleBreadcrumbClick(index)}
            aria-label={`Navigate to ${fullSegmentName}`}
            title={fullSegmentName}
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: "regular",
            }}
          >
            {part}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
