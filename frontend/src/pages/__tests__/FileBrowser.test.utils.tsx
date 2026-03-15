/**
 * Shared test utilities for FileBrowser component tests
 * Used by: FileBrowser-rendering.test.tsx, FileBrowser-navigation.test.tsx,
 *          FileBrowser-interactions.test.tsx, FileBrowser-viewer.test.tsx
 */

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SambeeThemeProvider } from "../../theme/ThemeContext";
import FileBrowser from "../FileBrowser";

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
    <SambeeThemeProvider>
      <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/browse/:targetType/:targetId/*" element={<FileBrowser />} />
          <Route path="/browse" element={<FileBrowser />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </SambeeThemeProvider>
  );
};
