import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SambeeThemeProvider } from "../../theme";
import { ConnectionsSettings } from "../ConnectionsSettings";

vi.mock("../ConnectionSettings", () => ({
  ConnectionSettings: ({ sectionTitle }: { sectionTitle?: string }) => <div>SMB Content: {sectionTitle}</div>,
}));

vi.mock("../LocalDrivesSettings", () => ({
  LocalDrivesSettings: ({ sectionTitle }: { sectionTitle?: string }) => <div>Local Drives Content: {sectionTitle}</div>,
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<SambeeThemeProvider>{ui}</SambeeThemeProvider>);
}

describe("ConnectionsSettings", () => {
  it("renders the connections parent page content on desktop", () => {
    renderWithTheme(
      <MemoryRouter initialEntries={["/browse"]}>
        <ConnectionsSettings forceDesktopLayout />
      </MemoryRouter>
    );

    expect(screen.getByText("SMB Content:")).toBeInTheDocument();
    expect(screen.queryByText(/^Local Drives$/)).not.toBeInTheDocument();
  });

  it("renders the connections parent page content on mobile route entry", () => {
    renderWithTheme(
      <MemoryRouter initialEntries={["/settings/connections"]}>
        <Routes>
          <Route path="/settings/connections" element={<ConnectionsSettings />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("SMB Content:")).toBeInTheDocument();
  });
});
