import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardShortcut } from "../useKeyboardShortcuts";
import { formatShortcut, useKeyboardShortcuts, withShortcut } from "../useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  let mockHandler: (event?: KeyboardEvent) => void;

  beforeEach(() => {
    mockHandler = vi.fn();
    vi.clearAllMocks();
  });

  // Helper to simulate keyboard events
  const simulateKeyPress = (
    key: string,
    modifiers?: {
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      metaKey?: boolean;
    }
  ) => {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: modifiers?.ctrlKey ?? false,
      shiftKey: modifiers?.shiftKey ?? false,
      altKey: modifiers?.altKey ?? false,
      metaKey: modifiers?.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  };

  describe("Basic Functionality", () => {
    it("should trigger handler on matching key press", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test shortcut",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should support multiple keys for same action", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "nav",
          keys: ["a", "b", "ArrowRight"],
          description: "Navigate",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));

      simulateKeyPress("a");
      expect(mockHandler).toHaveBeenCalledTimes(1);

      simulateKeyPress("b");
      expect(mockHandler).toHaveBeenCalledTimes(2);

      simulateKeyPress("ArrowRight");
      expect(mockHandler).toHaveBeenCalledTimes(3);
    });

    it("should pass KeyboardEvent to handler", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      const _event = simulateKeyPress("a");

      expect(mockHandler).toHaveBeenCalledWith(expect.any(KeyboardEvent));
      expect((mockHandler as ReturnType<typeof vi.fn>).mock.calls[0][0].key).toBe("a");
    });

    it("should not trigger handler when disabled", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
          enabled: false,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a");

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should trigger handler when enabled is true", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
          enabled: true,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Modifier Keys", () => {
    it("should handle Ctrl+Key on Windows/Linux", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "save",
          keys: "s",
          description: "Save",
          ctrl: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("s", { ctrlKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle Cmd+Key on macOS", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "save",
          keys: "s",
          description: "Save",
          ctrl: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("s", { metaKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle Shift+Key", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "rotate",
          keys: "R",
          description: "Rotate left",
          shift: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("R", { shiftKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle Alt+Key", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "menu",
          keys: "F",
          description: "File menu",
          alt: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("F", { altKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple modifiers (Ctrl+Shift+Key)", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "redo",
          keys: "z",
          description: "Redo",
          ctrl: true,
          shift: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("z", { ctrlKey: true, shiftKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should not trigger without required modifier", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "save",
          keys: "s",
          description: "Save",
          ctrl: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("s");

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should not trigger with extra unexpected modifier", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a", { ctrlKey: true });

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe("Input Focus Handling", () => {
    let input: HTMLInputElement;

    beforeEach(() => {
      input = document.createElement("input");
      document.body.appendChild(input);
    });

    afterEach(() => {
      document.body.removeChild(input);
    });

    it("should block shortcut when input has focus by default", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      input.focus();
      simulateKeyPress("a");

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should allow shortcut with allowInInput: true", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "Escape",
          description: "Close",
          allowInInput: true,
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      input.focus();
      simulateKeyPress("Escape");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should work when input loses focus", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      input.focus();
      input.blur();
      simulateKeyPress("a");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should respect custom input selector", () => {
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);

      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts,
          inputSelector: "textarea",
        })
      );

      // Should work in input (not matched by selector)
      input.focus();
      simulateKeyPress("a");
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Should be blocked in textarea (matched by selector)
      textarea.focus();
      simulateKeyPress("a");
      expect(mockHandler).toHaveBeenCalledTimes(1); // Still 1, not called again

      document.body.removeChild(textarea);
    });
  });

  describe("Priority System", () => {
    it("should execute higher priority shortcut first", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const shortcuts: KeyboardShortcut[] = [
        {
          id: "low",
          keys: "a",
          description: "Low priority",
          priority: 1,
          handler: handler1,
        },
        {
          id: "high",
          keys: "a",
          description: "High priority",
          priority: 10,
          handler: handler2,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a");

      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler1).not.toHaveBeenCalled();
    });

    it("should use registration order when priorities are equal", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const shortcuts: KeyboardShortcut[] = [
        {
          id: "first",
          keys: "a",
          description: "First",
          handler: handler1,
        },
        {
          id: "second",
          keys: "a",
          description: "Second",
          handler: handler2,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("a");

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe("Event Handling", () => {
    it("should call preventDefault on match", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));

      const event = new KeyboardEvent("keydown", {
        key: "a",
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should skip if event.defaultPrevented", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));

      const event = new KeyboardEvent("keydown", {
        key: "a",
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault(); // Prevent before dispatching
      window.dispatchEvent(event);

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe("International Keyboard Support", () => {
    it("should ignore shift for printable characters (German keyboard)", () => {
      // On German keyboard, "/" requires Shift+7
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "search",
          keys: "/",
          description: "Focus search",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("/", { shiftKey: true });

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should respect shift for non-printable keys", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "nav",
          keys: "ArrowRight",
          description: "Navigate",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("ArrowRight", { shiftKey: true });

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should respect shift for multi-character keys", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "home",
          keys: "Home",
          description: "Go to first",
          handler: mockHandler,
        },
      ];

      renderHook(() => useKeyboardShortcuts({ shortcuts }));
      simulateKeyPress("Home", { shiftKey: true });

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe("Dynamic Updates", () => {
    it("should update when shortcuts change", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const shortcuts1: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test 1",
          handler: handler1,
        },
      ];

      const shortcuts2: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test 2",
          handler: handler2,
        },
      ];

      const { rerender } = renderHook(({ shortcuts }) => useKeyboardShortcuts({ shortcuts }), {
        initialProps: { shortcuts: shortcuts1 },
      });

      simulateKeyPress("a");
      expect(handler1).toHaveBeenCalledTimes(1);

      rerender({ shortcuts: shortcuts2 });
      simulateKeyPress("a");
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should update when enabled state changes", () => {
      let enabled = true;

      const { rerender } = renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              id: "test",
              keys: "a",
              description: "Test",
              handler: mockHandler,
              enabled,
            },
          ],
        })
      );

      simulateKeyPress("a");
      expect(mockHandler).toHaveBeenCalledTimes(1);

      enabled = false;
      rerender();
      simulateKeyPress("a");
      expect(mockHandler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it("should cleanup event listeners on unmount", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

      const shortcuts: KeyboardShortcut[] = [
        {
          id: "test",
          keys: "a",
          description: "Test",
          handler: mockHandler,
        },
      ];

      const { unmount } = renderHook(() => useKeyboardShortcuts({ shortcuts }));

      expect(addEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });
});

describe("formatShortcut", () => {
  it("should format single key", () => {
    const shortcut: KeyboardShortcut = {
      id: "test",
      keys: "a",
      description: "Test",
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("a");
  });

  it("should format array of keys with slash separator", () => {
    const shortcut: KeyboardShortcut = {
      id: "test",
      keys: ["a", "b"],
      description: "Test",
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("a / b");
  });

  it("should include Ctrl modifier", () => {
    const shortcut: KeyboardShortcut = {
      id: "save",
      keys: "s",
      description: "Save",
      ctrl: true,
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("Ctrl+s");
  });

  it("should include Shift modifier", () => {
    const shortcut: KeyboardShortcut = {
      id: "rotate",
      keys: "R",
      description: "Rotate",
      shift: true,
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("Shift+R");
  });

  it("should include Alt modifier", () => {
    const shortcut: KeyboardShortcut = {
      id: "menu",
      keys: "F",
      description: "Menu",
      alt: true,
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("Alt+F");
  });

  it("should include multiple modifiers", () => {
    const shortcut: KeyboardShortcut = {
      id: "redo",
      keys: "z",
      description: "Redo",
      ctrl: true,
      shift: true,
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("Ctrl+Shift+z");
  });

  it("should use custom label if provided", () => {
    const shortcut: KeyboardShortcut = {
      id: "save",
      keys: "s",
      description: "Save",
      label: "Ctrl+S",
      ctrl: true,
      handler: vi.fn(),
    };

    expect(formatShortcut(shortcut)).toBe("Ctrl+S");
  });

  it("should format special keys", () => {
    const shortcuts = [
      { keys: "ArrowRight", expected: "Right" },
      { keys: "ArrowLeft", expected: "Left" },
      { keys: "ArrowUp", expected: "Up" },
      { keys: "ArrowDown", expected: "Down" },
      { keys: "PageDown", expected: "Page Down" },
      { keys: "PageUp", expected: "Page Up" },
      { keys: "Escape", expected: "Esc" },
    ];

    for (const { keys, expected } of shortcuts) {
      const shortcut: KeyboardShortcut = {
        id: "test",
        keys,
        description: "Test",
        handler: vi.fn(),
      };
      expect(formatShortcut(shortcut)).toBe(expected);
    }
  });
});

describe("withShortcut", () => {
  it("should combine description with formatted shortcut", () => {
    const shortcut = {
      id: "save",
      keys: "s",
      description: "Save",
      ctrl: true,
    };

    expect(withShortcut(shortcut)).toBe("Save (Ctrl+s)");
  });

  it("should work with custom label", () => {
    const shortcut = {
      id: "save",
      keys: "s",
      description: "Save document",
      label: "Ctrl+S",
      ctrl: true,
    };

    expect(withShortcut(shortcut)).toBe("Save document (Ctrl+S)");
  });
});
