import { useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";

interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabled?: boolean;
}

/**
 * Hook to detect horizontal swipe gestures with natural physics-based animations
 * Uses @use-gesture/react for gesture detection and react-spring for smooth animations
 *
 * @param options Configuration for swipe detection
 * @param options.onSwipeLeft Callback when user swipes left (with sufficient velocity or distance)
 * @param options.onSwipeRight Callback when user swipes right (with sufficient velocity or distance)
 * @param options.enabled Whether gesture detection is enabled (default: true)
 * @returns Object containing animated style and gesture bind function
 */
export function useSwipeGesture({ onSwipeLeft, onSwipeRight, enabled = true }: SwipeGestureOptions) {
  const [{ x }, api] = useSpring(() => ({ x: 0 }));

  const bind = useDrag(
    ({ down, movement: [mx], velocity: [vx], direction: [dx], cancel }) => {
      // Only handle horizontal swipes (ignore if disabled)
      if (!enabled) return;

      // Check if swipe is fast enough or far enough
      const isSwipe = !down && (Math.abs(vx) > 0.5 || Math.abs(mx) > 80);

      if (isSwipe) {
        // Determine swipe direction based on velocity and distance
        if ((vx < -0.5 || (dx < 0 && mx < -80)) && onSwipeLeft) {
          // Swipe left (next image)
          onSwipeLeft();
          cancel?.();
        } else if ((vx > 0.5 || (dx > 0 && mx > 80)) && onSwipeRight) {
          // Swipe right (previous image)
          onSwipeRight();
          cancel?.();
        }
      }

      // Update position: while dragging, follow finger; when released, spring back
      api.start({
        x: down ? mx * 0.8 : 0, // 0.8 damping while dragging for resistance feel
        immediate: down, // No animation while dragging
        config: {
          tension: 300,
          friction: 30,
        },
      });
    },
    {
      axis: "x", // Only allow horizontal dragging
      pointer: { touch: true }, // Enable touch
      filterTaps: true, // Don't trigger on taps
      rubberband: true, // Bounce effect at edges
    }
  );

  return { bind, style: { x } };
}
