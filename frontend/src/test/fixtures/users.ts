/**
 * Test Fixtures - Users
 * Reusable user data for tests
 */

import type { User } from "../../types";

/**
 * Standard admin user for testing
 */
export const mockAdminUser: User = {
  username: "admin",
  is_admin: true,
  created_at: "2024-01-01T00:00:00",
};

/**
 * Standard regular user for testing
 */
export const mockRegularUser: User = {
  username: "testuser",
  is_admin: false,
  created_at: "2024-01-02T00:00:00",
};

/**
 * Additional test users
 */
export const mockUsers: User[] = [
  mockAdminUser,
  mockRegularUser,
  {
    username: "user1",
    is_admin: false,
    created_at: "2024-01-03T00:00:00",
  },
];

/**
 * Create a custom user with overrides
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    username: "testuser",
    is_admin: false,
    created_at: "2024-01-01T00:00:00",
    ...overrides,
  };
}
