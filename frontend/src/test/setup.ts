import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./mocks/server";

// Suppress jsdom CSS parsing errors and React act warnings
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalConsoleError = console.error.bind(console);

// biome-ignore lint/suspicious/noExplicitAny: Overriding process.stderr.write
process.stderr.write = (chunk: any, encoding?: any, callback?: any): boolean => {
  if (typeof chunk === "string" && chunk.includes("Could not parse CSS stylesheet")) {
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
};

// Suppress React act warnings that are unavoidable due to async library behavior
// biome-ignore lint/suspicious/noExplicitAny: Overriding console.error
console.error = (...args: any[]) => {
  const message = args[0];
  if (
    typeof message === "string" &&
    (message.includes("Warning: An update to") || message.includes("not wrapped in act(...)"))
  ) {
    return;
  }
  originalConsoleError(...args);
};

// Set up fake location for jsdom/MSW - must be before MSW setup
Object.defineProperty(window, "location", {
  writable: true,
  value: {
    href: "http://localhost:3000/",
    origin: "http://localhost:3000",
    protocol: "http:",
    host: "localhost:3000",
    hostname: "localhost",
    port: "3000",
    pathname: "/",
    search: "",
    hash: "",
  },
});

// Start MSW server before all tests
beforeAll(() => {
  server.listen({
    onUnhandledRequest(request, print) {
      // Ignore WebSocket connection attempts - they're mocked separately
      if (request.url.includes("/api/ws") || request.url.startsWith("ws://")) {
        return;
      }
      // Warn about other unhandled requests
      print.warning();
    },
  });
});

// Reset handlers and cleanup after each test
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Stop MSW server after all tests
afterAll(() => {
  server.close();
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock WebSocket - Prevent actual connections and reconnect delays in tests
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CLOSED; // Start as CLOSED to prevent connection attempts
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // DO NOT simulate connection - just stay closed to avoid console spam and delays
    // Tests that need WebSocket behavior can override this mock
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  send(_data: string) {
    // No-op in tests, but doesn't throw
  }

  addEventListener() {}
  removeEventListener() {}
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// Mock localStorage with a proper in-memory implementation
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock window.location
// biome-ignore lint/suspicious/noExplicitAny: test setup
delete (window as any).location;
// biome-ignore lint/suspicious/noExplicitAny: test setup
window.location = { href: "", reload: vi.fn() } as any;
