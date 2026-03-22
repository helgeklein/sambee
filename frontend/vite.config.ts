import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const FRONTEND_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(FRONTEND_DIR, "..");

function readWorkspaceBuildValue(fileName: string, fallback: string): string {
  try {
    const value = readFileSync(resolve(WORKSPACE_ROOT, fileName), "utf8").trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

const SAMBEE_VERSION = readWorkspaceBuildValue("VERSION", "unknown");
const SAMBEE_GIT_COMMIT = readWorkspaceBuildValue("GIT_COMMIT", "unknown");

// https://vite.dev/config/
export default defineConfig({
  define: {
    __SAMBEE_VERSION__: JSON.stringify(SAMBEE_VERSION),
    __SAMBEE_GIT_COMMIT__: JSON.stringify(SAMBEE_GIT_COMMIT),
  },
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Crawl lazy-loaded route modules during startup so navigation does not
    // trigger mid-session dependency re-optimization and a forced client reload.
    entries: ["index.html", "src/**/*.{ts,tsx}"],
    include: ["yet-another-react-lightbox", "yet-another-react-lightbox/plugins/zoom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Avoid forcing React and MUI into separate chunks because their
          // runtime linkage can create circular chunks in production builds.
          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("rehype-highlight")) {
            return "markdown";
          }

          if (id.includes("react-pdf")) {
            return "pdf";
          }

          return undefined;
        },
      },
    },
  },
});
