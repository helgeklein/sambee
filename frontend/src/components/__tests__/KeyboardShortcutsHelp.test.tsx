import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardShortcut } from "../../hooks/useKeyboardShortcuts";
import { setLocale } from "../../i18n";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";

describe("KeyboardShortcutsHelp", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await setLocale("en");
  });

  const createShortcuts = (): KeyboardShortcut[] => [
    {
      id: "save",
      keys: "s",
      description: "Save",
      label: "Ctrl+S",
      ctrl: true,
      handler: vi.fn(),
    },
    {
      id: "open",
      keys: "o",
      description: "Open",
      label: "Ctrl+O",
      ctrl: true,
      handler: vi.fn(),
    },
  ];

  describe("Display", () => {
    it("should render dialog when open", () => {
      const shortcuts = createShortcuts();
      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    });

    it("should not render dialog when closed", () => {
      const shortcuts = createShortcuts();
      render(<KeyboardShortcutsHelp open={false} onClose={mockOnClose} shortcuts={shortcuts} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("should show custom title", () => {
      const shortcuts = createShortcuts();
      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} title="PDF Viewer Shortcuts" />);

      expect(screen.getByText("PDF Viewer Shortcuts")).toBeInTheDocument();
    });

    it("should display all shortcuts", () => {
      const shortcuts = createShortcuts();
      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      expect(screen.getByText("Save")).toBeInTheDocument();
      expect(screen.getByText("Open")).toBeInTheDocument();
      expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
      expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    });

    it("should show message when no shortcuts", () => {
      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={[]} />);

      expect(screen.getByText("No keyboard shortcuts available")).toBeInTheDocument();
    });

    it("should use translated default strings", async () => {
      await setLocale("en-XA");

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={[]} />);

      expect(screen.getByText("[Ķéýƀóåŕď Šħóŕťćúťš]")).toBeInTheDocument();
      expect(screen.getByText("[Ńó ķéýƀóåŕď šħóŕťćúťš åṽåíĺåƀĺé]")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "[Ćĺóšé]" })).toBeInTheDocument();
    });

    it("should hide shortcuts that are currently disabled", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "enabled",
          keys: "p",
          description: "Open quick navigation",
          label: "Ctrl+P",
          ctrl: true,
          handler: vi.fn(),
          enabled: true,
        },
        {
          id: "disabled",
          keys: ",",
          description: "Open settings",
          label: "Ctrl+,",
          ctrl: true,
          handler: vi.fn(),
          enabled: false,
        },
      ];

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      expect(screen.getByText("Open quick navigation")).toBeInTheDocument();
      expect(screen.queryByText("Open settings")).not.toBeInTheDocument();
      expect(screen.queryByText("Ctrl+,")).not.toBeInTheDocument();
    });
  });

  describe("Grouping", () => {
    it("should group shortcuts with same description", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "next1",
          keys: "ArrowRight",
          description: "Next page",
          label: "Right",
          handler: vi.fn(),
        },
        {
          id: "next2",
          keys: "PageDown",
          description: "Next page",
          label: "Page Down",
          handler: vi.fn(),
        },
      ];

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      // Should have one row with combined labels
      expect(screen.getByText("Right / Page Down")).toBeInTheDocument();
      // Description should appear only once
      const descriptions = screen.getAllByText("Next page");
      expect(descriptions).toHaveLength(1);
    });

    it("should preserve order from input", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "download",
          keys: "d",
          description: "Download",
          label: "D",
          handler: vi.fn(),
        },
        {
          id: "zoom-in",
          keys: "+",
          description: "Zoom in",
          label: "+",
          handler: vi.fn(),
        },
        {
          id: "zoom-out",
          keys: "-",
          description: "Zoom out",
          label: "-",
          handler: vi.fn(),
        },
      ];

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      const cells = screen.getAllByRole("cell");
      const descriptions = cells.filter((cell) => ["Download", "Zoom in", "Zoom out"].includes(cell.textContent || ""));

      expect(descriptions[0]).toHaveTextContent("Download");
      expect(descriptions[1]).toHaveTextContent("Zoom in");
      expect(descriptions[2]).toHaveTextContent("Zoom out");
    });

    it("should handle shortcuts with no duplicates", () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: "save",
          keys: "s",
          description: "Save",
          label: "Ctrl+S",
          ctrl: true,
          handler: vi.fn(),
        },
        {
          id: "open",
          keys: "o",
          description: "Open",
          label: "Ctrl+O",
          ctrl: true,
          handler: vi.fn(),
        },
      ];

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
      expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
      expect(screen.getByText("Save")).toBeInTheDocument();
      expect(screen.getByText("Open")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("should call onClose when Close button clicked", async () => {
      const user = userEvent.setup();
      const shortcuts = createShortcuts();

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      const closeButton = screen.getByRole("button", { name: /close/i });
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("should call onClose when backdrop clicked", async () => {
      const user = userEvent.setup();
      const shortcuts = createShortcuts();

      const { container } = render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      // Find backdrop (the div behind the dialog)
      const backdrop = container.querySelector(".MuiBackdrop-root");
      if (backdrop) {
        await user.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it("should call onClose when Escape key pressed", async () => {
      const user = userEvent.setup();
      const shortcuts = createShortcuts();

      render(<KeyboardShortcutsHelp open={true} onClose={mockOnClose} shortcuts={shortcuts} />);

      await user.keyboard("{Escape}");

      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
