import { Button } from "@mui/material";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import { ResponsiveFormDialog } from "../ResponsiveFormDialog";

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

describe("ResponsiveFormDialog", () => {
  beforeEach(() => {
    mockMobileMode(false);
  });

  it("renders the shared description above the dialog body on desktop", () => {
    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog
          open={true}
          onClose={vi.fn()}
          title="Edit User"
          description="Update the account details below."
          actions={<Button>Save</Button>}
        >
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    expect(screen.getByRole("heading", { name: /edit user/i })).toBeInTheDocument();
    expect(screen.getByText("Update the account details below.")).toBeInTheDocument();
    expect(screen.getByText("Dialog Body")).toBeInTheDocument();
    expect(window.getComputedStyle(screen.getByTestId("responsive-form-dialog-desktop-actions")).borderTopWidth).toBe("1px");
  });

  it("renders the shared description in the mobile sheet body", () => {
    mockMobileMode(true);

    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog
          open={true}
          onClose={vi.fn()}
          title="Edit User"
          description="Update the account details below."
          actions={<Button>Save</Button>}
        >
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    expect(screen.getByRole("button", { name: /common\.navigation\.goBack/i })).toBeInTheDocument();
    expect(screen.getByText("Update the account details below.")).toBeInTheDocument();
    expect(screen.getByText("Dialog Body")).toBeInTheDocument();
    const actions = screen.getByTestId("responsive-form-dialog-mobile-actions");
    const drawerPaper = actions.closest(".MuiDrawer-paper");

    expect(actions).toHaveStyle({
      position: "sticky",
      bottom: "0px",
    });
    const drawerStyles = window.getComputedStyle(drawerPaper as HTMLElement);

    expect(drawerStyles.getPropertyValue("--sambee-dialog-surface")).not.toBe("");
    expect(drawerStyles.getPropertyValue("--sambee-dialog-form-surface")).not.toBe("");
    expect(drawerStyles.getPropertyValue("--sambee-dialog-form-surface")).not.toBe(
      drawerStyles.getPropertyValue("--sambee-dialog-surface")
    );
  });

  it("restores focus to the triggering element after the dialog closes", async () => {
    const { rerender } = render(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <ResponsiveFormDialog open={false} onClose={vi.fn()} title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    const triggerButton = screen.getByRole("button", { name: /open dialog/i });
    triggerButton.focus();

    rerender(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <ResponsiveFormDialog open={true} onClose={vi.fn()} title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    rerender(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <ResponsiveFormDialog open={false} onClose={vi.fn()} title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    await waitFor(() => {
      expect(triggerButton).toHaveFocus();
    });
  });

  it("disables the mobile back affordance when close is disabled", () => {
    mockMobileMode(true);

    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog open={true} onClose={vi.fn()} disableClose title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    expect(screen.getByRole("button", { name: /common\.navigation\.goBack/i })).toBeDisabled();
  });

  it("requests cancellation with Escape even when pointer close is disabled", () => {
    const onClose = vi.fn();
    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog open={true} onClose={onClose} disableClose title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
