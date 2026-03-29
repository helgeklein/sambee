import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import DeleteDialog from "../DeleteDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function mockMobileMode(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("DeleteDialog", () => {
  beforeEach(() => {
    mockMobileMode(false);
  });

  it("renders as a mobile-style sheet on small screens", () => {
    mockMobileMode(true);

    render(
      <SambeeThemeProvider>
        <DeleteDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete Connection"
          description="Are you sure?"
          itemName="Docs"
        />
      </SambeeThemeProvider>
    );

    expect(screen.getByRole("button", { name: /common\.navigation\.goBack/i })).toBeInTheDocument();
    expect(screen.getByText("Delete Connection")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("disables both actions and shows progress while submitting", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <SambeeThemeProvider>
        <DeleteDialog
          open={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete Connection"
          description="Are you sure?"
          submitting
        />
      </SambeeThemeProvider>
    );

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    const confirmButton = screen.getByRole("button", { name: /delete/i });

    expect(cancelButton).toBeDisabled();
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
