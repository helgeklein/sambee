import { Button } from "@mui/material";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(window.getComputedStyle(screen.getByText("Dialog Body").closest(".MuiDialogContent-root") as HTMLElement).paddingLeft).toBe(
      "24px"
    );
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

  it("does not restore focus when restoration is disabled", async () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <button type="button">Fallback Focus</button>
        <ResponsiveFormDialog open={false} onClose={vi.fn()} disableRestoreFocus title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    const triggerButton = screen.getByRole("button", { name: /open dialog/i });
    const fallbackButton = screen.getByRole("button", { name: /fallback focus/i });
    triggerButton.focus();

    rerender(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <button type="button">Fallback Focus</button>
        <ResponsiveFormDialog open={true} onClose={vi.fn()} disableRestoreFocus title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    rerender(
      <SambeeThemeProvider>
        <button type="button">Open Dialog</button>
        <button type="button">Fallback Focus</button>
        <ResponsiveFormDialog open={false} onClose={vi.fn()} disableRestoreFocus title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    fallbackButton.focus();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fallbackButton).toHaveFocus();
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

  it("ignores Escape when close is disabled on desktop", () => {
    const onClose = vi.fn();
    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog open={true} onClose={onClose} disableClose title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape when close is disabled on mobile", () => {
    mockMobileMode(true);
    const onClose = vi.fn();
    render(
      <SambeeThemeProvider>
        <ResponsiveFormDialog open={true} onClose={onClose} disableClose title="Edit User" actions={<Button>Save</Button>}>
          <div>Dialog Body</div>
        </ResponsiveFormDialog>
      </SambeeThemeProvider>
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
