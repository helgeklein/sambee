/**
 * Mock Factories - API Mock Setup Helpers
 * Reusable factory functions for common API mock patterns
 */

import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Connection, DirectoryListing, User } from "../../types";
import { mockConnections, mockDirectoryListing, mockEmptyDirectory, mockNestedDirectory } from "../fixtures";

/**
 * API Mock Factory Interface
 */
export interface ApiMock {
  getConnections: Mock;
  listDirectory: Mock;
  getCurrentUser: Mock;
  testConnection: Mock;
  createConnection: Mock;
  updateConnection: Mock;
  deleteConnection: Mock;
  getImageBlob: Mock;
}

/**
 * Setup default successful API mocks
 * Common scenario: API calls succeed with standard test data
 */
export function setupSuccessfulApiMocks(api: ApiMock): void {
  api.getConnections.mockResolvedValue(mockConnections);
  api.listDirectory.mockResolvedValue(mockDirectoryListing);
  api.getCurrentUser.mockResolvedValue({
    username: "admin",
    is_admin: true,
  });
  api.testConnection.mockResolvedValue({
    success: true,
    message: "Connection successful",
  });
  api.createConnection.mockImplementation((data: Partial<Connection>) => Promise.resolve({ id: "new-conn", ...data } as Connection));
  api.updateConnection.mockImplementation((_id: string, data: Partial<Connection>) =>
    Promise.resolve({ id: "conn-1", ...data } as Connection)
  );
  api.deleteConnection.mockResolvedValue(undefined);

  // Mock getImageBlob to return a fake blob
  api.getImageBlob.mockResolvedValue(new Blob(["fake-image-data"], { type: "image/png" }));
}

/**
 * Setup empty state API mocks
 * Scenario: No connections or files available
 */
export function setupEmptyStateApiMocks(api: ApiMock): void {
  api.getConnections.mockResolvedValue([]);
  api.listDirectory.mockResolvedValue(mockEmptyDirectory);
}

/**
 * Setup error API mocks
 * Scenario: API calls fail with errors
 */
export function setupErrorApiMocks(api: ApiMock, status = 500): void {
  const error = {
    response: {
      data: { detail: "Internal server error" },
      status,
    },
  };

  api.getConnections.mockRejectedValue(error);
  api.listDirectory.mockRejectedValue(error);
  api.getCurrentUser.mockRejectedValue(error);
  api.testConnection.mockRejectedValue(error);
  api.createConnection.mockRejectedValue(error);
  api.updateConnection.mockRejectedValue(error);
  api.deleteConnection.mockRejectedValue(error);
  api.getImageBlob.mockRejectedValue(error);
}

/**
 * Setup navigation API mocks
 * Scenario: Supports multiple directory levels
 */
export function setupNavigationApiMocks(api: ApiMock): void {
  api.getConnections.mockResolvedValue(mockConnections);

  api.listDirectory.mockImplementation((_connectionId: string, path: string) => {
    if (path === "" || path === "/") {
      return Promise.resolve(mockDirectoryListing);
    }
    if (path === "/Documents" || path === "Documents") {
      return Promise.resolve(mockNestedDirectory);
    }
    return Promise.resolve(mockEmptyDirectory);
  });
}

/**
 * Create a mock for unauthorized errors (401)
 */
export function createUnauthorizedError() {
  return {
    response: {
      data: { detail: "Unauthorized" },
      status: 401,
    },
  };
}

/**
 * Create a mock for forbidden errors (403)
 */
export function createForbiddenError() {
  return {
    response: {
      data: { detail: "Forbidden" },
      status: 403,
    },
  };
}

/**
 * Create a mock for not found errors (404)
 */
export function createNotFoundError() {
  return {
    response: {
      data: { detail: "Connection not found" },
      status: 404,
    },
  };
}

/**
 * Create a mock for network errors
 */
export function createNetworkError() {
  const error = new Error("Network Error") as Error & { code?: string };
  // Add additional properties to make it identifiable
  error.code = "ECONNREFUSED";
  return error;
}

/**
 * Mock API factory - creates a fresh set of vi.fn() mocks
 */
export function createMockApi(): ApiMock {
  return {
    getConnections: vi.fn(),
    listDirectory: vi.fn(),
    getCurrentUser: vi.fn(),
    testConnection: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    getImageBlob: vi.fn(),
  };
}

/**
 * Setup connection test mocks
 * Scenario: Testing connection functionality
 */
export function setupConnectionTestMocks(api: ApiMock, options: { success?: boolean; message?: string } = {}): void {
  const { success = true, message = "Connection successful" } = options;

  api.testConnection.mockResolvedValue({
    success,
    message,
  });
}

/**
 * Setup directory listing by path
 * Helper for creating custom navigation scenarios
 */
export function setupDirectoryListingByPath(api: ApiMock, pathMap: Record<string, DirectoryListing>): void {
  api.listDirectory.mockImplementation((_connectionId: string, path: string) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return Promise.resolve(pathMap[normalizedPath] || mockEmptyDirectory);
  });
}

/**
 * Setup admin user mock
 */
export function setupAdminUserMock(api: ApiMock, user?: Partial<User>): void {
  api.getCurrentUser.mockResolvedValue({
    username: "admin",
    is_admin: true,
    ...user,
  });
}

/**
 * Setup regular user mock
 */
export function setupRegularUserMock(api: ApiMock, user?: Partial<User>): void {
  api.getCurrentUser.mockResolvedValue({
    username: "testuser",
    is_admin: false,
    ...user,
  });
}
