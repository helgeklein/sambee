import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SambeeThemeProvider } from "../../../theme";
import { SettingsLayout } from "../SettingsLayout";

vi.mock("../settingsDataSources", () => ({
  prefetchSettingsDataForItems: vi.fn(),
}));

vi.mock("../useSettingsAccess", () => ({
  useSettingsAccess: () => ({ isAdmin: false }),
}));

function renderSettingsLayout(initialEntries: string[]) {
  return render(
    <SambeeThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<div>Settings home</div>} />
            <Route path="appearance" element={<div>Appearance page</div>} />
            <Route path="connections" element={<div>Connections page</div>} />
            <Route path="connections/local-drives" element={<div>Local Drives page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SambeeThemeProvider>
  );
}

describe("SettingsLayout", () => {
  it("returns from a nested settings page to its parent settings page on mobile", async () => {
    const user = userEvent.setup();

    renderSettingsLayout(["/settings/connections/local-drives"]);

    expect(screen.getByText("Local Drives page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(screen.getByText("Connections page")).toBeInTheDocument();
    expect(screen.queryByText("Local Drives page")).not.toBeInTheDocument();
  });

  it("returns from a top-level settings page to the settings list on mobile", async () => {
    const user = userEvent.setup();

    renderSettingsLayout(["/settings/appearance"]);

    expect(screen.getByText("Appearance page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(screen.getByText("Settings home")).toBeInTheDocument();
    expect(screen.queryByText("Appearance page")).not.toBeInTheDocument();
  });
});
