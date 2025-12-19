import { useState } from "react";

/**
 * usePillButtonMenu
 *
 * Custom hook for managing menu state and focus behavior for pill button components.
 * Automatically blurs the button and calls onAfterClose when menu closes,
 * ensuring keyboard focus is properly transferred (e.g., to file list).
 */
export function usePillButtonMenu(onAfterClose?: () => void) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    const buttonEl = anchorEl;
    setAnchorEl(null);
    // Defer focus change to ensure menu closes first
    setTimeout(() => {
      if (buttonEl) {
        buttonEl.blur();
      }
      onAfterClose?.();
    }, 0);
  };

  return {
    anchorEl,
    open,
    handleClick,
    handleClose,
  };
}
