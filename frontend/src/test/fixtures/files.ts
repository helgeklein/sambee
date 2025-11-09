/**
 * Test Fixtures - Files and Directories
 * Reusable file and directory listing data for tests
 */

import { type DirectoryListing, type FileInfo, FileType } from "../../types";

/**
 * Standard directory items for testing
 */
export const mockFolders: FileInfo[] = [
  {
    name: "Documents",
    type: FileType.DIRECTORY,
    path: "Documents",
    size: 0,
    modified_at: "2024-01-15T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
  {
    name: "Pictures",
    type: FileType.DIRECTORY,
    path: "Pictures",
    size: 0,
    modified_at: "2024-01-14T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
];

export const mockFiles: FileInfo[] = [
  {
    name: "readme.txt",
    type: FileType.FILE,
    path: "readme.txt",
    size: 1024,
    modified_at: "2024-01-13T10:00:00Z",
    is_readable: true,
    is_hidden: false,
  },
];

/**
 * Complete directory listing with folders and files
 */
export const mockDirectoryListing: DirectoryListing = {
  path: "",
  items: [...mockFolders, ...mockFiles],
  total: 3,
};

/**
 * Empty directory listing
 */
export const mockEmptyDirectory: DirectoryListing = {
  path: "/",
  items: [],
  total: 0,
};

/**
 * Nested directory listing for Documents folder
 */
export const mockNestedDirectory: DirectoryListing = {
  path: "/Documents",
  items: [
    {
      name: "Work",
      type: FileType.DIRECTORY,
      path: "/Documents/Work",
      size: 0,
      modified_at: "2024-01-02T10:00:00",
      is_readable: true,
      is_hidden: false,
    },
    {
      name: "Personal",
      type: FileType.DIRECTORY,
      path: "/Documents/Personal",
      size: 0,
      modified_at: "2024-01-02T11:00:00",
      is_readable: true,
      is_hidden: false,
    },
    {
      name: "report.pdf",
      type: FileType.FILE,
      path: "/Documents/report.pdf",
      size: 5120,
      modified_at: "2024-01-02T12:00:00",
      is_readable: true,
      is_hidden: false,
    },
  ],
  total: 3,
};

/**
 * Large directory listing for performance testing
 */
export function createLargeDirectoryListing(count = 100): DirectoryListing {
  const items: FileInfo[] = [];

  // Add folders
  for (let i = 0; i < Math.floor(count / 2); i++) {
    items.push({
      name: `Folder${i.toString().padStart(3, "0")}`,
      type: FileType.DIRECTORY,
      path: `/Folder${i.toString().padStart(3, "0")}`,
      size: 0,
      modified_at: "2024-01-01T10:00:00",
      is_readable: true,
      is_hidden: false,
    });
  }

  // Add files
  for (let i = 0; i < Math.ceil(count / 2); i++) {
    items.push({
      name: `file${i.toString().padStart(3, "0")}.txt`,
      type: FileType.FILE,
      path: `/file${i.toString().padStart(3, "0")}.txt`,
      size: 1024 * (i + 1),
      modified_at: "2024-01-01T12:00:00",
      is_readable: true,
      is_hidden: false,
    });
  }

  return {
    path: "/",
    items,
    total: items.length,
  };
}

/**
 * Create a custom directory listing
 */
export function createMockDirectoryListing(path: string, items: FileInfo[] = []): DirectoryListing {
  return {
    path,
    items,
    total: items.length,
  };
}

/**
 * Create a mock file info item
 */
export function createMockFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    name: "test-item",
    type: FileType.FILE,
    path: "/test-item",
    size: 1024,
    modified_at: "2024-01-01T12:00:00",
    is_readable: true,
    is_hidden: false,
    ...overrides,
  };
}
