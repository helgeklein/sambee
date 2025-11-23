import { useEffect } from "react";

/**
 * Keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** Key(s) that trigger the shortcut (can be array for multiple keys) */
  keys: string | string[];
  /** Description shown in tooltips and help */
  description: string;
  /** Display label for tooltip (e.g., "Ctrl+S") - auto-generated if not provided */
  label?: string;
  /** Handler function to execute */
  handler: () => void;
  /** Requires Ctrl/Cmd modifier key */
  ctrl?: boolean;
  /** Requires Shift modifier key */
  shift?: boolean;
  /** Requires Alt/Option modifier key */
  alt?: boolean;
  /** Allow when input field has focus (default: false) */
  allowInInput?: boolean;
  /** Custom condition to enable/disable shortcut */
  enabled?: boolean;
}

/**
 * Configuration for keyboard shortcut hook
 */
export interface UseKeyboardShortcutsConfig {
  /** Array of keyboard shortcuts */
  shortcuts: KeyboardShortcut[];
  /** Selector for input elements to check focus (default: 'input, textarea') */
  inputSelector?: string;
}

/**
 * Format key for display (capitalize, handle special keys)
 */
const formatKey = (key: string): string => {
  const specialKeys: Record<string, string> = {
    ArrowRight: "Right",
    ArrowLeft: "Left",
    ArrowUp: "Up",
    ArrowDown: "Down",
    PageDown: "Page Down",
    PageUp: "Page Up",
    Escape: "Esc",
  };

  return specialKeys[key] || key;
};

/**
 * Format shortcut for display in tooltips
 */
export const formatShortcut = (shortcut: KeyboardShortcut): string => {
  // Use provided label if available
  if (shortcut.label) return shortcut.label;

  const keys: string[] = [];

  if (shortcut.ctrl) {
    keys.push("Ctrl");
  }
  if (shortcut.shift) {
    keys.push("Shift");
  }
  if (shortcut.alt) {
    keys.push("Alt");
  }

  const mainKeys = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
  const formattedMainKeys = mainKeys.map(formatKey).join(" / ");
  keys.push(formattedMainKeys);

  return keys.join("+");
};

/**
 * Get tooltip text with keyboard shortcut
 * Accepts a partial shortcut definition (handler not required for tooltip display)
 */
export const withShortcut = (shortcut: Omit<KeyboardShortcut, "handler" | "enabled">): string => {
  return `${shortcut.description} (${formatShortcut(shortcut as KeyboardShortcut)})`;
};

/**
 * Custom hook for managing keyboard shortcuts
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     {
 *       id: 'save',
 *       keys: 's',
 *       description: 'Save',
 *       ctrl: true,
 *       handler: handleSave,
 *     },
 *     {
 *       id: 'next-page',
 *       keys: ['ArrowRight', 'd', 'D'],
 *       description: 'Next page',
 *       handler: handleNextPage,
 *       enabled: currentPage < totalPages,
 *     },
 *   ],
 * });
 * ```
 */
export const useKeyboardShortcuts = ({
  shortcuts,
  inputSelector = "input, textarea",
}: UseKeyboardShortcutsConfig): void => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // Check if any input element has focus
      const activeElement = document.activeElement;
      const inputHasFocus = activeElement?.matches(inputSelector) ?? false;

      // Find matching shortcut
      for (const shortcut of shortcuts) {
        // Skip if shortcut is disabled
        if (shortcut.enabled === false) continue;

        // Skip if input has focus and shortcut doesn't allow it
        if (inputHasFocus && !shortcut.allowInInput) continue;

        // Check modifier keys
        if (shortcut.ctrl && !(event.ctrlKey || event.metaKey)) continue;
        if (shortcut.shift && !event.shiftKey) continue;
        if (shortcut.alt && !event.altKey) continue;

        // Check if no modifiers should be pressed
        if (!shortcut.ctrl && (event.ctrlKey || event.metaKey)) continue;
        if (!shortcut.shift && event.shiftKey) continue;
        if (!shortcut.alt && event.altKey) continue;

        // Check if key matches
        const keys = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
        const keyMatches = keys.some((key) => event.key === key);

        if (keyMatches) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts, inputSelector]);
};
