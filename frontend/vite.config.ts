import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
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
