import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import { MobileSettingsDrawer } from "../MobileSettingsDrawer";

vi.mock("../../Settings/settingsDataSources", () => ({
  prefetchSettingsDataForItems: vi.fn(),
}));

vi.mock("../../Settings/useSettingsAccess", () => ({
  useSettingsAccess: () => ({ isAdmin: false }),
}));

vi.mock("../../../pages/ConnectionSettings", () => ({
  ConnectionSettings: ({ sectionTitle }: { sectionTitle?: string }) => <div>SMB Content: {sectionTitle}</div>,
}));

vi.mock("../../../pages/LocalDrivesSettings", () => ({
  LocalDrivesSettings: ({ sectionTitle }: { sectionTitle?: string }) => <div>Local Drives Content: {sectionTitle}</div>,
}));

function renderDrawer() {
  return render(
    <SambeeThemeProvider>
      <MemoryRouter>
        <MobileSettingsDrawer open onClose={vi.fn()} initialView="main" />
      </MemoryRouter>
    </SambeeThemeProvider>
  );
}

describe("MobileSettingsDrawer", () => {
  it("shows local drives as a top-level settings item and returns to the list from its page", async () => {
    const user = userEvent.setup();

    renderDrawer();

    expect(screen.getByText(/File Browser/i)).toBeInTheDocument();
    expect(screen.getByText(/^Connections$/i)).toBeInTheDocument();
    expect(screen.getByText(/Local Drives/i)).toBeInTheDocument();

    await user.click(screen.getByText(/Local Drives/i));

    expect(screen.getByText("Local Drives Content: Local Drives")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(screen.getByText(/^Connections$/i)).toBeInTheDocument();
    expect(screen.queryByText("Local Drives Content: Local Drives")).not.toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });
});
