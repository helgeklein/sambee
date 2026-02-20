import { type RefObject, useEffect } from "react";

/**
 * CSS selector matching all elements that participate in the sequential
 * Tab order. Elements with tabindex="-1" are focusable via script but
 * are NOT part of the Tab cycle, so they must be excluded everywhere.
 */
const TABBABLE_ELEMENT_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

//
// getTabbableElements
//
/**
 * Returns all visible elements inside the given container that participate
 * in the sequential Tab order (i.e. tabbable elements).
 */
function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(TABBABLE_ELEMENT_SELECTOR);
  return Array.from(elements).filter((el) => el.offsetParent !== null);
}

//
// useFocusTrap
//
/**
 * Traps Tab / Shift+Tab focus within a container element, preventing
 * focus from escaping to the browser chrome (address bar, dev-tools, etc.).
 *
 * When the user reaches the last tabbable element and presses Tab,
 * focus wraps to the first element (and vice-versa for Shift+Tab).
 *
 * The trap correctly handles focus on non-tabbable elements
 * (tabindex="-1") that received focus via click or script by using
 * DOM position comparison rather than strict equality.
 *
 * The trap is only active while `document.activeElement` is inside the
 * container, so it does not interfere with MUI dialogs or other portaled
 * overlays that manage their own focus.
 *
 * @param containerRef - Ref to the root element whose descendants form the focus cycle.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      if (event.defaultPrevented) return;

      const container = containerRef.current;
      if (!container) return;

      const active = document.activeElement as HTMLElement | null;

      // Only act when focus is inside our container – don't interfere
      // with MUI modals or other portaled overlays.
      if (!active || !container.contains(active)) return;

      const tabbable = getTabbableElements(container);
      if (tabbable.length === 0) return;

      const first = tabbable[0] as HTMLElement;
      const last = tabbable[tabbable.length - 1] as HTMLElement;

      if (event.shiftKey) {
        // Shift+Tab: wrap if no tabbable element precedes active.
        // Uses compareDocumentPosition so that focus on a non-tabbable
        // child (e.g. a clicked button with tabindex=-1) is handled
        // correctly – if `first` does not precede `active`, there is
        // nothing before it in the Tab order.
        const firstPrecedesActive = active !== first && (active.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
        if (!firstPrecedesActive) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab: wrap if no tabbable element follows active.
        const lastFollowsActive = active !== last && (active.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        if (!lastFollowsActive) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef]);
}
