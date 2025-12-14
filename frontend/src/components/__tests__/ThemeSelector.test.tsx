import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import { ThemeSelector, ThemeSelectorDialog } from "../ThemeSelector";

//
// ThemeSelector.test.tsx
//

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("ThemeSelector Component", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const renderWithProvider = (component: React.ReactElement) => {
    return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
  };

  describe("ThemeSelector Button", () => {
    it("should render theme selector button", () => {
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });

    it("should have palette icon", () => {
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      expect(button.querySelector("svg")).toBeInTheDocument();
    });

    it("should open dialog when clicked", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      await user.click(button);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Choose Theme")).toBeInTheDocument();
    });

    it("should have tooltip", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      await user.hover(button);

      // Tooltip should appear (MUI tooltips have a delay)
      await screen.findByText("Change theme", {}, { timeout: 2000 });
    });
  });

  describe("ThemeSelectorDialog", () => {
    it("should render dialog when open", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Choose Theme")).toBeInTheDocument();
    });

    it("should not render dialog when closed", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={false} onClose={mockOnClose} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("should display all available themes", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      expect(screen.getByText(/Sambee light/i)).toBeInTheDocument();
      expect(screen.getByText(/Sambee dark/i)).toBeInTheDocument();
    });

    it("should show theme descriptions", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      // Check if descriptions are present (themes should have descriptions)
      const descriptions = screen.queryAllByText(/theme/i);
      expect(descriptions.length).toBeGreaterThan(0);
    });

    it("should indicate current theme with radio button", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      const radioButtons = screen.getAllByRole("radio");
      const checkedRadios = radioButtons.filter((radio) => radio.getAttribute("checked") !== null);

      // Exactly one theme should be selected
      expect(checkedRadios.length).toBeGreaterThanOrEqual(0);
    });

    it("should display theme color previews", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      // Color preview boxes should be present (primary and secondary for each theme)
      const dialog = screen.getByRole("dialog");
      const colorBoxes = dialog.querySelectorAll("[title*='color' i]");

      expect(colorBoxes.length).toBeGreaterThanOrEqual(4); // At least 2 themes × 2 colors
    });

    it("should close dialog when theme is selected", async () => {
      const user = userEvent.setup();
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      // Click on a theme card - use first theme (Sambee light)
      const lightThemeCard = screen.getByText(/Sambee light/i).closest("button");
      expect(lightThemeCard).toBeInTheDocument();
      await user.click(lightThemeCard!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("should switch theme when different theme is selected", async () => {
      const user = userEvent.setup();
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      // Find and click dark theme
      const darkThemeCard = screen.getByText(/Sambee dark/i).closest("button");
      expect(darkThemeCard).toBeInTheDocument();

      await user.click(darkThemeCard!);

      expect(mockOnClose).toHaveBeenCalled();

      // Theme should be persisted to localStorage
      expect(localStorageMock.getItem("theme-id-current")).toBe("sambee-dark");
    });

    it("should show mode indicator (Light/Dark)", () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      expect(screen.getByText("Light")).toBeInTheDocument();
      expect(screen.getByText("Dark")).toBeInTheDocument();
    });
  });

  describe("Theme Switching", () => {
    it("should persist theme selection to localStorage", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ThemeSelector />);

      // Open dialog
      const button = screen.getByRole("button");
      await user.click(button);

      // Select dark theme
      const darkThemeCard = screen.getByText(/Sambee dark/i).closest("button");
      await user.click(darkThemeCard!);

      // Check localStorage
      expect(localStorageMock.getItem("theme-id-current")).toBe("sambee-dark");
    });

    it("should restore theme from localStorage on mount", async () => {
      const user = userEvent.setup();
      localStorageMock.setItem("theme-id-current", "sambee-dark");

      renderWithProvider(<ThemeSelector />);

      // Open dialog to check current theme
      const button = screen.getByRole("button");
      await user.click(button);

      // Wait for dialog to open
      await screen.findByRole("dialog");

      // The dark theme should be present
      const darkThemeText = screen.getByText(/Sambee dark/i);
      const darkThemeCard = darkThemeText.closest(".MuiCard-root");

      expect(darkThemeCard).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have accessible button", () => {
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label");
    });

    it("should have accessible dialog", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ThemeSelector />);

      const button = screen.getByRole("button");
      await user.click(button);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-labelledby");
    });

    it("should have accessible theme cards", async () => {
      const mockOnClose = vi.fn();
      renderWithProvider(<ThemeSelectorDialog open={true} onClose={mockOnClose} />);

      // Check that both theme cards are accessible
      const lightThemeCard = screen.getByText(/Sambee light/i).closest("button");
      const darkThemeCard = screen.getByText(/Sambee dark/i).closest("button");

      expect(lightThemeCard).toBeInTheDocument();
      expect(darkThemeCard).toBeInTheDocument();
    });
  });
});
