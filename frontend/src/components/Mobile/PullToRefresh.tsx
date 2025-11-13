import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, Typography } from "@mui/material";
import { animated, useSpring } from "@react-spring/web";
import { forwardRef } from "react";

interface PullToRefreshProps {
  /**
   * Pull distance in pixels (0 when not pulling)
   */
  pullDistance: number;
  /**
   * Whether refresh is currently in progress
   */
  isRefreshing: boolean;
  /**
   * Threshold distance to trigger refresh (typically 80-100px)
   */
  threshold?: number;
}

/**
 * Pull-to-refresh indicator component for mobile
 *
 * Shows animated refresh icon and text based on pull distance.
 * Appears at top of scrollable content during pull gesture.
 */
const PullToRefresh = forwardRef<HTMLDivElement, PullToRefreshProps>(
  ({ pullDistance, isRefreshing, threshold = 80 }, ref) => {
    const progress = Math.min(pullDistance / threshold, 1);
    const isPastThreshold = pullDistance >= threshold;

    // Smooth spring animation for pull indicator
    const springProps = useSpring({
      height: isRefreshing ? 60 : Math.max(0, pullDistance),
      opacity: isRefreshing || pullDistance > 10 ? 1 : 0,
      config: { tension: 300, friction: 30 },
    });

    // Rotation animation for icon
    const iconRotation = useSpring({
      transform: isRefreshing ? "rotate(360deg)" : `rotate(${progress * 180}deg)`,
      config: isRefreshing ? { duration: 1000, loop: true } : { tension: 300, friction: 30 },
    });

    return (
      <animated.div
        ref={ref}
        style={{
          ...springProps,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.5,
          }}
        >
          <animated.div style={iconRotation}>
            <RefreshIcon
              sx={{
                fontSize: 32,
                color: isPastThreshold || isRefreshing ? "primary.main" : "action.disabled",
              }}
            />
          </animated.div>
          <Typography
            variant="caption"
            sx={{
              color: isPastThreshold || isRefreshing ? "primary.main" : "text.secondary",
              fontWeight: isPastThreshold || isRefreshing ? "bold" : "normal",
            }}
          >
            {isRefreshing
              ? "Refreshing..."
              : isPastThreshold
                ? "Release to refresh"
                : "Pull to refresh"}
          </Typography>
        </Box>
      </animated.div>
    );
  }
);

PullToRefresh.displayName = "PullToRefresh";

export default PullToRefresh;
