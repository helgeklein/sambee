/**
 * WebSocket Mock - Prevents actual WebSocket connections in tests
 * Eliminates 5s reconnect delays and console warnings
 */

import { vi } from "vitest";

/**
 * Create a mock for the useWebSocket hook
 * Prevents actual WebSocket connections during tests
 */
export function createWebSocketMock() {
  return {
    useWebSocket: vi.fn(() => ({
      connected: false,
      lastMessage: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
  };
}

/**
 * Setup WebSocket mock globally
 * Call this in test setup files or individual test files
 */
export function setupWebSocketMock() {
  vi.mock("../../hooks/useWebSocket", () => createWebSocketMock());
}
