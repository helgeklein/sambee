import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		css: true,
		// Enable parallel file execution for better performance
		// Uses threads by default with fileParallelism enabled
		fileParallelism: true,
		// Maximum number of concurrent test files
		maxConcurrency: 5,
		// Timeout for each test (default is 5000ms)
		testTimeout: 10000,
		env: {
			VITE_API_URL: "http://localhost:8000/api",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			exclude: [
				"node_modules/",
				"src/test/",
				"**/*.d.ts",
				"**/*.config.*",
				"**/dist/",
				"src/vite-env.d.ts",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80,
			},
		},
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
