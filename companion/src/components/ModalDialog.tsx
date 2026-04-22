import type { ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import "../styles/dialog.css";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

interface ModalDialogProps {
  children: ComponentChildren;
  titleId?: string;
  ariaLabel?: string;
  role?: "dialog" | "alertdialog";
  onRequestClose?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  panelClassName?: string;
  overlayClassName?: string;
  includeDefaultPanelClass?: boolean;
  includeDefaultOverlayClass?: boolean;
}

/**
 * Generic modal dialog wrapper with focus trapping, Escape handling,
 * and focus restoration when the dialog closes.
 */
export function ModalDialog({
  children,
  titleId,
  ariaLabel,
  role = "dialog",
  onRequestClose,
  initialFocusRef,
  panelRef,
  panelClassName,
  overlayClassName,
  includeDefaultPanelClass = true,
  includeDefaultOverlayClass = true,
}: ModalDialogProps) {
  const internalPanelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const setPanelElement = useCallback(
    (element: HTMLDivElement | null) => {
      internalPanelRef.current = element;
      if (panelRef) {
        panelRef.current = element;
      }
    },
    [panelRef]
  );

  const focusInitialElement = useCallback(() => {
    const preferredTarget = initialFocusRef?.current;
    const fallbackTarget = getFocusableElements(internalPanelRef.current)[0] ?? internalPanelRef.current;
    const target = preferredTarget ?? fallbackTarget;
    target?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const timer = window.setTimeout(() => {
      focusInitialElement();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      restoreFocusRef.current?.focus();
    };
  }, [focusInitialElement]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!internalPanelRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose?.();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(internalPanelRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        internalPanelRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === firstElement || !internalPanelRef.current.contains(activeElement)) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (!activeElement || activeElement === lastElement || !internalPanelRef.current.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onRequestClose]);

  const overlayClass = [includeDefaultOverlayClass ? "dialog-overlay" : "", overlayClassName ?? ""].filter(Boolean).join(" ");
  const panelClass = [includeDefaultPanelClass ? "dialog-panel" : "", panelClassName ?? ""].filter(Boolean).join(" ");

  const sharedDialogProps = {
    ref: setPanelElement,
    class: panelClass,
    "aria-modal": "true",
    "aria-labelledby": titleId,
    "aria-label": ariaLabel,
    tabIndex: -1,
  } as const;

  return (
    <div class={overlayClass || undefined} role="presentation">
      {role === "alertdialog" ? (
        <div {...sharedDialogProps} role="alertdialog">
          {children}
        </div>
      ) : (
        <div {...sharedDialogProps} role="dialog">
          {children}
        </div>
      )}
    </div>
  );
}
