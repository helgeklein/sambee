//
// keyboardUtils
//

import type React from "react";

/**
 * Creates an onKeyDown handler that calls the callback when ESC is pressed.
 * Useful for moving focus from UI controls back to the file list.
 *
 * @param onEscape - Callback to invoke when ESC is pressed
 * @returns A keyboard event handler
 */
export function createEscapeHandler(onEscape?: () => void): (e: React.KeyboardEvent) => void {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    }
  };
}
