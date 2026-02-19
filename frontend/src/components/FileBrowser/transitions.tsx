//
// transitions
//

/**
 * Shared transition helpers for FileBrowser dialogs.
 *
 * The keyboard-triggered dialogs (rename, create, delete) use
 * `NoTransition` so they appear instantly and accept input
 * without any animation delay.
 */

import type { TransitionProps } from "@mui/material/transitions";
import React from "react";

/**
 * A no-op transition component for MUI Dialog.
 *
 * Renders children immediately when `in` is true, with no
 * animation. This eliminates the default ~225 ms Fade that
 * otherwise delays focus and keyboard input.
 */
export const NoTransition = React.forwardRef<HTMLDivElement, TransitionProps & { children: React.ReactElement }>(
  (
    {
      children,
      in: show,
      onEnter,
      onExited,
      // Destructure transition-specific props so they don't leak to the DOM
      appear: _appear,
      enter: _enter,
      exit: _exit,
      timeout: _timeout,
      mountOnEnter: _mountOnEnter,
      unmountOnExit: _unmountOnExit,
      addEndListener: _addEndListener,
      onEntering: _onEntering,
      onEntered: _onEntered,
      onExit: _onExit,
      onExiting: _onExiting,
      ...rest
    },
    ref
  ) => {
    // Notify MUI that the transition has "entered" / "exited"
    // synchronously so backdrop and focus-trap work correctly.
    React.useEffect(() => {
      if (show) {
        onEnter?.(document.createElement("div"), false);
      } else {
        onExited?.(document.createElement("div"));
      }
    }, [show, onEnter, onExited]);

    if (!show) return null;

    return React.cloneElement(children, { ref, ...rest });
  }
);

NoTransition.displayName = "NoTransition";
