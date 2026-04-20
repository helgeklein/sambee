//
// keyboardUtils
//

import type React from "react";

const DIALOG_BUTTON_ACTIVATION_KEYS = new Set(["Enter", " ", "Space", "Spacebar"]);

function getDialogButtonTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const button = target.closest("button");
  return button instanceof HTMLButtonElement ? button : null;
}

/**
 * Selector matching interactive elements (buttons, inputs, etc.) that
 * receive visible focus rings when tabbed to in a viewer toolbar.
 * Excludes tabindex="-1" because those are programmatically-focusable
 * containers (e.g. MUI Dialog) that do not show a visible focus ring.
 */
const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

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

//
// blurActiveToolbarControl
//
/**
 * If an interactive element (button, input, etc.) currently has focus,
 * removes focus from it by calling blur(). This hides the visible focus
 * ring without closing the viewer — useful as the first layer of a
 * context-aware Escape handler in viewers.
 *
 * @param contentRef - Optional ref to an element that should receive focus
 *                     instead of just blurring. If provided and the ref has
 *                     a current value, focus moves there.
 * @returns `true` if an interactive control was blurred, `false` otherwise.
 */
export function blurActiveToolbarControl(contentRef?: React.RefObject<HTMLElement | null>): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active?.matches(INTERACTIVE_ELEMENT_SELECTOR)) {
    return false;
  }

  // If the focused element is the content container itself, there is no
  // toolbar control to blur — the viewer body already has focus.
  if (contentRef?.current && active === contentRef.current) {
    return false;
  }

  if (contentRef?.current) {
    contentRef.current.focus();
  } else {
    active.blur();
  }
  return true;
}

/**
 * Handle button activation keys inside an MUI Dialog.
 *
 * MUI's modal focus-trap can prevent native keyboard activation on
 * `<button>` elements inside dialogs. This handler activates the focused
 * button programmatically for Enter and Space. When no button is focused
 * (e.g. a text field or checkbox has focus), the optional *fallback*
 * callback is invoked for Enter only.
 *
 * Usage – pass this as the Dialog's `onKeyDown`:
 *
 * ```tsx
 * <Dialog onKeyDown={dialogEnterKeyHandler(handleConfirm)}>
 * ```
 *
 * @param fallback - Optional callback invoked on Enter when no button
 *                   has focus (typically the dialog's primary action).
 * @returns A keyboard event handler suitable for `onKeyDown`.
 */
export function dialogEnterKeyHandler(fallback?: () => void): (e: React.KeyboardEvent) => void {
  return (e: React.KeyboardEvent) => {
    if (!DIALOG_BUTTON_ACTIVATION_KEYS.has(e.key)) {
      return;
    }

    const button = getDialogButtonTarget(e.target);
    if (button) {
      e.preventDefault();
      button.click();
      return;
    }

    if (e.key === "Enter" && fallback) {
      e.preventDefault();
      fallback();
    }
  };
}
