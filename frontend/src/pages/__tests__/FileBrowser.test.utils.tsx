/**
 * Shared test utilities for FileBrowser component tests
 * Used by: FileBrowser-rendering.test.tsx, FileBrowser-navigation.test.tsx,
 *          FileBrowser-interactions.test.tsx, FileBrowser-viewer.test.tsx
 */

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LocalePreferencesProvider } from "../../i18n/LocalePreferencesProvider";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import FileBrowser from "../FileBrowser";

const RouterLocationProbe = () => {
  const location = useLocation();
  return <output data-testid="router-location" hidden>{`${location.pathname}${location.search}`}</output>;
};

// Re-export test fixtures from centralized location
export {
  mockConnections,
  mockDirectoryListing,
  mockEmptyDirectory,
  mockFiles,
  mockFolders,
  mockNestedDirectory,
} from "../../test/fixtures";

// Helper function to render FileBrowser component with routing
export const renderBrowser = (initialPath = "/browse") => {
  return render(
    <LocalePreferencesProvider>
      <SambeeThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <RouterLocationProbe />
          <Routes>
            <Route path="/browse/:targetType/:targetId/*" element={<FileBrowser />} />
            <Route path="/browse" element={<FileBrowser />} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </SambeeThemeProvider>
    </LocalePreferencesProvider>
  );
};
