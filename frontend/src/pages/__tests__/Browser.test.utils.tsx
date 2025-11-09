/**
 * Shared test utilities for Browser component tests
 * Used by: Browser-rendering.test.tsx, Browser-navigation.test.tsx,
 *          Browser-interactions.test.tsx, Browser-preview.test.tsx
 */

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Browser from "../Browser";

// Re-export test fixtures from centralized location
export {
  mockConnections,
  mockDirectoryListing,
  mockEmptyDirectory,
  mockFiles,
  mockFolders,
  mockNestedDirectory,
} from "../../test/fixtures";

// Helper function to render Browser component with routing
export const renderBrowser = (initialPath = "/browse") => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/browse/:connectionId/*" element={<Browser />} />
        <Route path="/browse" element={<Browser />} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  );
};
