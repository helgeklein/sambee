/**
 * Shared test utilities for Browser component tests
 * Used by: Browser-rendering.test.tsx, Browser-navigation.test.tsx,
 *          Browser-interactions.test.tsx, Browser-preview.test.tsx
 */

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Connection, DirectoryListing, FileInfo } from "../../types";
import { FileType } from "../../types";
import Browser from "../Browser";

// Test fixtures
export const mockConnections: Connection[] = [
  {
    id: "conn-1",
    name: "Test Server 1",
    type: "SMB",
    host: "192.168.1.100",
    share_name: "share1",
    username: "user1",
    port: 445,
    path_prefix: "/",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "conn-2",
    name: "Test Server 2",
    type: "SMB",
    host: "192.168.1.101",
    share_name: "share2",
    username: "user2",
    port: 445,
    path_prefix: "/",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

export const mockFiles: FileInfo[] = [
  {
    name: "Documents",
    path: "Documents",
    type: FileType.DIRECTORY,
    size: 0,
    modified_at: "2024-01-15T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
  {
    name: "Pictures",
    path: "Pictures",
    type: FileType.DIRECTORY,
    size: 0,
    modified_at: "2024-01-14T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
  {
    name: "readme.txt",
    path: "readme.txt",
    type: FileType.FILE,
    size: 1024,
    modified_at: "2024-01-13T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
];

export const mockDirectoryListing: DirectoryListing = {
  items: mockFiles,
  path: "",
  total: mockFiles.length,
};

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
