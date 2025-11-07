import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Note: MSW is configured but not working properly with Vitest + axios
// For now, we'll rely on direct API mocking in tests instead
// import { server } from "./mocks/server";

// Start MSW server before all tests
// beforeAll(() => {
// 	server.listen({ onUnhandledRequest: "warn" });
// });

// Reset handlers and cleanup after each test
afterEach(() => {
	// server.resetHandlers();
	cleanup();
});

// Stop MSW server after all tests
// afterAll(() => {
// 	server.close();
// });

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
