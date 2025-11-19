import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
  optimizeDeps: {
    include: ["pdfjs-dist"],
    exclude: ["pdfjs-dist/build/pdf.worker.min.mjs"],
  },
  worker: {
    format: "es",
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
          pdf: ["react-pdf", "pdfjs-dist"],
        },
      },
    },
  },
});
