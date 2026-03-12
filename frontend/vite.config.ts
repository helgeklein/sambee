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
        manualChunks: {
          // Split React and React DOM into their own chunk
          react: ["react", "react-dom", "react-router-dom"],
          // Split Material-UI into its own chunk (it's large)
          mui: ["@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled"],
          // Split markdown rendering into its own chunk (only loaded when viewing markdown)
          markdown: ["react-markdown", "remark-gfm", "rehype-highlight"],
          // Split PDF rendering into its own chunk (only loaded when viewing PDFs)
          pdf: ["react-pdf"],
        },
      },
    },
  },
});
